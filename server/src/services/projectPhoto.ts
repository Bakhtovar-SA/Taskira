/** Фото фона проекта (ТЗ 5.14 п.2, миграция 20260928T1000). Клиент присылает два WebP (full ≤ 2560 px,
 *  small ≤ 800 px) и среднюю светлоту 0…1; сервер не перекодирует (нет нативных зависимостей), а только
 *  проверяет: сигнатура RIFF/WEBP, габариты из заголовка VP8/VP8L/VP8X, размер файла. Оба файла пишутся в
 *  хранилище ДО UPDATE, при отказе — удаляются (тот же приём, что services/avatars.ts). */
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { one, q } from "../db.js";
import { loadConfig } from "../config.js";
import { ApiHttpError } from "../errors.js";
import { getStorage } from "./storage.js";

export const PHOTO_LIMITS = {
  full: { maxSide: 2560, maxBytes: 1_500_000 },
  small: { maxSide: 800, maxBytes: 300_000 },
  minSide: 64,
} as const;

const storage = () => getStorage(loadConfig());
const rejected = (reason: string): never => {
  throw new ApiHttpError(400, "PHOTO_REJECTED", reason);
};

/** Ширина и высота WebP из заголовка; null — не WebP или повреждён. */
export function webpSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

export function checkPhoto(buf: Buffer, size: "full" | "small"): void {
  const lim = PHOTO_LIMITS[size];
  if (buf.length === 0) rejected("Пустой файл");
  if (buf.length > lim.maxBytes) throw new ApiHttpError(413, "PHOTO_TOO_LARGE", `Фото больше ${Math.round(lim.maxBytes / 1000)} КБ`);
  const dim = webpSize(buf);
  if (!dim) rejected("Ожидается изображение WebP");
  const { width, height } = dim!;
  if (Math.max(width, height) > lim.maxSide || Math.min(width, height) < PHOTO_LIMITS.minSide) {
    rejected(`Габариты ${width}×${height} вне допустимых (${PHOTO_LIMITS.minSide}…${lim.maxSide} px)`);
  }
}

export async function setProjectPhoto(projectId: string, files: { full: Buffer; small: Buffer }, luma: number): Promise<number> {
  checkPhoto(files.full, "full");
  checkPhoto(files.small, "small");
  if (!Number.isFinite(luma) || luma < 0 || luma > 1) rejected("Светлота — число от 0 до 1");
  const cfg = loadConfig().storage;
  const store = await storage();
  const id = randomUUID();
  const keys = { full: `project-bg/${projectId}/${id}-full`, small: `project-bg/${projectId}/${id}-small` };
  const put = (key: string, buf: Buffer) => store.put(key, Readable.from([buf]), { contentType: "image/webp", size: buf.length });
  try {
    await put(keys.full, files.full);
    await put(keys.small, files.small);
  } catch (e) {
    await Promise.all(Object.values(keys).map((k) => store.delete(k).catch(() => undefined)));
    throw e;
  }
  const prev = await one<{ bg_photo_key: string | null; bg_photo_small_key: string | null }>(
    `SELECT bg_photo_key, bg_photo_small_key FROM projects WHERE id = $1`,
    [projectId],
  );
  let at: Date;
  try {
    at = (
      await q<{ bg_photo_updated_at: Date }>(
        `UPDATE projects SET bg_photo_driver = $2, bg_photo_key = $3, bg_photo_small_key = $4, bg_photo_luma = $5, bg_photo_updated_at = now()
          WHERE id = $1 RETURNING bg_photo_updated_at`,
        [projectId, cfg.driver, keys.full, keys.small, luma],
      )
    )[0].bg_photo_updated_at;
  } catch (e) {
    await Promise.all(Object.values(keys).map((k) => store.delete(k).catch(() => undefined)));
    throw e;
  }
  for (const k of [prev?.bg_photo_key, prev?.bg_photo_small_key]) if (k) await store.delete(k).catch(() => undefined);
  return at.getTime();
}

export async function removeProjectPhoto(projectId: string): Promise<void> {
  const row = await one<{ bg_photo_key: string | null; bg_photo_small_key: string | null }>(
    `SELECT bg_photo_key, bg_photo_small_key FROM projects WHERE id = $1`,
    [projectId],
  );
  if (!row?.bg_photo_key) return;
  await q(
    `UPDATE projects SET bg_photo_driver = NULL, bg_photo_key = NULL, bg_photo_small_key = NULL, bg_photo_luma = NULL, bg_photo_updated_at = NULL WHERE id = $1`,
    [projectId],
  );
  const store = await storage();
  for (const k of [row.bg_photo_key, row.bg_photo_small_key]) if (k) await store.delete(k).catch(() => undefined);
}

export async function openProjectPhoto(projectId: string, size: "full" | "small"): Promise<Readable | null> {
  const row = await one<{ bg_photo_key: string | null; bg_photo_small_key: string | null }>(
    `SELECT bg_photo_key, bg_photo_small_key FROM projects WHERE id = $1`,
    [projectId],
  );
  const key = size === "full" ? row?.bg_photo_key : row?.bg_photo_small_key;
  return key ? (await storage()).get(key) : null;
}
