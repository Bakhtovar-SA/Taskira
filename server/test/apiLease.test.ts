import { expect, test } from "vitest";
import { acquireApiLease } from "../src/services/apiLease.js";
import { TEST_DB_URL } from "./env.js";
import pg from "pg";

test("одна БД допускает один serving API; остановка освобождает владение", async () => {
  let lost = false;
  const release = await acquireApiLease(TEST_DB_URL, () => { lost = true; });
  try {
    await expect(acquireApiLease(TEST_DB_URL, () => undefined)).rejects.toThrow("one API process");
  } finally {
    await release();
  }
  const releaseNext = await acquireApiLease(TEST_DB_URL, () => { lost = true; });
  await releaseNext();
  expect(lost).toBe(false);
});

test("потеря соединения владения уведомляет владельца, новый процесс может стартовать", async () => {
  let notifyLost!: () => void;
  const lost = new Promise<void>((resolve) => { notifyLost = resolve; });
  const release = await acquireApiLease(TEST_DB_URL, notifyLost);
  const control = new pg.Client({ connectionString: TEST_DB_URL });
  try {
    await control.connect();
    await control.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'taskira-api-lease'`);
    await lost;
    const releaseNext = await acquireApiLease(TEST_DB_URL, () => undefined);
    await releaseNext();
  } finally {
    await control.end();
    await release().catch(() => undefined);
  }
});
