import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { refreshCatalog } from "./catalogar.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const VIDEOS_FILE = path.join(DATA_DIR, "videos.json");
const HLS_DIR = path.join(DATA_DIR, "hls");

function loadEnv() {
  return fs.readFile(path.join(ROOT, ".env"), "utf8").then((content) => {
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*)$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }).catch((error) => {
    if (error.code !== "ENOENT") console.warn("⚠️ .env:", error.message);
  });
}

await loadEnv();

const HOST = process.env.HOST || "::";
const PORT = Number(process.env.PORT || 18080);
const REFRESH_MS = Math.max(60_000, Number(process.env.CATALOG_REFRESH_MS || 300_000));
const SEGMENT_SECONDS = Math.max(2, Math.min(10, Number(process.env.HLS_SEGMENT_SECONDS || 4)));
const CACHE_SECONDS = Math.max(SEGMENT_SECONDS * 3, Number(process.env.HLS_CACHE_SECONDS || 180));
const MAX_SEGMENTS = Math.max(3, Math.ceil(CACHE_SECONDS / SEGMENT_SECONDS));
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

let videos = [];
let refreshInProgress = false;
const hlsJobs = new Map();

async function loadCatalogFromDisk() {
  try {
    const parsed = JSON.parse(await fs.readFile(VIDEOS_FILE, "utf8"));
    videos = Array.isArray(parsed) ? parsed : [];
    console.log(`📺 ${videos.length} vídeos carregados do disco.`);
  } catch (error) {
    if (error.code !== "ENOENT") console.error("❌ Erro lendo catálogo:", error.message);
    videos = [];
  }
}

async function updateCatalog() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  try {
    videos = await refreshCatalog();
  } catch (error) {
    console.error("⚠️ Atualização do catálogo falhou; mantendo o último catálogo válido:", error.message);
  } finally {
    refreshInProgress = false;
  }
}

function videoId(video, index) {
  return String(video?.id ?? video?.uid ?? index + 1);
}

function findVideo(id) {
  return videos.find((video, index) => videoId(video, index) === String(id));
}

function videoUrl(video) {
  const value = video?.url || video?.videoUrl || video?.playbackUrl || video?.directUrl || video?.src || video?.link;
  if (typeof value !== "string" || !/^https?:\\/\\//i.test(value)) return null;
  return value.startsWith("http://") ? `https://${value.slice(7)}` : value;
}

function cacheKey(id) {
  return createHash("sha256").update(String(id)).digest("hex").slice(0, 24);
}

function hlsPath(id, filename = "index.m3u8") {
  return path.join(HLS_DIR, cacheKey(id), filename);
}

function sendText(res, status, message) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(message);
}

function makePlaylist(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  const lines = ["#EXTM3U"];
  videos.forEach((video, index) => {
    const id = encodeURIComponent(videoId(video, index));
    const title = String(video.title || video.name || `Vídeo ${index + 1}`).replace(/[\\r\\n]/g, " ");
    const duration = Number(video.duration);
    lines.push(`#EXTINF:${Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : -1},${title}`);
    lines.push(`http://${host}/video/${id}`);
  });
  return lines.join("\\n") + "\\n";
}

