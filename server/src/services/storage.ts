/** Хранилище объектов для вложений к задачам (FILES_MIGRATION.md D1).
 *
 *  Абстракция над физическим бэкендом: остальной код (services/attachments,
 *  routes/attachments — Фаза 2) работает только с интерфейсом `Storage` и не
 *  знает, диск это или S3.
 *
 *    STORAGE_DRIVER=local (деф.) — LocalDiskStorage: файлы в config.storage.dir.
 *    STORAGE_DRIVER=s3           — S3Storage поверх S3-совместимого API
 *                                  (MinIO / on-prem). Реализация — Фаза 4.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, access } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, sep } from "node:path";
import type { Readable } from "node:stream";
import type { Config } from "../config.js";

export interface StoredObject {
  /** Размер объекта в байтах. content_type хранит строка attachments, не бэкенд. */
  size: number;
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

/** Заглушка до Фазы 4 — S3Storage поверх @aws-sdk/client-s3. */
class S3StorageStub implements Storage {
  private fail(): never {
    throw new Error("S3Storage ещё не реализован (FILES_MIGRATION.md Фаза 4) — используйте STORAGE_DRIVER=local");
  }
  put(): Promise<void> {
    this.fail();
  }
  get(): Promise<Readable> {
    this.fail();
  }
  delete(): Promise<void> {
    this.fail();
  }
  stat(): Promise<StoredObject | null> {
    this.fail();
  }
}

/** Фабрика: собирает драйвер по config.storage. Для local — гарантирует, что
 *  каталог готов (mkdir + проверка записи). */
export async function makeStorage(cfg: Config): Promise<Storage> {
  if (cfg.storage.driver === "s3") return new S3StorageStub();
  const local = new LocalDiskStorage(cfg.storage.dir);
  await local.ensureReady();
  return local;
}
