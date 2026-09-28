/** ТЗ 5.14 п.2 — своё фото фона проекта: сервер проверяет тип (WebP по сигнатуре), габариты и размер, право
 *  editAppearance; отдаёт любому участнику; уборщик хранилища не считает файлы сиротами. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import { webpSize } from "../src/services/projectPhoto.js";
import { runStorageSweepOnce } from "../src/services/storageSweeper.js";
import { getStorage } from "../src/services/storage.js";
import { loadConfig } from "../src/config.js";
import type { ProjectDto } from "../src/contract.js";

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

/** Заголовок WebP (VP8X) нужных габаритов: сервер не декодирует картинку, а читает габариты из заголовка. */
function webp(width: number, height: number, pad = 64): Buffer {
  const b = Buffer.alloc(30 + pad);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WEBPVP8X", 8, "ascii");
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(0)]);

function form(parts: { name: string; data: Buffer | string }[]) {
  const boundary = `----taskira-photo-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const file = typeof p.data !== "string";
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"${file ? `; filename="${p.name}.webp"` : ""}\r\n${file ? "Content-Type: image/webp\r\n" : ""}\r\n`));
    chunks.push(typeof p.data === "string" ? Buffer.from(p.data) : p.data, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
const upload = async (user: string, parts: { name: string; data: Buffer | string }[]) => {
  const f = form(parts);
  return app.inject({ method: "POST", url: `/api/projects/${fx.projects.p1}/background-photo`, headers: { ...auth(await login(app, user)), ...f.headers }, payload: f.payload });
};
const good = () => [
  { name: "full", data: webp(1920, 1080) },
  { name: "small", data: webp(640, 360) },
  { name: "luma", data: "0.72" },
];

describe("фото фона проекта", () => {
  test("webpSize читает габариты VP8X, остальное — не WebP", () => {
    expect(webpSize(webp(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(webpSize(PNG)).toBeNull();
  });

  test("менеджер загружает; участник-наблюдатель получает файл; DTO — версия и светлота", async () => {
    const r = await upload("mgr1", good());
    expect(r.statusCode).toBe(200);
    const dto = JSON.parse(r.body) as ProjectDto;
    expect(dto.backgroundPhoto?.luma).toBeCloseTo(0.72, 2);
    const got = await app.inject({ url: `/api/projects/${fx.projects.p1}/background-photo/small`, headers: auth(await login(app, "viw1")) });
    expect(got.statusCode).toBe(200);
    expect(got.headers["content-type"]).toBe("image/webp");
    expect(got.rawPayload.equals(webp(640, 360))).toBe(true);
  });

  test("сотрудник — 403; не WebP, огромные габариты, нет второго размера, светлота вне 0…1 — 400", async () => {
    expect((await upload("emp1", good())).statusCode).toBe(403);
    expect((await upload("mgr1", [{ name: "full", data: PNG }, { name: "small", data: webp(640, 360) }, { name: "luma", data: "0.5" }])).statusCode).toBe(400);
    expect((await upload("mgr1", [{ name: "full", data: webp(8000, 4000) }, { name: "small", data: webp(640, 360) }, { name: "luma", data: "0.5" }])).statusCode).toBe(400);
    expect((await upload("mgr1", [{ name: "full", data: webp(1920, 1080) }, { name: "luma", data: "0.5" }])).statusCode).toBe(400);
    expect((await upload("mgr1", [{ name: "full", data: webp(1920, 1080) }, { name: "small", data: webp(640, 360) }, { name: "luma", data: "2" }])).statusCode).toBe(400);
    expect((await q(`SELECT 1 FROM projects WHERE id = $1 AND bg_photo_key IS NOT NULL`, [fx.projects.p1])).length).toBe(0);
  });

  test("уборщик хранилища не удаляет фото; снять фото — файлов и ссылки нет", async () => {
    await upload("mgr1", good());
    const cfg = loadConfig();
    // Grace 0: всё, что уборщик счёл бы сиротой, он удалил бы сразу — оба файла фото должны остаться.
    await runStorageSweepOnce(await getStorage(cfg), cfg.storage.driver, 0);
    const url = `/api/projects/${fx.projects.p1}/background-photo/full`;
    const tok = await login(app, "mgr1");
    expect((await app.inject({ url, headers: auth(tok) })).statusCode).toBe(200);
    expect((await app.inject({ url: url.replace(/full$/, "small"), headers: auth(tok) })).statusCode).toBe(200);
    const del = await app.inject({ method: "DELETE", url: `/api/projects/${fx.projects.p1}/background-photo`, headers: auth(await login(app, "mgr1")) });
    expect((JSON.parse(del.body) as ProjectDto).backgroundPhoto).toBeNull();
    expect((await app.inject({ url, headers: auth(await login(app, "mgr1")) })).statusCode).toBe(404);
  });
});
