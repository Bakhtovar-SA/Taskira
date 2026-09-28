/** ТЗ 5.14 п.7 — право менять внешний вид проекта (editAppearance) проверяет сервер:
 *  менеджер проекта может, сотрудник/наблюдатель/чужой — нет; список фонов закрытый; действие — в audit_log. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

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

const patch = async (user: string, payload: Record<string, unknown>, projectId = fx.projects.p1) =>
  app.inject({ method: "PATCH", url: `/api/projects/${projectId}/appearance`, headers: auth(await login(app, user)), payload });
const look = async (id: string) =>
  (await q<{ icon: string | null; color: string | null; background: string | null }>(`SELECT icon, color, background FROM projects WHERE id = $1`, [id]))[0];

describe("PATCH /projects/:id/appearance", () => {
  test("менеджер проекта меняет фон, иконку и цвет; в audit_log — project.appearance", async () => {
    const r = await patch("mgr1", { background: "rings", icon: "rocket", color: "teal" });
    expect(r.statusCode).toBe(200);
    expect(await look(fx.projects.p1)).toEqual({ icon: "rocket", color: "teal", background: "rings" });
    // audit() — fire-and-forget: ждём строку до секунды, а не проверяем сразу.
    let rows = 0;
    for (let i = 0; i < 20 && !rows; i++) {
      rows = (await q(`SELECT 1 FROM audit_log WHERE action = 'project.appearance' AND entity_id = $1`, [fx.projects.p1])).length;
      if (!rows) await new Promise((r) => setTimeout(r, 50));
    }
    expect(rows).toBe(1);
  });

  test("сотрудник, наблюдатель и не участник — 403 (чужой — 403/404), фон не меняется", async () => {
    for (const u of ["emp1", "viw1"]) expect((await patch(u, { background: "grid" })).statusCode).toBe(403);
    expect([403, 404]).toContain((await patch("mgr2", { background: "grid" })).statusCode);
    expect((await look(fx.projects.p1)).background).toBeNull();
  });

  test("глобальный администратор может; неизвестный фон и пустой патч — 400", async () => {
    expect((await patch("admin", { background: "dots" })).statusCode).toBe(200);
    expect((await patch("admin", { background: "https://evil.example/x.png" })).statusCode).toBe(400);
    expect((await patch("admin", {})).statusCode).toBe(400);
    expect((await patch("admin", { background: null })).statusCode).toBe(200);
    expect((await look(fx.projects.p1)).background).toBeNull();
  });
});
