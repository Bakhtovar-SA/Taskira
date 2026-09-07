/**
 * S3-хранилище против НАСТОЯЩЕГО MinIO (не заглушки, не мока).
 * Запускается только при STORAGE_DRIVER=s3 + STORAGE_S3_* (иначе describe.skip):
 *   - CI: job `storage-s3` в .github/workflows/test.yml (docker compose MinIO);
 *   - локально: docker compose -f docker-compose.storage.yml up -d
 *     + STORAGE_DRIVER=s3 и остальные STORAGE_S3_* → npm run test:storage.
 *
 * Проверяет то, чего LocalDiskStorage / in-memory мок воспроизвести НЕ могут:
 *   - ETag однокусочного PUT = hex-MD5 тела (гарантия протокола S3);
 *   - большой объект уходит настоящим multipart-upload → ETag вида <md5>-<N>;
 *   - Content-Type переживает round-trip в метаданных объекта;
 *   - GET отсутствующего ключа → ошибка NoSuchKey (а не ENOENT диска).
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { initConfig, loadConfig } from "../src/config.js";
import { makeStorage, newStorageKey, type Storage } from "../src/services/storage.js";

const RUN = process.env.STORAGE_DRIVER === "s3" && !!process.env.STORAGE_S3_ENDPOINT;
const d = RUN ? describe : describe.skip;

const md5hex = (b: Buffer): string => createHash("md5").update(b).digest("hex");
const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const unquote = (s: string | undefined): string => (s ?? "").replace(/"/g, "");

d("S3-хранилище против настоящего MinIO (STORAGE_DRIVER=s3)", () => {
  let s: Storage;
  const keys: string[] = [];
  const mkKey = (issue = "s3test"): string => {
    const k = newStorageKey(issue);
    keys.push(k);
    return k;
  };

  beforeAll(async () => {
    initConfig();
    s = await makeStorage(loadConfig());
  });
  afterAll(async () => {
    for (const k of keys) await s.delete(k).catch(() => undefined);
  });

  test("однокусочный PUT: ETag == hex-MD5 тела (гарантия S3 — мок бы её не дал)", async () => {
    const body = Buffer.from(`small object ${randomUUID()}`);
    const k = mkKey();
    await s.put(k, Readable.from(body), { contentType: "text/plain", size: body.length });

    const st = await s.stat(k);
    expect(st).not.toBeNull();
    expect(st!.size).toBe(body.length);
    expect(unquote(st!.etag)).toMatch(/^[0-9a-f]{32}$/); // ровно MD5, без суффикса
    expect(unquote(st!.etag)).toBe(md5hex(body)); // и это ИМЕННО MD5 тела
    console.log(`[s3] однокусочный PUT (${body.length} Б): ETag=${st!.etag}  == md5(body)=${md5hex(body)}`);
  });

  test("большой объект (>5 MiB) идёт настоящим multipart-upload → ETag вида <md5>-<N>", async () => {
    const size = 6 * 1024 * 1024 + 123; // > partSize (5 MiB) ⇒ минимум 2 части
    const body = Buffer.alloc(size, 0x61);
    const k = mkKey();
    await s.put(k, Readable.from(body), { contentType: "application/octet-stream", size });

    const st = await s.stat(k);
    const etag = unquote(st!.etag);
    // именно этого заглушка/мок не покажет: реальный CompleteMultipartUpload
    expect(etag).toMatch(/^[0-9a-f]{32}-[0-9]+$/);
    const parts = Number(etag.split("-")[1]);
    expect(parts).toBeGreaterThanOrEqual(2);
    expect(etag).not.toBe(md5hex(body)); // НЕ простой MD5 всего тела
    expect(st!.size).toBe(size);

    // round-trip: то, что положили, то и читаем
    const back = await buffer(await s.get(k));
    expect(sha256(back)).toBe(sha256(body));
    console.log(
      `[s3] multipart-upload (${size} Б): ETag=${st!.etag} → ${parts} части; ` +
        `md5(всего тела)=${md5hex(body)} (ЭТО ДРУГОЕ — значит был CompleteMultipartUpload, не PutObject)`,
    );
  });

  test("Content-Type переживает round-trip в метаданных объекта (диск так не умеет)", async () => {
    const body = Buffer.from("<svg xmlns=''/>");
    const k = mkKey();
    await s.put(k, Readable.from(body), { contentType: "image/svg+xml", size: body.length });
    const st = await s.stat(k);
    expect(st!.contentType).toBe("image/svg+xml");
  });

  test("GET отсутствующего ключа → ошибка NoSuchKey (S3), не ENOENT", async () => {
    let err: unknown;
    try {
      await buffer(await s.get(`s3test/${randomUUID()}`));
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect((err as { name?: string }).name).toBe("NoSuchKey");
    console.log(`[s3] GET отсутствующего ключа → ошибка name=${(err as { name?: string }).name} (не ENOENT)`);
  });

  test("stat отсутствующего → null; delete отсутствующего → без ошибки (идемпотентно)", async () => {
    const k = `s3test/${randomUUID()}`;
    expect(await s.stat(k)).toBeNull();
    await expect(s.delete(k)).resolves.toBeUndefined();
  });
});
