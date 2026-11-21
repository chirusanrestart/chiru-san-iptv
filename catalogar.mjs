import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchImageUrls } from "@marcus5914/google-photos-album-image-url-fetch";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ALBUM_URL = process.env.GOOGLE_PHOTOS_ALBUM_URL || "https://photos.app.goo.gl/ieE9pLKupTC7TxFU6";
const VIDEOS_FILE = path.join(ROOT, "data", "videos.json");

export async function refreshCatalog() {
  console.log("☁️ Consultando álbum do Google Fotos...");
  const items = await fetchImageUrls(ALBUM_URL);

  if (!Array.isArray(items)) {
    throw new TypeError("O extrator não retornou uma lista válida.");
  }

  const videos = items
    .filter((item) => item?.isVideo && item?.videoUrl)
    .map((item, index) => ({
      id: String(item.uid || index + 1),
      uid: item.uid ?? null,
      title: item.filename || item.name || `Vídeo ${index + 1}`,
      url: item.videoUrl,
      poster: item.posterUrl || null,
      width: item.width ?? null,
      height: item.height ?? null,
      duration: Number(item.duration || item.durationSeconds || 0) || null,
      imageUpdateDate: item.imageUpdateDate ?? null,
      albumAddDate: item.albumAddDate ?? null
    }));

  if (videos.length === 0) {
    throw new Error("Nenhum vídeo com URL reproduzível foi encontrado. O catálogo anterior foi preservado.");
  }

  await fs.mkdir(path.dirname(VIDEOS_FILE), { recursive: true });
  const temporaryFile = `${VIDEOS_FILE}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(videos, null, 2) + "\n", "utf8");
  await fs.rename(temporaryFile, VIDEOS_FILE);

  console.log(`📦 Itens encontrados: ${items.length}`);
  console.log(`🎬 Vídeos catalogados: ${videos.length}`);
  console.log("💾 Catálogo atualizado em data/videos.json");
  return videos;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  refreshCatalog().catch((error) => {
    console.error("❌ Falha ao atualizar catálogo:", error);
    process.exitCode = 1;
  });
}
