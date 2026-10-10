import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================================================
   CONFIGURAÇÃO
   ========================================================= */

const HOST = "::";

// Carrega .env local sem sobrescrever variáveis já definidas no ambiente.
try {
  const envText = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
} catch (error) {
  if (error.code !== "ENOENT") console.warn("⚠️ Não foi possível ler .env local:", error.message);
}

const DYNU_HOSTNAME = "chirusanrestart.freeddns.org";

// Credenciais lidas do arquivo .env local, nunca do código versionado.
const DYNU_USERNAME = process.env.DYNU_USERNAME || "";
const DYNU_PASSWORD = process.env.DYNU_PASSWORD || "";

const VIDEOS_FILE = path.join(__dirname, "videos.json");
const IPV6_CACHE_FILE = path.join(__dirname, "dynu-ipv6.json");

/* =========================================================
   VÍDEOS
   ========================================================= */

let videos = [];

function carregarVideos() {
  try {
    if (!fs.existsSync(VIDEOS_FILE)) {
      console.error(`❌ Arquivo não encontrado: ${VIDEOS_FILE}`);
      videos = [];
      return;
    }

    const data = JSON.parse(
      fs.readFileSync(VIDEOS_FILE, "utf8")
    );

    if (Array.isArray(data)) {
      videos = data;
    } else if (Array.isArray(data.videos)) {
      videos = data.videos;
    } else if (Array.isArray(data.media)) {
      videos = data.media;
    } else {
      videos = [];
    }

    console.log(`📺 ${videos.length} vídeos carregados.`);
  } catch (error) {
    console.error(
      "❌ Erro ao carregar videos.json:",
      error.message
    );

    videos = [];
  }
}

carregarVideos();

/* =========================================================
   URL DO VÍDEO
   ========================================================= */

function obterUrlVideo(video) {
  if (!video || typeof video !== "object") {
    return null;
  }

  return (
    video.url ||
    video.videoUrl ||
    video.playbackUrl ||
    video.playback_url ||
    video.directUrl ||
    video.direct_url ||
    video.src ||
    video.link ||
    null
  );
}

/* =========================================================
   ID DO VÍDEO
   ========================================================= */

function obterIdVideo(video, index) {
  if (!video || typeof video !== "object") {
    return String(index);
  }

  return String(
    video.id ||
    video.mediaId ||
    video.media_id ||
    video.name ||
    video.filename ||
    index
  );
}

/* =========================================================
   NORMALIZAR HTTPS
   ========================================================= */

function normalizarHttps(url) {
  if (!url || typeof url !== "string") {
    return null;
  }

  if (url.startsWith("http://")) {
    return "https://" + url.slice(7);
  }

  return url;
}

/* =========================================================
   ENCONTRAR VÍDEO
   ========================================================= */

function encontrarVideo(id) {
  return videos.find((video, index) => {
    return obterIdVideo(video, index) === String(id);
  });
}

/* =========================================================
   GERAR PLAYLIST M3U
   ========================================================= */

function gerarM3U(hostHeader) {
  const linhas = [
    "#EXTM3U",
    "#EXT-X-VERSION:3"
  ];

  videos.forEach((video, index) => {
    const id = obterIdVideo(video, index);

    const nome =
      video.title ||
      video.name ||
      video.filename ||
      `Vídeo ${index + 1}`;

    linhas.push(`#EXTINF:-1,${nome}`);
    linhas.push(
      `http://${hostHeader}/video/${encodeURIComponent(id)}`
    );
  });

  return linhas.join("\n") + "\n";
}

/* =========================================================
   DESCOBRIR IPV6 PÚBLICO
   ========================================================= */

