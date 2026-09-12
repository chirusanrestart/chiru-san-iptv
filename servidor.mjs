import express from "express";
import fs from "fs";

const app = express();
const PORT = 3000;

const videos = JSON.parse(
    fs.readFileSync("videos.json", "utf8")
);

app.get("/", (req, res) => {
    res.send(`
        <h1>📺 Chiru-san IPTV</h1>
        <p>🎬 Vídeos: ${videos.length}</p>
        <p><a href="/playlist.m3u">📡 Abrir playlist M3U</a></p>
    `);
});

app.get("/playlist.m3u", (req, res) => {
    let m3u = "#EXTM3U\n\n";

    for (const video of videos) {
        m3u += `#EXTINF:-1,Chiru-san Vídeo ${video.id}\n`;
        m3u += `${video.url}\n`;
    }

    res.type("audio/x-mpegurl");
    res.send(m3u);
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("📺 Chiru-san IPTV");
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`🎬 Vídeos: ${videos.length}`);
});
