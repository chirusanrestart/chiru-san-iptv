import fs from "fs";

const videos = JSON.parse(fs.readFileSync("videos.json", "utf8"));
const url = videos[0].url;

console.log("📥 Baixando vídeo 1...");

const response = await fetch(url);

if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
}

const buffer = Buffer.from(await response.arrayBuffer());

fs.writeFileSync("video-teste.mp4", buffer);

console.log("✅ Download concluído!");
console.log("📦 Tamanho:", buffer.length, "bytes");
console.log("💾 Salvo como: video-teste.mp4");
