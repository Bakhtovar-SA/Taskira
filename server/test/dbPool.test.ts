import { afterEach, describe, expect, test } from "vitest";
import { closePool, initPool } from "../src/db.js";
import { TEST_DB_URL } from "./env.js";

/**
 * Пул держит простаивающие соединения (умолчание `pg` — 10 с — делало каждый первый запрос после
 * паузы на 60–92 мс дороже) и не роняет процесс, если такое соединение оборвали.
 */
describe("пул соединений", () => {
  afterEach(async () => {
    await closePool();
  });

  test("по умолчанию простаивающие соединения не закрываются", () => {
    const pool = initPool(TEST_DB_URL);
    expect((pool as unknown as { options: { idleTimeoutMillis: number } }).options.idleTimeoutMillis).toBe(0);
  });

  test("значение можно переопределить", () => {
    const pool = initPool(TEST_DB_URL, 3, 15_000);
    const o = (pool as unknown as { options: { idleTimeoutMillis: number; max: number } }).options;
    expect(o.idleTimeoutMillis).toBe(15_000);
    expect(o.max).toBe(3);
  });

  test("обрыв простаивающего соединения не падает необработанным событием 'error'", () => {
    const pool = initPool(TEST_DB_URL);
    expect(() => pool.emit("error", new Error("terminating connection due to administrator command"))).not.toThrow();
  });
});
