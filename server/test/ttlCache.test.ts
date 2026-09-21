import { describe, expect, test } from "vitest";
import { createTtlCache } from "../src/services/ttlCache.js";

describe("ttlCache", () => {
  test("внутри TTL повторный вызов не идёт в загрузчик, после TTL — идёт", async () => {
    let t = 1000;
    const c = createTtlCache<number>(30_000, () => t);
    let calls = 0;
    const load = async () => ++calls;
    expect(await c.get("k", load)).toBe(1);
    t += 29_999;
    expect(await c.get("k", load)).toBe(1);
    t += 2;
    expect(await c.get("k", load)).toBe(2);
    expect(calls).toBe(2);
  });

  test("одновременные запросы одного ключа делят одну загрузку", async () => {
    const c = createTtlCache<number>(30_000);
    let calls = 0;
    let release!: (v: number) => void;
    const load = () => {
      calls++;
      return new Promise<number>((r) => (release = r));
    };
    const all = Promise.all([c.get("k", load), c.get("k", load), c.get("k", load)]);
    release(7);
    expect(await all).toEqual([7, 7, 7]);
    expect(calls).toBe(1);
  });

  test("разные ключи не пересекаются", async () => {
    const c = createTtlCache<string>(30_000);
    expect(await c.get("a", async () => "A")).toBe("A");
    expect(await c.get("b", async () => "B")).toBe("B");
  });

  test("ошибка загрузки не кэшируется", async () => {
    const c = createTtlCache<number>(30_000);
    await expect(c.get("k", async () => Promise.reject(new Error("db down")))).rejects.toThrow("db down");
    expect(await c.get("k", async () => 5)).toBe(5);
  });

  test("ttl = 0 выключает кэш", async () => {
    const c = createTtlCache<number>(0);
    let calls = 0;
    await c.get("k", async () => ++calls);
    await c.get("k", async () => ++calls);
    expect(calls).toBe(2);
  });

  test("число записей ограничено", async () => {
    const c = createTtlCache<number>(1_000_000);
    for (let i = 0; i < 1500; i++) await c.get(`k${i}`, async () => i);
    let calls = 0;
    await c.get("k0", async () => ++calls); // самая старая запись вытеснена
    expect(calls).toBe(1);
  });
});
