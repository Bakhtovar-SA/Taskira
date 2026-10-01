/** ТЗ 5.14 п.5 — брендирование инсталляции: чтение публично (экран входа), запись — глобальный администратор;
 *  оттенок только из проверенного диапазона; знак — PNG/WebP по сигнатуре, не SVG; экспорт содержит бренд, но
 *  не ключ лицензии. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp } from "./helpers.js";
import { BRAND_HUE, type BrandDto } from "../src/contract.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await getApp();
});
afterAll(async () => {
  await stopApp();
});
beforeEach(async () => {
  await resetDb();
  await seedFixture();
  await q(`INSERT INTO instance (id, name) VALUES (1, 'Acme') ON CONFLICT (id) DO UPDATE SET brand_transparency = 'auto', brand_name = NULL, brand_hue = NULL, brand_logo_key = NULL, brand_logo_driver = NULL, brand_logo_updated_at = NULL`);
});

const png = (w: number, h: number) => {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
function form(filename: string, data: Buffer) {
  const boundary = `----taskira-brand-${Math.random().toString(16).slice(2)}`;
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  return { payload: Buffer.concat([Buffer.from(head), data, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
const brand = async () => JSON.parse((await app.inject({ url: "/api/instance/brand" })).body) as BrandDto;

describe("брендирование", () => {
  test("чтение без входа; по умолчанию ничего не задано", async () => {
    expect(await brand()).toEqual({ name: null, hue: null, logoUpdatedAt: null, transparencyDefault: "auto" });
  });

  test("админ задаёт название и оттенок; не админ — 403; оттенок вне диапазона — 400", async () => {
    const adm = await login(app, "admin");
    const ok = await app.inject({ method: "PATCH", url: "/api/admin/brand", headers: auth(adm), payload: { name: "Acme Tasks", hue: 300 } });
    expect(ok.statusCode).toBe(200);
    expect(await brand()).toMatchObject({ name: "Acme Tasks", hue: 300 });
    const mgr = await login(app, "mgr1");
    expect((await app.inject({ method: "PATCH", url: "/api/admin/brand", headers: auth(mgr), payload: { name: "X" } })).statusCode).toBe(403);
    for (const hue of [BRAND_HUE.min - 1, BRAND_HUE.max + 1, 120])
      expect((await app.inject({ method: "PATCH", url: "/api/admin/brand", headers: auth(adm), payload: { hue } })).statusCode).toBe(400);
    await app.inject({ method: "PATCH", url: "/api/admin/brand", headers: auth(adm), payload: { name: null, hue: null } });
    expect(await brand()).toMatchObject({ name: null, hue: null });
  });

  test("знак: PNG принят и отдаётся без входа; SVG и огромный PNG — 400; снять — 404", async () => {
    const adm = await login(app, "admin");
    const up = (name: string, data: Buffer) => {
      const f = form(name, data);
      return app.inject({ method: "POST", url: "/api/admin/brand/logo", headers: { ...auth(adm), ...f.headers }, payload: f.payload });
    };
    expect((await up("logo.png", png(256, 256))).statusCode).toBe(200);
    expect((await brand()).logoUpdatedAt).toBeGreaterThan(0);
    const got = await app.inject({ url: "/api/instance/brand/logo" });
    expect(got.statusCode).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect((await up("logo.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).statusCode).toBe(400);
    expect((await up("big.png", png(4000, 4000))).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: "/api/admin/brand/logo", headers: auth(adm) })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/instance/brand/logo" })).statusCode).toBe(404);
  });

  test("экспорт: запись instance с брендом, без ключа лицензии", async () => {
    const adm = await login(app, "admin");
    await q(`UPDATE instance SET license_key = 'SECRET-LICENSE', brand_name = 'Acme Tasks' WHERE id = 1`);
    const r = await app.inject({ url: "/api/admin/export", headers: auth(adm) });
    const inst = r.body.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>).find((x) => x.type === "instance");
    expect(inst).toMatchObject({ brandName: "Acme Tasks" });
    expect(r.body).not.toContain("SECRET-LICENSE");
  });
});


test("organization transparency: admin updates and resets, members denied, invalid values rejected", async () => {
  const adm = await login(app, "admin");
  const mgr = await login(app, "mgr1");
  const patch = (payload: unknown, token = adm) => app.inject({ method: "PATCH", url: "/api/admin/brand", headers: auth(token), payload: payload as Record<string, unknown> });
  expect((await patch({ transparencyDefault: "on" })).statusCode).toBe(200);
  expect(await brand()).toMatchObject({ transparencyDefault: "on" });
  expect((await patch({ transparencyDefault: "auto" }, mgr)).statusCode).toBe(403);
  for (const transparencyDefault of ["off", "invalid", null]) {
    expect((await patch({ transparencyDefault })).statusCode).toBe(400);
    expect(await brand()).toMatchObject({ transparencyDefault: "on" });
  }
  expect((await patch({ transparencyDefault: "auto" })).statusCode).toBe(200);
  expect(await brand()).toMatchObject({ transparencyDefault: "auto" });
  const logs = await q<{ details: { transparencyDefault: string } }>("SELECT details FROM audit_log WHERE action = 'instance.brand' ORDER BY created_at DESC");
  expect(logs.map((row) => row.details.transparencyDefault)).toContain("on");
});
