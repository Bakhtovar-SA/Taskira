/** Хранилище объектов для вложений к задачам (FILES_MIGRATION.md D1).
 *
 *  Абстракция над физическим бэкендом: остальной код (services/attachments,
 *  routes/attachments) работает только с интерфейсом `Storage` и не знает,
 *  диск это или S3.
 *
 *    STORAGE_DRIVER=local (деф.) — LocalDiskStorage: файлы в config.storage.dir.
 *    STORAGE_DRIVER=s3           — S3Storage поверх S3-совместимого API
 *                                  (MinIO / on-prem, @aws-sdk/client-s3).
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, access } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, sep } from "node:path";
import type { Readable } from "node:stream";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Config, S3Config } from "../config.js";

export interface StoredObject {
  /** Размер объекта в байтах. */
  size: number;
  /** S3: `ETag` из `HeadObject`. Для однокусочного PUT — hex-MD5 тела; для
   *  multipart-загрузки — вида `"<md5>-<число частей>"`. Драйвер `local` — undefined. */
  etag?: string;
  /** S3: `Content-Type`, сохранённый при PUT (round-trip метаданных). Драйвер
   *  `local` — undefined (тип отдаётся из строки `attachments`). */
  contentType?: string;
}

export interface Storage {
  /** Записать поток под ключом. Существующий объект перезаписывается. */
  put(key: string, data: Readable, meta: { contentType: string; size: number }): Promise<void>;
  /** Поток на чтение. Бросает, если объекта нет (роут до этого уже сверил строку в БД). */
  get(key: string): Promise<Readable>;
  /** Удалить объект. Отсутствующий объект — не ошибка (идемпотентно). */
  delete(key: string): Promise<void>;
  /** Метаданные объекта, либо null — объекта нет. */
  stat(key: string): Promise<StoredObject | null>;
}

/** Ключ объекта: <issueId>/<uuid>. Из имени файла НЕ строится (D3). */
export function newStorageKey(issueId: string): string {
  return `${issueId}/${randomUUID()}`;
}

/** Ключи мы генерируем сами (newStorageKey), но раскладка ключа в путь на диске
 *  всё равно защищается от обхода каталога — на случай будущих вызовов. */
function keyToRelPath(key: string): string {
  const parts = key.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === "." || p === ".." || p.includes("\0"))) {
    throw new Error(`storage: недопустимый ключ ${JSON.stringify(key)}`);
  }
  return parts.join(sep);
}

class LocalDiskStorage implements Storage {
  constructor(private readonly root: string) {}

  private full(key: string): string {
    return join(this.root, keyToRelPath(key));
  }

  /** Каталог существует и доступен на запись — вызывается один раз из makeStorage. */
  async ensureReady(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    try {
      await access(this.root, FS.W_OK);
    } catch {
      throw new Error(`storage: каталог ${this.root} недоступен на запись (STORAGE_DIR)`);
    }
  }

  async put(key: string, data: Readable, _meta: { contentType: string; size: number }): Promise<void> {
    const dest = this.full(key);
    await mkdir(dirname(dest), { recursive: true });
    // временный файл + атомарный rename: оборванная загрузка не оставляет
    // недописанный объект под финальным ключом (FILES_MIGRATION.md §5).
    const tmp = `${dest}.${randomUUID()}.tmp`;
    try {
      await pipeline(data, createWriteStream(tmp, { flags: "wx" }));
      await rename(tmp, dest);
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
  }

  async get(key: string): Promise<Readable> {
    return createReadStream(this.full(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.full(key), { force: true });
  }

  async stat(key: string): Promise<StoredObject | null> {
    try {
      const s = await stat(this.full(key));
      return { size: s.size };
    } catch {
      return null;
    }
  }
}

/** S3-совместимое хранилище (MinIO / on-prem). Загрузка идёт через
 *  `@aws-sdk/lib-storage` `Upload` — сам решает PutObject vs multipart по
 *  размеру потока (порог `partSize`, деф. 5 MiB). */
class S3Storage implements Storage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(s3: S3Config) {
    this.bucket = s3.bucket;
    this.client = new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      forcePathStyle: s3.forcePathStyle,
      credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
    });
  }

  async put(key: string, data: Readable, meta: { contentType: string; size: number }): Promise<void> {
    const up = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: data, ContentType: meta.contentType },
    });
    await up.done();
  }

  async get(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`s3: пустое тело для ${key}`);
    return res.Body as unknown as Readable;
  }

  async delete(key: string): Promise<void> {
    // DeleteObject в S3 идемпотентен — отсутствующий ключ не ошибка.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async stat(key: string): Promise<StoredObject | null> {
    try {
      const h = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: h.ContentLength ?? 0, etag: h.ETag, contentType: h.ContentType };
    } catch (e) {
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === "NotFound" || err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
}

/** Фабрика: собирает драйвер по config.storage. Для local — гарантирует, что
 *  каталог готов (mkdir + проверка записи). */
export async function makeStorage(cfg: Config): Promise<Storage> {
  if (cfg.storage.driver === "s3") {
    if (!cfg.storage.s3) throw new Error("STORAGE_DRIVER=s3, но параметры S3 не заданы");
    return new S3Storage(cfg.storage.s3);
  }
  const local = new LocalDiskStorage(cfg.storage.dir);
  await local.ensureReady();
  return local;
}
