import { fetchImageUrls } from "@marcus5914/google-photos-album-image-url-fetch";

const ALBUM_URL = "https://photos.app.goo.gl/ieE9pLKupTC7TxFU6";

const items = await fetchImageUrls(ALBUM_URL);

console.log("📦 Total de mídias:", items.length);

const videos = items.filter(item => item.isVideo);

console.log("🎬 Total de vídeos:", videos.length);

console.log("\n🔍 Dados completos do primeiro vídeo:\n");

console.dir(videos[0], { depth: null });
