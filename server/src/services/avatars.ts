/** Аватарки пользователей: приём (самообслуживание), отдача, удаление
 *  (миграция 027). Тот же приём, что services/attachments.ts (guard по первым
 *  байтам, storage.put() ДО записи в БД, best-effort чистка при отказе), но
 *  без отдельной таблицы: одна аватарка на пользователя — три колонки на users.
 */
import { Readable } from "node:stream";
import { one, q } from "../db.js";
import { loadConfig } from "../config.js";
import { ApiHttpError } from "../errors.js";
import { getStorage, newAvatarStorageKey } from "./storage.js";
import { checkUpload, extOf, sanitizeFilename, HEAD_BYTES } from "./fileGuard.js";
import { invalidateUserCache } from "../middleware.js";

// Кэш драйвера — общий с attachments/maintenance (см. getStorage() в storage.ts).
const storage = () => getStorage(loadConfig());

/** Только эти три — единственные растровые форматы, которые fileGuard.sniff()
 *  сегодня умеет опознавать по magic-байтам (webp туда сознательно не входит,
 *  расширение сигнатур — отдельная задача, не эта). */
const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "gif"]);
const ALLOWED_SIG = new Set(["png", "jpeg", "gif"]);

const AVATAR_MAX_FILENAME = 100;

export interface UploadPart {
  file: Readable & { truncated?: boolean };
  filename: string;
  mimetype: string;
}

const rejected = (reason: string): never => {
  throw new ApiHttpError(400, "AVATAR_REJECTED", reason);
};

const tooLarge = (max: number): never => {
  throw new ApiHttpError(413, "AVATAR_TOO_LARGE", `Аватарка больше допустимого размера (${max} байт)`);
};

/** Читает первые n байт потока, НЕ разрушая его — копия readHead из
 *  services/attachments.ts (нужна и там, и здесь; выносить в третий модуль
 *  ради 20 строк не стоило). */
function readHead(src: Readable, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let len = 0;
    const cleanup = (): void => {
      src.off("readable", onReadable);
      src.off("end", onDone);
      src.off("error", onError);
    };
    const onDone = (): void => {
      cleanup();
      src.pause();
      resolve(Buffer.concat(chunks));
    };
    const onError = (e: Error): void => {
      cleanup();
      reject(e);
    };
    const onReadable = (): void => {
      let chunk: Buffer | null;
      while ((chunk = src.read() as Buffer | null) !== null) {
        chunks.push(chunk);
        len += chunk.length;
        if (len >= n) return onDone();
      }
    };
    src.on("readable", onReadable);
    src.on("end", onDone);
    src.on("error", onError);
  });
}

/** Принять новую аватарку пользователя, заменяя прежнюю (если была). */
export async function uploadAvatar(args: { userId: string; part: UploadPart }): Promise<{ avatarUpdatedAt: number }> {
  const cfg = loadConfig().storage;
  const { userId, part } = args;

  let head: Buffer;
  try {
    head = await readHead(part.file, HEAD_BYTES);
  } catch (e) {
    if ((e as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") tooLarge(cfg.avatarMaxBytes);
    throw e;
  }

  const filename = sanitizeFilename(part.filename, AVATAR_MAX_FILENAME);
  if (!ALLOWED_EXT.has(extOf(filename))) {
    rejected("Аватарка: разрешены только PNG, JPG или GIF");
  }
  // blockExt=[] — расширение уже сверено allowlist'ом выше; checkUpload всё
  // равно безусловно отсекает исполняемые/скриптовые сигнатуры и даёт нам
  // sniffed для проверки "содержимое реально картинка, а не переименованный
  // произвольный файл с разрешённым расширением".
  const guard = checkUpload({ filename, head, maxFilename: AVATAR_MAX_FILENAME, blockExt: [] });
  if (!ALLOWED_SIG.has(guard.sniffed)) {
    rejected("Содержимое файла не распознано как PNG/JPG/GIF");
  }

  // Ручной потолок размера: глобальный multipart-лимит (@fastify/multipart,
  // app.ts) рассчитан на обычные вложения и заметно больше avatarMaxBytes —
  // truncated от него здесь не сработает, поэтому считаем сами и обрываем
  // поток пораньше (аккуратно, без throw изнутри генератора).
  let size = 0;
  let overLimit = false;
  const body = Readable.from(
    (async function* () {
      size += head.length;
      if (size > cfg.avatarMaxBytes) {
        overLimit = true;
        return;
      }
      yield head;
      for await (const chunk of part.file as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > cfg.avatarMaxBytes) {
          overLimit = true;
          return;
        }
        yield chunk;
      }
    })(),
  );

  const key = newAvatarStorageKey(userId);
  const store = await storage();
  try {
    await store.put(key, body, { contentType: guard.contentType, size: 0 });
  } catch (e) {
    await store.delete(key).catch(() => undefined);
    if ((e as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE" || part.file.truncated) tooLarge(cfg.avatarMaxBytes);
    throw e;
  }
  if (overLimit || part.file.truncated) {
    await store.delete(key).catch(() => undefined);
    tooLarge(cfg.avatarMaxBytes);
  }
  if (size === 0) {
    await store.delete(key).catch(() => undefined);
    rejected("Пустой файл (0 байт) — нечего загружать");
  }

  const prev = await one<{ avatar_key: string | null }>(`SELECT avatar_key FROM users WHERE id = $1`, [userId]);

  let row: { avatar_updated_at: Date };
  try {
    row = (
      await q<{ avatar_updated_at: Date }>(
        `UPDATE users
            SET avatar_driver = $2, avatar_key = $3, avatar_content_type = $4, avatar_updated_at = now()
          WHERE id = $1
        RETURNING avatar_updated_at`,
        [userId, cfg.driver, key, guard.contentType],
      )
    )[0];
  } catch (e) {
    // UPDATE упал — объект уже в хранилище, снимаем, чтобы не плодить сирот
    // (тот же приём, что services/attachments.ts при отказе INSERT).
    await store.delete(key).catch(() => undefined);
    throw e;
  }

  if (prev?.avatar_key && prev.avatar_key !== key) {
    await store.delete(prev.avatar_key).catch(() => undefined);
  }
  invalidateUserCache(userId);
  return { avatarUpdatedAt: row.avatar_updated_at.getTime() };
}

/** Снять аватарку (если была). Идемпотентно. */
export async function removeAvatar(userId: string): Promise<void> {
  const row = await one<{ avatar_key: string | null }>(`SELECT avatar_key FROM users WHERE id = $1`, [userId]);
  if (!row?.avatar_key) return;
  await q(
    `UPDATE users SET avatar_driver = NULL, avatar_key = NULL, avatar_content_type = NULL, avatar_updated_at = NULL WHERE id = $1`,
    [userId],
  );
  await (await storage()).delete(row.avatar_key).catch(() => undefined);
  invalidateUserCache(userId);
}

/** Ключ + content-type для отдачи GET /users/:id/avatar, либо null — нет аватарки. */
export async function getAvatarMeta(userId: string): Promise<{ key: string; contentType: string } | null> {
  const row = await one<{ avatar_key: string | null; avatar_content_type: string | null }>(
    `SELECT avatar_key, avatar_content_type FROM users WHERE id = $1`,
    [userId],
  );
  if (!row?.avatar_key) return null;
  return { key: row.avatar_key, contentType: row.avatar_content_type ?? "application/octet-stream" };
}

export async function openAvatar(key: string): Promise<Readable> {
  return (await storage()).get(key);
}
