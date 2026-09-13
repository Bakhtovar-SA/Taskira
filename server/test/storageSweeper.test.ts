/**
 * Сборщик осиротевших объектов Storage (ARCHITECTURE.md follow-up).
 * Фейковый in-memory Storage — реального диска/S3 не нужно, проверяем только
 * логику сравнения list() с attachments и грейс-период против гонки с загрузкой.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { getApp, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import { runStorageSweepOnce } from "../src/services/storageSweeper.js";
import type { Readable } from "node:stream";
import type { Storage, StoredObject } from "../src/services/storage.js";

class FakeStorage implements Storage {
  objects = new Map<string, number>(); // key -> mtimeMs
  deleted: string[] = [];
  /** Ключи, на которых delete() должен упасть — для теста устойчивости к частичным сбоям. */
  failOn = new Set<string>();

  async put(): Promise<void> {
    throw new Error("не используется в этих тестах");
  }
  async get(): Promise<Readable> {
    throw new Error("не используется в этих тестах");
  }
  async delete(key: string): Promise<void> {
    if (this.failOn.has(key)) throw new Error(`симулированный сбой удаления: ${key}`);
    this.objects.delete(key);
    this.deleted.push(key);
  }
  async stat(key: string): Promise<StoredObject | null> {
    return this.objects.has(key) ? { size: 1 } : null;
  }
  async list(): Promise<{ key: string; mtimeMs: number }[]> {
    return [...this.objects.entries()].map(([key, mtimeMs]) => ({ key, mtimeMs }));
  }
}

const HOUR = 60 * 60_000;
const GRACE = 24 * HOUR;

let app: FastifyInstance;
let fx: Fixture;

beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await stopApp();
});
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

const insertAttachment = (issueId: string, key: string) =>
  q(
    `INSERT INTO attachments (issue_id, uploaded_by, filename, content_type, byte_size, sha256, storage_driver, storage_key)
     VALUES ($1, $2, 'f.txt', 'text/plain', 10, 'deadbeef', 'local', $3)`,
    [issueId, fx.users.emp1, key],
  );

describe("runStorageSweepOnce", () => {
  test("пустое хранилище — ничего не делает и не трогает БД", async () => {
    const storage = new FakeStorage();
    const stats = await runStorageSweepOnce(storage, "local", GRACE);
    expect(stats).toEqual({ scanned: 0, orphaned: 0, deleted: 0, failed: 0 });
  });

  test("старый объект без строки в attachments — удаляется", async () => {
    const storage = new FakeStorage();
    storage.objects.set("issue1/old.bin", Date.now() - 48 * HOUR);

    const stats = await runStorageSweepOnce(storage, "local", GRACE);

    expect(stats).toEqual({ scanned: 1, orphaned: 1, deleted: 1, failed: 0 });
    expect(storage.deleted).toEqual(["issue1/old.bin"]);
  });

  test("свежий объект без строки в attachments — НЕ удаляется (грейс-период)", async () => {
    // Гонка с загрузкой: routes/attachments.ts пишет объект раньше INSERT —
    // объект младше грейса мог просто ещё не долиться до строки в БД.
    const storage = new FakeStorage();
    storage.objects.set("issue1/fresh.bin", Date.now() - HOUR);

    const stats = await runStorageSweepOnce(storage, "local", GRACE);

    expect(stats).toEqual({ scanned: 1, orphaned: 0, deleted: 0, failed: 0 });
    expect(storage.deleted).toEqual([]);
  });

  test("объект со строкой в attachments — не трогается, даже старый", async () => {
    const storage = new FakeStorage();
    storage.objects.set("issue1/real.bin", Date.now() - 48 * HOUR);
    await insertAttachment(fx.issues.p1issue, "issue1/real.bin");

    const stats = await runStorageSweepOnce(storage, "local", GRACE);

    expect(stats).toEqual({ scanned: 1, orphaned: 0, deleted: 0, failed: 0 });
    expect(storage.deleted).toEqual([]);
  });

  test("driver — часть ключа: объект s3 не спасает строка с driver=local", async () => {
    const storage = new FakeStorage();
    storage.objects.set("issue1/real.bin", Date.now() - 48 * HOUR);
    await insertAttachment(fx.issues.p1issue, "issue1/real.bin");

    // Сканируем как будто это s3-хранилище — известные ключи 'local' не в счёт.
    const stats = await runStorageSweepOnce(storage, "s3", GRACE);

    expect(stats).toEqual({ scanned: 1, orphaned: 1, deleted: 1, failed: 0 });
    expect(storage.deleted).toEqual(["issue1/real.bin"]);
  });

  test("смешанный набор: старые сироты удаляются, известные и свежие — нет", async () => {
    const storage = new FakeStorage();
    storage.objects.set("issue1/orphan-old.bin", Date.now() - 48 * HOUR);
    storage.objects.set("issue1/orphan-fresh.bin", Date.now() - HOUR);
    storage.objects.set("issue1/known.bin", Date.now() - 48 * HOUR);
    await insertAttachment(fx.issues.p1issue, "issue1/known.bin");

    const stats = await runStorageSweepOnce(storage, "local", GRACE);

    expect(stats).toEqual({ scanned: 3, orphaned: 1, deleted: 1, failed: 0 });
    expect(storage.deleted).toEqual(["issue1/orphan-old.bin"]);
  });

  test("сбой удаления одного объекта не обрывает удаление остальных в том же батче", async () => {
    const storage = new FakeStorage();
    storage.objects.set("issue1/fails.bin", Date.now() - 48 * HOUR);
    storage.objects.set("issue1/ok-1.bin", Date.now() - 48 * HOUR);
    storage.objects.set("issue1/ok-2.bin", Date.now() - 48 * HOUR);
    storage.failOn.add("issue1/fails.bin");

    const stats = await runStorageSweepOnce(storage, "local", GRACE);

    expect(stats).toEqual({ scanned: 3, orphaned: 3, deleted: 2, failed: 1 });
    expect(storage.deleted.sort()).toEqual(["issue1/ok-1.bin", "issue1/ok-2.bin"]);
  });
});