async function descobrirIPv6() {
  const servicos = [
    "https://api6.ipify.org",
    "https://ipv6.icanhazip.com"
  ];

  for (const servico of servicos) {
    try {
      const response = await fetch(servico, {
        headers: {
          "User-Agent": "chiru-san-iptv/1.0"
        }
      });

      if (!response.ok) {
        continue;
      }

      const ipv6 = (await response.text()).trim();

      if (
        ipv6 &&
        ipv6.includes(":") &&
        !ipv6.includes(" ") &&
        !ipv6.includes("\n")
      ) {
        return ipv6;
      }
    } catch {
      console.log(
        `⚠️ Falha ao consultar ${servico}`
      );
    }
  }

  return null;
}

/* =========================================================
   LER IPV6 SALVO
   ========================================================= */

function lerIPv6Salvo() {
  try {
    if (!fs.existsSync(IPV6_CACHE_FILE)) {
      return null;
    }

    const data = JSON.parse(
      fs.readFileSync(IPV6_CACHE_FILE, "utf8")
    );

    return data.ipv6 || null;
  } catch {
    return null;
  }
}

/* =========================================================
   SALVAR IPV6
   ========================================================= */

function salvarIPv6(ipv6) {
  try {
    fs.writeFileSync(
      IPV6_CACHE_FILE,
      JSON.stringify(
        {
          ipv6,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      "⚠️ Não foi possível salvar o IPv6:",
      error.message
    );
  }
}

/* =========================================================
   ATUALIZAR DYNU
   ========================================================= */

async function atualizarDynu(ipv6) {
  try {
    const params = new URLSearchParams();

    params.set("hostname", DYNU_HOSTNAME);
    params.set("username", DYNU_USERNAME);
    params.set("password", DYNU_PASSWORD);

    // Não atualizar IPv4
    params.set("myip", "no");

    // Atualizar somente IPv6
    params.set("myipv6", ipv6);

    const url =
      `https://api.dynu.com/nic/update?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "chiru-san-iptv/1.0"
      }
    });

    const texto = (await response.text()).trim();

    if (!response.ok) {
      console.error(
        `❌ Dynu respondeu HTTP ${response.status}: ${texto}`
      );

      return false;
    }

    console.log(`🌐 Dynu: ${texto}`);

    return true;
  } catch (error) {
    console.error(
      "❌ Erro ao atualizar Dynu:",
      error.message
    );

    return false;
  }
}

/* =========================================================
   ATUALIZAR IPV6
   ========================================================= */

async function atualizarIPv6() {
  if (!DYNU_USERNAME || !DYNU_PASSWORD) {
    console.warn("⚠️ Configure DYNU_USERNAME e DYNU_PASSWORD no arquivo .env local; atualização Dynu ignorada.");
    return;
  }
  console.log("🔎 Descobrindo IPv6 público...");

  const ipv6 = await descobrirIPv6();

  if (!ipv6) {
    console.error(
      "❌ Não foi possível descobrir o IPv6 público."
    );

    return;
  }

  const anterior = lerIPv6Salvo();

  console.log(`🌐 IPv6 público: ${ipv6}`);

  if (anterior === ipv6) {
    console.log("✅ IPv6 não mudou.");
    return;
  }

  console.log(
    `🔄 IPv6 alterado: ${anterior || "(nenhum)"} → ${ipv6}`
  );

  const atualizado = await atualizarDynu(ipv6);

  if (atualizado) {
    salvarIPv6(ipv6);

    console.log(
      `✅ Dynu atualizado para ${ipv6}`
    );
  }
}

/* =========================================================
   HEADERS BASE
   ========================================================= */

function adicionarHeadersBase(response) {
  response.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  response.setHeader(
    "Access-Control-Allow-Methods",
    "GET, HEAD, OPTIONS"
  );

  response.setHeader(
    "Access-Control-Allow-Headers",
    "Range, Content-Type"
  );
}

/* =========================================================
   STREAM GOOGLE FOTOS
   ========================================================= */

async function transmitirVideo(req, res, video) {
  const urlOriginal = obterUrlVideo(video);

  if (!urlOriginal) {
    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("URL do vídeo não encontrada.");
    return;
  }

  const urlVideo = normalizarHttps(urlOriginal);

  console.log(`🎬 Streaming: ${urlVideo}`);

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10) " +
      "AppleWebKit/537.36 " +
      "(KHTML, like Gecko) " +
      "Chrome/151.0.0.0 Mobile Safari/537.36",

    "Accept": "*/*"
  };

  /* -------------------------------------------------------
     RANGE DO CLIENTE
     ------------------------------------------------------- */

  const range = req.headers.range;

  if (range) {
    headers.Range = range;
  }

  let upstream;

  try {
    upstream = await fetch(urlVideo, {
      method:
        req.method === "HEAD"
          ? "HEAD"
          : "GET",

      headers,

      redirect: "follow"
    });
  } catch (error) {
    console.error(
      "❌ Erro ao conectar ao Google Fotos:",
      error.message
    );

    if (!res.headersSent) {
      res.writeHead(502, {
        "Content-Type":
          "text/plain; charset=utf-8"
      });
    }

    res.end(
      "Erro ao conectar ao Google Fotos."
    );

    return;
  }

  if (!upstream.ok && upstream.status !== 206) {
    console.error(
      `❌ Google Fotos respondeu HTTP ${upstream.status}`
    );

    if (!res.headersSent) {
      res.writeHead(upstream.status, {
        "Content-Type":
          "text/plain; charset=utf-8"
      });
    }

    res.end(
      `Google Fotos respondeu HTTP ${upstream.status}`
    );

    return;
  }

  /* -------------------------------------------------------
     HEADERS
     ------------------------------------------------------- */

  const responseHeaders = {};

  const contentType =
    upstream.headers.get("content-type");

  const contentLength =
    upstream.headers.get("content-length");

  const contentRange =
    upstream.headers.get("content-range");

  const acceptRanges =
    upstream.headers.get("accept-ranges");

  if (contentType) {
    responseHeaders["Content-Type"] =
      contentType;
  } else {
    responseHeaders["Content-Type"] =
      "video/mp4";
  }

  if (contentLength) {
    responseHeaders["Content-Length"] =
      contentLength;
  }

  if (contentRange) {
    responseHeaders["Content-Range"] =
      contentRange;
  }

  responseHeaders["Accept-Ranges"] =
    acceptRanges || "bytes";

  responseHeaders["Access-Control-Allow-Origin"] =
    "*";

  responseHeaders["Cache-Control"] =
    "no-cache";

  /* -------------------------------------------------------
     STATUS
     ------------------------------------------------------- */

  const status =
    upstream.status === 206
      ? 206
      : 200;

  res.writeHead(
    status,
    responseHeaders
  );

  /* -------------------------------------------------------
     HEAD
     ------------------------------------------------------- */

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  /* -------------------------------------------------------
     STREAM DIRETO
     ------------------------------------------------------- */

  if (!upstream.body) {
    res.end();
    return;
  }

  try {
    const reader =
      upstream.body.getReader();

    req.on("close", async () => {
      try {
        await reader.cancel();
      } catch {}
    });

    while (true) {
      const {
        done,
        value
      } = await reader.read();

      if (done) {
        break;
      }

      if (res.destroyed) {
        break;
      }

      if (value) {
        res.write(
          Buffer.from(value)
        );
      }
    }

    if (!res.destroyed) {
      res.end();
    }
  } catch (error) {
    console.error(
      "⚠️ Erro durante streaming:",
      error.message
    );

    if (!res.destroyed) {
      res.destroy();
    }
  }
}

/* =========================================================
   SERVIDOR
   ========================================================= */

const server = http.createServer(
  async (req, res) => {
    adicionarHeadersBase(res);

    /* -----------------------------------------------------
       OPTIONS
       ----------------------------------------------------- */

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    /* -----------------------------------------------------
       GET / HEAD
       ----------------------------------------------------- */

    if (
      req.method !== "GET" &&
      req.method !== "HEAD"
    ) {
      res.writeHead(405, {
        "Content-Type":
          "text/plain; charset=utf-8"
      });

      res.end(
        "Método não permitido."
      );

      return;
    }

    const url = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    );

    const pathname = url.pathname;

    /* -----------------------------------------------------
       /
       ----------------------------------------------------- */

    if (pathname === "/") {
      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport"
content="width=device-width,initial-scale=1">
<title>Chiru-san IPTV</title>
</head>

<body>

<h1>Chiru-san IPTV</h1>

<p>Servidor online.</p>

<p>Vídeos disponíveis: ${videos.length}</p>

<p>
<a href="/playlist.m3u">
Abrir playlist M3U
</a>
</p>

</body>
</html>`;

      res.writeHead(200, {
        "Content-Type":
          "text/html; charset=utf-8",

        "Content-Length":
          Buffer.byteLength(html)
      });

      res.end(html);

      return;
    }

    /* -----------------------------------------------------
       /playlist.m3u
       ----------------------------------------------------- */

    if (pathname === "/playlist.m3u") {
      const host =
        req.headers.host ||
        `${DYNU_HOSTNAME}:${PORT}`;

      const m3u =
        gerarM3U(host);

      res.writeHead(200, {
        "Content-Type":
          "audio/x-mpegurl; charset=utf-8",

        "Content-Length":
          Buffer.byteLength(m3u),

        "Cache-Control":
          "no-cache"
      });

      res.end(m3u);

      return;
    }

    /* -----------------------------------------------------
       /video/:id
       ----------------------------------------------------- */

    if (
      pathname.startsWith("/video/")
    ) {
      const id =
        decodeURIComponent(
          pathname.slice(
            "/video/".length
          )
        );

      const video =
        encontrarVideo(id);

      if (!video) {
        res.writeHead(404, {
          "Content-Type":
            "text/plain; charset=utf-8"
        });

        res.end(
          "Vídeo não encontrado."
        );

        return;
      }

      await transmitirVideo(
        req,
        res,
        video
      );

      return;
    }

    /* -----------------------------------------------------
       404
       ----------------------------------------------------- */

    res.writeHead(404, {
      "Content-Type":
        "text/plain; charset=utf-8"
    });

    res.end(
      "404 - Não encontrado."
    );
  }
);

/* =========================================================
   INICIAR IPV6
   ========================================================= */

server.listen(
  {
    host: HOST,
    port: PORT,
    ipv6Only: true
  },

  async () => {
    console.log("");
    console.log(
      "╔══════════════════════════════════════╗"
    );
    console.log(
      "║       CHIRU-SAN IPTV SERVER          ║"
    );
    console.log(
      "╚══════════════════════════════════════╝"
    );
    console.log("");

    console.log(
      `📡 Servidor IPv6: [${HOST}]:${PORT}`
    );

    console.log(
      `📺 Playlist: http://${DYNU_HOSTNAME}:${PORT}/playlist.m3u`
    );

    console.log(
      `🎬 Vídeos: http://${DYNU_HOSTNAME}:${PORT}/video/<id>`
    );

    console.log("");

    console.log(
      "🌐 Atualizando IPv6/Dynu..."
    );

    await atualizarIPv6();

    console.log("");
    console.log(
      "✅ Servidor pronto."
    );
    console.log("");
  }
);

/* =========================================================
   VERIFICAR IPV6 A CADA 5 MINUTOS
   ========================================================= */

setInterval(
  async () => {
    console.log("");
    console.log(
      "🔄 Verificando IPv6 público..."
    );

    await atualizarIPv6();
  },
  5 * 60 * 1000
);

/* =========================================================
   ERROS
   ========================================================= */

server.on(
  "error",
  (error) => {
    console.error(
      "❌ Erro no servidor:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "❌ uncaughtException:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "❌ unhandledRejection:",
      error
    );
  }
);
