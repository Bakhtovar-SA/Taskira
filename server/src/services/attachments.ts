/** Вложения к задачам: список, приём (стрим + guard + sha256), удаление
 *  (FILES_MIGRATION.md D2/D3/D5, Фаза 2).
 *
 *  Импортит только db / config / storage / fileGuard / permissions — цикла с
 *  middleware нет.
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { one, q } from "../db.js";
import { loadConfig } from "../config.js";
import { ApiHttpError } from "../errors.js";
import { makeStorage, newStorageKey, type Storage } from "./storage.js";
import { checkUpload, HEAD_BYTES } from "./fileGuard.js";
import { roleCan, type AccessRole } from "../permissions.js";

/* -------- хранилище: одна ленивая инициализация на процесс -------- */
let storagePromise: Promise<Storage> | null = null;
function storage(): Promise<Storage> {
  if (!storagePromise) storagePromise = makeStorage(loadConfig());
  return storagePromise;
}
/** Только для тестов — сбросить закешированный драйвер (напр. смена STORAGE_DIR). */
export function _resetStorage(): void {
  storagePromise = null;
}

/* -------- DTO -------- */
interface AttachmentRow {
  id: string;
  issue_id: string;
  uploaded_by: string | null;
  filename: string;
  content_type: string;
  byte_size: string; // bigint -> строка в node-postgres
  sha256: string;
  storage_driver: string;
  storage_key: string;
  created_at: Date;
}

export interface AttachmentDto {
  id: string;
  issueId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  uploadedById: string | null;
  createdAt: string;
}

const toDto = (r: AttachmentRow): AttachmentDto => ({
  id: r.id,
  issueId: r.issue_id,
  filename: r.filename,
  contentType: r.content_type,
  byteSize: Number(r.byte_size),
  sha256: r.sha256,
  uploadedById: r.uploaded_by,
  createdAt: new Date(r.created_at).toISOString(),
});

const SELECT =
  `SELECT id, issue_id, uploaded_by, filename, content_type, byte_size, sha256, storage_driver, storage_key, created_at
     FROM attachments`;

export async function listAttachments(issueId: string): Promise<AttachmentDto[]> {
  const rows = await q<AttachmentRow>(`${SELECT} WHERE issue_id = $1 ORDER BY created_at`, [issueId]);
  return rows.map(toDto);
}

export async function countForIssue(issueId: string): Promise<number> {
  const row = await one<{ n: string }>(`SELECT count(*)::text AS n FROM attachments WHERE issue_id = $1`, [issueId]);
  return Number(row?.n ?? 0);
}

/** Одно вложение внутри конкретной задачи — иначе null (IDOR-сверка в роуте). */
export async function getAttachmentInIssue(issueId: string, attId: string): Promise<AttachmentRow | null> {
  return one<AttachmentRow>(`${SELECT} WHERE id = $1 AND issue_id = $2`, [attId, issueId]);
}

/** Ключи объектов всех вложений задачи — собрать ДО удаления задачи, чтобы
 *  подчистить хранилище (каскад FK снимет строки, но не файлы). */
export async function storageKeysForIssue(issueId: string): Promise<string[]> {
  const rows = await q<{ storage_key: string }>(`SELECT storage_key FROM attachments WHERE issue_id = $1`, [issueId]);
  return rows.map((r) => r.storage_key);
}

/** Best-effort снести объекты по ключам (после каскадного удаления строк). */
export async function deleteStorageObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const store = await storage();
  await Promise.all(keys.map((k) => store.delete(k).catch(() => undefined)));
}

/* -------- приём файла -------- */

/** Читает первые n байт потока, НЕ разрушая его (для magic-байт guard до записи).
 *  После вызова поток на паузе, прочитанное — в возвращённом буфере, остаток
 *  по-прежнему доступен для дальнейшего чтения. */
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

/** Минимум из @fastify/multipart, что нам нужен (без импорта типа плагина).
 *  `truncated` появляется на busboy-потоке при превышении limits.fileSize. */
export interface UploadPart {
  file: Readable & { truncated?: boolean };
  filename: string;
  mimetype: string;
}

const tooLarge = (max: number): never => {
  throw new ApiHttpError(413, "ATTACHMENT_TOO_LARGE", `Файл больше допустимого размера (${max} байт)`);
};

