import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { refreshCatalog } from "./catalogar.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const VIDEOS_FILE = path.join(DATA_DIR, "videos.json");

function loadEnv() {
  return fs.readFile(path.join(ROOT, ".env"), "utf8").then((content) => {
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
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
const DYNU_HOSTNAME = process.env.DYNU_HOSTNAME || "";
const DYNU_USERNAME = process.env.DYNU_USERNAME || "";
const DYNU_PASSWORD = process.env.DYNU_PASSWORD || "";
let videos = [];
let refreshInProgress = false;

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
    const freshVideos = await refreshCatalog();
    videos = freshVideos;
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
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return null;
  return value.startsWith("http://") ? `https://${value.slice(7)}` : value;
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
    const title = String(video.title || video.name || `Vídeo ${index + 1}`).replace(/[\r\n]/g, " ");
    const duration = Number(video.duration);
    lines.push(`#EXTINF:${Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : -1},${title}`);
    lines.push(`http://${host}/video/${id}`);
  });
  return lines.join("\n") + "\n";
}

async function updateDynu(ipv6) {
  if (!DYNU_HOSTNAME || !DYNU_USERNAME || !DYNU_PASSWORD) return;
  const params = new URLSearchParams({
    hostname: DYNU_HOSTNAME,
    username: DYNU_USERNAME,
    password: DYNU_PASSWORD,
    myip: "no",
    myipv6: ipv6
  });
  const response = await fetch(`https://api.dynu.com/nic/update?${params}`);
  const body = (await response.text()).trim();
  if (!response.ok) throw new Error(`Dynu HTTP ${response.status}: ${body}`);
  console.log(`🌐 Dynu: ${body}`);
}

async function refreshDynu() {
  if (!DYNU_HOSTNAME || !DYNU_USERNAME || !DYNU_PASSWORD) return;
  try {
    const response = await fetch("https://api6.ipify.org");
    if (!response.ok) throw new Error(`ipify HTTP ${response.status}`);
    const ipv6 = (await response.text()).trim();
    if (!ipv6.includes(":")) throw new Error("Resposta não parece ser IPv6.");
    await updateDynu(ipv6);
  } catch (error) {
    console.warn("⚠️ Atualização Dynu falhou:", error.message);
  }
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
    upstream = await fetch(sourceUrl, {
      method: req.method,
      headers,
      redirect: "follow",
      signal: controller.signal
    });
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
    return res.end(JSON.stringify({ ok: true, service: "chiru-san-iptv", platform: "termux", videos: videos.length, refreshing: refreshInProgress }));
  }

  if (url.pathname === "/") {
    const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chiru-san IPTV</title><h1>📺 Chiru-san IPTV</h1><p>Servidor Termux online.</p><p>Vídeos: ${videos.length}</p><p><a href="/playlist.m3u">Abrir playlist M3U</a></p><p><a href="/health">Health</a></p></html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html) });
    return res.end(html);
  }

  if (url.pathname === "/playlist.m3u") {
    const playlist = makePlaylist(req);
    res.writeHead(200, { "Content-Type": "audio/x-mpegurl; charset=utf-8", "Content-Length": Buffer.byteLength(playlist), "Cache-Control": "no-store" });
    return res.end(playlist);
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
  console.log(`📡 Playlist: http://IP-DO-TERMUX:${PORT}/playlist.m3u`);
  console.log(`🩺 Health: http://IP-DO-TERMUX:${PORT}/health`);
  console.log(`🔄 Catálogo: a cada ${Math.round(REFRESH_MS / 60000)} minuto(s)`);
  console.log("🕳️ Hostless não participa do streaming nesta etapa; será somente o túnel.");
});

setInterval(updateCatalog, REFRESH_MS);
setInterval(refreshDynu, 5 * 60 * 1000);
refreshDynu();

server.on("error", (error) => {
  console.error("❌ Erro no servidor:", error);
  if (error.code === "EADDRINUSE") process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n🛑 Recebido ${signal}; encerrando servidor...`);
    server.close(() => process.exit(0));
  });
}
