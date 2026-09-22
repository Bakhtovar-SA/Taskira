/**
 * ТЗ 4.1 (план v2, Трек 4; docs/adr/0009-database-per-tenant.md): singleton-таблица `instance` —
 * CHECK-констрейнт физически запрещает вторую строку, `getInstance()` — единственная точка
 * чтения, кэширующая строку в памяти процесса до `invalidateInstanceCache()`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { getApp, q, resetDb, stopApp } from "./helpers.js";
import { getInstance, invalidateInstanceCache } from "../src/services/instance.js";
import { seedInstance } from "../src/seedInstance.js";

beforeAll(async () => {
  await getApp(); // инициализирует пул (initPool/initConfig), сам инстанс приложения тесту не нужен
});
afterAll(async () => {
  await stopApp();
});
beforeEach(async () => {
  await resetDb();
  invalidateInstanceCache();
});
afterEach(() => {
  invalidateInstanceCache();
});

describe("instance (ТЗ 4.1)", () => {
  test("CHECK-констрейнт не даёт вставить вторую строку", async () => {
    await q(`INSERT INTO instance (id, name) VALUES (1, 'A')`);
    await expect(q(`INSERT INTO instance (id, name) VALUES (2, 'B')`)).rejects.toThrow();
  });

  test("PRIMARY KEY не даёт повторить строку с id=1", async () => {
    await q(`INSERT INTO instance (id, name) VALUES (1, 'A')`);
    await expect(q(`INSERT INTO instance (id, name) VALUES (1, 'A2')`)).rejects.toThrow();
  });

  test("seedInstance() идемпотентен: не трогает уже существующую строку", async () => {
    await q(`INSERT INTO instance (id, name, plan) VALUES (1, 'Existing', 'pro')`);
    await seedInstance();
    const row = await getInstance();
    expect(row.name).toBe("Existing");
    expect(row.plan).toBe("pro");
  });

  test("seedInstance() создаёт строку, если её ещё нет", async () => {
    await seedInstance();
    const row = await getInstance();
    expect(row.id).toBe(1);
    expect(row.name).toBeTruthy();
    expect(row.licenseKey).toBeNull();
    expect(row.licenseExpiresAt).toBeNull();
  });

  test("getInstance() бросает, если строки ещё нет (сид не запускался)", async () => {
    await expect(getInstance()).rejects.toThrow(/instance/);
  });

  test("getInstance() кэширует строку в памяти процесса до invalidateInstanceCache()", async () => {
    await seedInstance();
    const first = await getInstance();
    await q(`UPDATE instance SET name = 'Changed' WHERE id = 1`);

    const second = await getInstance();
    expect(second.name).toBe(first.name); // всё ещё старое значение — кэш не инвалидирован

    invalidateInstanceCache();
    const third = await getInstance();
    expect(third.name).toBe("Changed");
  });
});