/** Принять файл: guard по первым байтам ДО записи, затем стрим в хранилище
 *  со счётом sha256 и размера. При отказе guard объект в хранилище не создаётся. */
export async function createAttachment(args: { issueId: string; userId: string; part: UploadPart }): Promise<AttachmentDto> {
  const cfg = loadConfig().storage;
  const { issueId, userId, part } = args;

  // Мягкий лимит: count-then-insert не атомарен, две параллельные загрузки у
  // самого потолка могут дать maxPerIssue+1. Это не граница безопасности —
  // жёсткая гарантия (advisory lock) не нужна.
  if ((await countForIssue(issueId)) >= cfg.maxPerIssue) {
    throw new ApiHttpError(409, "ATTACHMENT_LIMIT", `У задачи уже максимум вложений (${cfg.maxPerIssue})`);
  }

  // 1) первые байты -> guard (расширение, magic, несовпадение). Бросает 400.
  let head: Buffer;
  try {
    head = await readHead(part.file, HEAD_BYTES);
  } catch (e) {
    if ((e as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") tooLarge(cfg.maxBytes);
    throw e;
  }
  const guard = checkUpload({
    filename: part.filename,
    head,
    maxFilename: cfg.maxFilename,
    blockExt: cfg.blockExt,
  });

  // 2) полный поток = прочитанные байты + остаток; попутно sha256 + размер.
  const hash = createHash("sha256");
  let size = 0;
  const body = Readable.from(
    (async function* () {
      hash.update(head);
      size += head.length;
      yield head;
      for await (const chunk of part.file as AsyncIterable<Buffer>) {
        hash.update(chunk);
        size += chunk.length;
        yield chunk;
      }
    })(),
  );

  const key = newStorageKey(issueId);
  const store = await storage();
  try {
    await store.put(key, body, { contentType: guard.contentType, size: 0 });
  } catch (e) {
    await store.delete(key).catch(() => undefined);
    if ((e as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE" || part.file.truncated) tooLarge(cfg.maxBytes);
    throw e;
  }
  if (part.file.truncated) {
    await store.delete(key).catch(() => undefined);
    tooLarge(cfg.maxBytes);
  }
  // Пустой файл: CHECK (byte_size > 0) в схеме иначе уронил бы INSERT в 500,
  // а объект остался бы сиротой. Отсекаем явно и чистим хранилище.
  if (size === 0) {
    await store.delete(key).catch(() => undefined);
    throw new ApiHttpError(400, "ATTACHMENT_EMPTY", "Пустой файл (0 байт) — нечего прикреплять");
  }

  let row: AttachmentRow;
  try {
    row = (
      await q<AttachmentRow>(
        `INSERT INTO attachments
           (issue_id, uploaded_by, filename, content_type, byte_size, sha256, storage_driver, storage_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, issue_id, uploaded_by, filename, content_type, byte_size, sha256, storage_driver, storage_key, created_at`,
        [issueId, userId, guard.filename, guard.contentType, size, hash.digest("hex"), cfg.driver, key],
      )
    )[0];
  } catch (e) {
    // INSERT упал (гонка, транзиентная ошибка БД, нарушение CHECK) — объект в
    // хранилище уже записан, снимаем его, чтобы не плодить сирот.
    await store.delete(key).catch(() => undefined);
    throw e;
  }
  return toDto(row);
}

/** Поток на чтение объекта вложения (скачивание, D5). */
export async function openAttachment(row: { storage_key: string }): Promise<Readable> {
  return (await storage()).get(row.storage_key);
}

/* -------- удаление (правило D2) -------- */

/** Может ли пользователь удалить это вложение: свой файл — всегда; чужой —
 *  только по праву delete (admin/manager). */
export function canDeleteAttachment(row: { uploaded_by: string | null }, userId: string, role: AccessRole | null): boolean {
  return row.uploaded_by === userId || roleCan(role, "delete");
}

/** Удалить строку + best-effort снести объект. Права проверяет роут. */
export async function deleteAttachment(row: AttachmentRow): Promise<void> {
  await q(`DELETE FROM attachments WHERE id = $1`, [row.id]);
  await (await storage())
    .delete(row.storage_key)
    .catch(() => undefined); // объект-сирота подберёт сборщик (Фаза 6)
}
