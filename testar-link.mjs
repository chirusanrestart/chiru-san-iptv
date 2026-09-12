import fs from "fs";

const videos = JSON.parse(fs.readFileSync("videos.json", "utf8"));
const url = videos[0].url;

console.log("🔗 Testando vídeo 1...");
console.log("📡 URL:", url);

const response = await fetch(url, {
    headers: {
        Range: "bytes=0-1023"
    }
});

console.log("\n📊 Resultado:");
console.log("Status:", response.status);
console.log("Content-Type:", response.headers.get("content-type"));
console.log("Content-Length:", response.headers.get("content-length"));
console.log("Content-Range:", response.headers.get("content-range"));