async function streamVideo(req, res, video) {
  const sourceUrl = videoUrl(video);
  if (!sourceUrl) return sendText(res, 502, "URL de vídeo ausente ou inválida no catálogo.");

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  const headers = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/151.0.0.0 Mobile Safari/537.36",
    "Accept": "*/*"
  };
  if (req.headers.range) headers.Range = req.headers.range;

  let upstream;
  try {
    upstream = await fetch(sourceUrl, { method: req.method, headers, redirect: "follow", signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error("❌ Falha buscando vídeo:", error.message);
    return sendText(res, 502, "Falha ao buscar o vídeo na origem.");
  }

  if (!upstream.ok && upstream.status !== 206) {
    const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
    if (upstream.body) await upstream.body.cancel().catch(() => {});
    return sendText(res, status, `A origem respondeu HTTP ${upstream.status}.`);
  }

  const responseHeaders = {
    "Content-Type": upstream.headers.get("content-type") || "video/mp4",
    "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  };
  for (const name of ["content-length", "content-range", "last-modified", "etag"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders[name] = value;
  }

  res.writeHead(upstream.status, responseHeaders);
  if (req.method === "HEAD" || !upstream.body) return res.end();
  try {
    await pipeline(Readable.fromWeb(upstream.body), res, { signal: controller.signal });
  } catch (error) {
    if (!controller.signal.aborted && error.name !== "AbortError") {
      console.warn("⚠️ Streaming interrompido:", error.message);
      if (!res.destroyed) res.destroy(error);
    }
  }
}

function startHlsJob(id, video, outputDir) {
  const sourceUrl = videoUrl(video);
  if (!sourceUrl) throw new Error("URL de vídeo ausente ou inválida no catálogo.");

  const playlistPath = path.join(outputDir, "index.m3u8");
  const segmentPattern = path.join(outputDir, "segment_%06d.ts");
  const args = [
    "-hide_banner", "-loglevel", "warning", "-nostdin", "-y",
    "-user_agent", "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/151.0.0.0 Mobile Safari/537.36",
    "-i", sourceUrl,
    "-map", "0:v:0?", "-map", "0:a:0?",
    "-c", "copy", "-sn", "-dn",
    "-f", "hls",
    "-hls_time", String(SEGMENT_SECONDS),
    "-hls_list_size", String(MAX_SEGMENTS),
    "-hls_delete_threshold", "2",
    "-hls_flags", "delete_segments+append_list+independent_segments+temp_file",
    "-hls_segment_filename", segmentPattern,
    playlistPath
  ];

  const child = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
  const job = { child, startedAt: Date.now(), exitCode: null, error: null };
  hlsJobs.set(id, job);

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  child.on("error", (error) => {
    job.error = error.message;
    console.error(`❌ FFmpeg para ${id}:`, error.message);
  });
  child.on("close", (code) => {
    job.exitCode = code;
    if (code !== 0) {
      job.error ||= stderr.trim() || `FFmpeg encerrou com código ${code}`;
      console.error(`❌ FFmpeg para ${id} terminou: ${job.error}`);
    } else {
      console.log(`✅ HLS finalizado para o vídeo ${id}.`);
    }
  });
  console.log(`🎞️ HLS iniciado: vídeo ${id}, segmentos-alvo de ${SEGMENT_SECONDS}s, janela de cache de ${CACHE_SECONDS}s.`);
  return job;
}

async function waitForPlaylist(id, job, timeoutMs = 30_000) {
  const target = hlsPath(id);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const stat = await fs.stat(target);
      if (stat.size > 0) return true;
    } catch {}
    if (job.exitCode !== null || job.error) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function serveHlsPlaylist(req, res, id, video) {
  let job = hlsJobs.get(id);
  const outputDir = path.dirname(hlsPath(id));
  if (!job) {
    try {
      await fs.mkdir(HLS_DIR, { recursive: true });
      await fs.rm(outputDir, { recursive: true, force: true });
      await fs.mkdir(outputDir, { recursive: true });
      job = startHlsJob(id, video, outputDir);
    } catch (error) {
      return sendText(res, 500, `Não foi possível iniciar o FFmpeg: ${error.message}`);
    }
  }

  const ready = await waitForPlaylist(id, job);
  if (!ready) return sendText(res, 502, job.error || "FFmpeg ainda não conseguiu gerar a playlist HLS.");
  try {
    const body = await fs.readFile(hlsPath(id));
    res.writeHead(200, {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    return req.method === "HEAD" ? res.end() : res.end(body);
  } catch (error) {
    return sendText(res, 500, `Erro lendo playlist HLS: ${error.message}`);
  }
}

async function serveHlsSegment(req, res, id, filename) {
  if (!/^segment_\\d{6}\\.ts$/.test(filename)) return sendText(res, 400, "Nome de segmento inválido.");
  const target = hlsPath(id, filename);
  let stat;
  try {
    stat = await fs.stat(target);
    if (!stat.isFile()) return sendText(res, 404, "Segmento não encontrado.");
  } catch {
    return sendText(res, 404, "Segmento ainda não está disponível no cache.");
  }

  res.writeHead(200, {
    "Content-Type": "video/mp2t",
    "Content-Length": stat.size,
    "Cache-Control": "public, max-age=60, immutable",
    "Access-Control-Allow-Origin": "*"
  });
  if (req.method === "HEAD") return res.end();
  try {
    await pipeline((await import("node:fs")).createReadStream(target), res);
  } catch (error) {
    if (!res.destroyed) console.warn("⚠️ Entrega de segmento interrompida:", error.message);
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Método não permitido.");

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({
      ok: true, service: "chiru-san-iptv", platform: "termux",
      videos: videos.length, refreshing: refreshInProgress,
      ffmpegJobs: hlsJobs.size, hlsSegmentSeconds: SEGMENT_SECONDS, hlsCacheSeconds: CACHE_SECONDS
    }));
  }

  if (url.pathname === "/") {
    const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chiru-san IPTV</title><h1>📺 Chiru-san IPTV</h1><p>Servidor Termux online.</p><p>Vídeos: ${videos.length}</p><p><a href="/playlist.m3u">Playlist direta</a></p><p><a href="/health">Health</a></p></html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html) });
    return res.end(html);
  }

  if (url.pathname === "/catalog.json") {
    const catalog = videos.map((video, index) => ({
      id: videoId(video, index), title: video.title || video.name || `Vídeo ${index + 1}`,
      duration: video.duration || null, width: video.width || null, height: video.height || null,
      poster: video.poster || null
    }));
    const body = JSON.stringify(catalog);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
    return res.end(body);
  }

  if (url.pathname === "/playlist.m3u") {
    const playlist = makePlaylist(req);
    res.writeHead(200, { "Content-Type": "audio/x-mpegurl; charset=utf-8", "Content-Length": Buffer.byteLength(playlist), "Cache-Control": "no-store" });
    return res.end(playlist);
  }

  const hlsMatch = url.pathname.match(/^\\/hls\\/([^/]+)\\/([^/]+)$/);
  if (hlsMatch) {
    let id;
    try { id = decodeURIComponent(hlsMatch[1]); }
    catch { return sendText(res, 400, "ID inválido."); }
    const video = findVideo(id);
    if (!video) return sendText(res, 404, "Vídeo não encontrado.");
    if (hlsMatch[2] === "index.m3u8") return serveHlsPlaylist(req, res, id, video);
    return serveHlsSegment(req, res, id, hlsMatch[2]);
  }

  if (url.pathname.startsWith("/video/")) {
    let id;
    try { id = decodeURIComponent(url.pathname.slice("/video/".length)); }
    catch { return sendText(res, 400, "ID inválido."); }
    const video = findVideo(id);
    if (!video) return sendText(res, 404, "Vídeo não encontrado.");
    return streamVideo(req, res, video);
  }

  return sendText(res, 404, "404 - Não encontrado.");
});

