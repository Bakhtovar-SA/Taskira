import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { q } from "../src/db.js";
import {
  PG_MAX_TESTED_MAJOR,
  PG_MIN_MAJOR,
  assertSupportedPostgres,
  getPgVersionInfo,
  resetPgVersionCache,
} from "../src/services/pgVersion.js";
import { getApp, stopApp } from "./helpers.js";

/**
 * OPS-PG-01, интеграция с реальным PostgreSQL. Юнит-тест pgVersion.test.ts проверяет только чистые
 * функции и пропустил баг: запрос читал колонку `v`, а `SHOW server_version_num` отдаёт колонку
 * `server_version_num`, поэтому сервер отказывался стартовать на любой версии. Здесь версия берётся
 * из настоящей БД (в CI — матрица job `server`: 14 / 15 / 16 / 17).
 */
async function realMajor(): Promise<number> {
  const [row] = await q<{ n: number }>(`SELECT current_setting('server_version_num')::int / 10000 AS n`);
  return row.n;
}

describe("версия PostgreSQL: реальная БД", () => {
  afterAll(stopApp);
  beforeEach(resetPgVersionCache);

  it("getPgVersionInfo читает server_version_num реальной БД", async () => {
    await getApp(); // initPool
    const info = await getPgVersionInfo();
    const major = await realMajor();
    expect(info.major).toBe(major);
    expect(info.versionNum).toBeGreaterThanOrEqual(major * 10000);
    expect(info.versionNum).toBeLessThan((major + 1) * 10000);
    expect(info.minMajor).toBe(PG_MIN_MAJOR);
    expect(info.maxTestedMajor).toBe(PG_MAX_TESTED_MAJOR);
  });

  it("стартовая проверка assertSupportedPostgres проходит на поддерживаемой версии", async () => {
    await getApp();
    const major = await realMajor();
    // CI-матрица держит версии в пределах [PG_MIN_MAJOR; PG_MAX_TESTED_MAJOR]; локально может быть и 18+.
    const expected = major < PG_MIN_MAJOR ? "unsupported" : major > PG_MAX_TESTED_MAJOR ? "newer_than_tested" : "supported";
    if (expected === "unsupported") {
      await expect(assertSupportedPostgres()).rejects.toThrow(/не поддерживается/);
    } else {
      await expect(assertSupportedPostgres()).resolves.toMatchObject({ major, status: expected });
    }
  });

  it.each(["/ready", "/api/health"])("GET %s сообщает major реальной БД без точной версии", async url => {
    const app = await getApp();
    const major = await realMajor();
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.postgres).toMatchObject({
      major,
      minMajor: PG_MIN_MAJOR,
      maxTestedMajor: PG_MAX_TESTED_MAJOR,
    });
    expect(body.postgres).not.toHaveProperty("version");
    expect(body.postgres).not.toHaveProperty("minor");
    expect(body.postgres).not.toHaveProperty("versionNum");
    if (major > PG_MAX_TESTED_MAJOR) {
      expect(body.postgres.status).toBe("newer_than_tested");
      expect(body.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "postgres_version_untested" })]));
      const warning = body.warnings.find((w: { code: string }) => w.code === "postgres_version_untested");
      expect(warning.reason).toContain(`PostgreSQL ${major} `);
      expect(warning.reason).not.toContain(`PostgreSQL ${major}.`);
    } else {
      expect(body.postgres.status).toBe("supported");
      expect(body.warnings?.some((w: { code: string }) => w.code === "postgres_version_untested") ?? false).toBe(false);
    }
  });
});
