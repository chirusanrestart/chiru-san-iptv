import fs from "fs";
import { fetchImageUrls } from "@marcus5914/google-photos-album-image-url-fetch";

const ALBUM_URL = "https://photos.app.goo.gl/ieE9pLKupTC7TxFU6";

console.log("☁️ Consultando Google Fotos...");

const items = await fetchImageUrls(ALBUM_URL);

const videos = items
    .filter(item => item.isVideo)
    .map((item, index) => ({
        id: index + 1,
        uid: item.uid,
        url: item.videoUrl,
        poster: item.posterUrl,
        width: item.width,
        height: item.height,
        imageUpdateDate: item.imageUpdateDate,
        albumAddDate: item.albumAddDate
    }));

fs.writeFileSync(
    "videos.json",
    JSON.stringify(videos, null, 2)
);

console.log(`📦 Mídias encontradas: ${items.length}`);
console.log(`🎬 Vídeos encontrados: ${videos.length}`);
console.log("💾 Catálogo salvo em videos.json");