await loadCatalogFromDisk();
updateCatalog();

server.listen({ host: HOST, port: PORT, ipv6Only: false }, () => {
  console.log("");
  console.log("📺 CHIRU-SAN IPTV | TERMUX");
  console.log(`🌐 Escutando em http://[::]:${PORT}`);
  console.log(`📡 Playlist direta: http://IP-DO-TERMUX:${PORT}/playlist.m3u`);
  console.log(`🎞️ HLS por vídeo: http://IP-DO-TERMUX:${PORT}/hls/ID/index.m3u8`);
  console.log(`🩺 Health: http://IP-DO-TERMUX:${PORT}/health`);
  console.log(`🔄 Catálogo: a cada ${Math.round(REFRESH_MS / 60000)} minuto(s)`);
  console.log(`🎬 FFmpeg: ${FFMPEG}; segmentos-alvo ${SEGMENT_SECONDS}s; cache ${CACHE_SECONDS}s`);
});

setInterval(updateCatalog, REFRESH_MS);

server.on("error", (error) => {
  console.error("❌ Erro no servidor:", error);
  if (error.code === "EADDRINUSE") process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\\n🛑 Recebido ${signal}; encerrando servidor...`);
    for (const job of hlsJobs.values()) job.child.kill("SIGTERM");
    server.close(() => process.exit(0));
  });
}
