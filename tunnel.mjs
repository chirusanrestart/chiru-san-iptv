import http from "node:http";
import https from "node:https";

const [videoIdArg] = process.argv.slice(2);
if (!videoIdArg) {
  console.error("Uso: npm run tunnel -- <id-do-video>");
  process.exit(1);
}

const videoId = String(videoIdArg);
const streamId = String(process.env.TUNNEL_STREAM_ID || videoId);
if (!/^[A-Za-z0-9._-]{1,128}$/.test(streamId) || streamId === "." || streamId === "..") {
  console.error("TUNNEL_STREAM_ID inválido. Use letras, números, ponto, hífen ou sublinhado.");
  process.exit(1);
}

const port = Number(process.env.PORT || 18080);
const sourceUrl = new URL(`/video/${encodeURIComponent(videoId)}`, `http://127.0.0.1:${port}`);
const relayBase = process.env.TUNNEL_RELAY_URL || "https://melissa-iptv.hostless.app";
const relayUrl = new URL(`/enviar/${encodeURIComponent(streamId)}`, relayBase);
const receiverUrl = new URL(`/receber/${encodeURIComponent(streamId)}`, relayBase);

const sourceTransport = sourceUrl.protocol === "https:" ? https : http;
const relayTransport = relayUrl.protocol === "https:" ? https : http;

console.log("📡 Chiru-san IPTV Tunnel");
console.log(`🎬 Origem Termux: ${sourceUrl.href}`);
console.log(`🌐 Player/receiver: ${receiverUrl.href}`);
console.log("⏳ Aguardando o player conectar ao receiver...");

let uploadRequest;
let sourceRequest;

function stop(error) {
  if (error) console.error("❌ Túnel encerrado:", error.message);
  if (sourceRequest && !sourceRequest.destroyed) sourceRequest.destroy();
  if (uploadRequest && !uploadRequest.destroyed) uploadRequest.destroy();
}

sourceRequest = sourceTransport.get(sourceUrl, (sourceResponse) => {
  if (sourceResponse.statusCode < 200 || sourceResponse.statusCode >= 300) {
    console.error(`❌ Servidor Termux respondeu HTTP ${sourceResponse.statusCode}`);
    sourceResponse.resume();
    process.exitCode = 1;
    return;
  }

  const headers = {
    "content-type": sourceResponse.headers["content-type"] || "application/octet-stream"
  };
  if (sourceResponse.headers["content-length"]) {
    headers["content-length"] = sourceResponse.headers["content-length"];
  }

  uploadRequest = relayTransport.request(relayUrl, { method: "POST", headers }, (response) => {
    console.log(`📨 Relay finalizou com HTTP ${response.statusCode}`);
    response.resume();
    response.on("end", () => {
      if (response.statusCode < 200 || response.statusCode >= 300) process.exitCode = 1;
    });
  });

  uploadRequest.on("error", (error) => {
    if (error.code !== "ECONNRESET") process.exitCode = 1;
    stop(error);
  });
  sourceResponse.on("error", stop);
  sourceResponse.on("aborted", () => stop(new Error("A origem interrompeu o envio.")));
  sourceResponse.pipe(uploadRequest);
});

sourceRequest.on("error", (error) => {
  console.error("❌ Não foi possível acessar o servidor Termux:", error.message);
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stop();
    process.exit(0);
  });
}
