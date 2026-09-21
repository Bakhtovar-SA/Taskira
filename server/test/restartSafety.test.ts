/**
 * RESTART-SAFETY: корректность при двух одновременно живых экземплярах на одной БД (второй экземпляр,
 * staging на той же базе, перекрытие при перезапуске). Каждый кейс сначала воспроизводился на прежнем коде:
 *   - письмо уходило дважды (выборка `pending` без захвата строк);
 *   - при одновременном старте на пустой БД второй экземпляр падал на `projects_key_key`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.hoisted(() => {
  process.env.NOTIFY_EMAIL_ENABLED = "true";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "1025";
  process.env.SMTP_FROM = "Taskira <noreply@taskira.test>";
  process.env.APP_BASE_URL = "http://localhost:8081";
});

import { withAdvisoryLock } from "../src/db.js";
import { runNotifierTick, _setTransport } from "../src/services/notifier.js";
import { runJobLocked } from "../src/services/maintenance.js";
import { runStartupSeeds } from "../src/seedStartup.js";
import { getApp, q, resetDb, seedFixture, stopApp } from "./helpers.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await getApp(); // поднимает пул БД
});
afterAll(async () => {
  _setTransport(null);
  await stopApp();
});
beforeEach(async () => {
  await resetDb();
});

describe("withAdvisoryLock", () => {
  test("wait:false — пока лок занят, второй вызов пропускается и fn не выполняется", async () => {
    let inner = 0;
    let release!: () => void;
    const held = withAdvisoryLock("taskira:test:a", { wait: false }, () => new Promise<void>((r) => (release = r)));
    await sleep(50);
    const second = await withAdvisoryLock("taskira:test:a", { wait: false }, async () => {
      inner++;
    });
    expect(second.acquired).toBe(false);
    expect(inner).toBe(0);
    release();
    expect((await held).acquired).toBe(true);
    // после освобождения лок снова доступен
    const third = await withAdvisoryLock("taskira:test:a", { wait: false }, async () => "ok");
    expect(third).toEqual({ acquired: true, value: "ok" });
  });

  test("лок снимается и при исключении в fn", async () => {
    await expect(withAdvisoryLock("taskira:test:b", { wait: false }, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect((await withAdvisoryLock("taskira:test:b", { wait: false }, async () => 1)).acquired).toBe(true);
  });

  test("wait:true — второй ждёт первого, секции не пересекаются", async () => {
    const order: string[] = [];
    const a = withAdvisoryLock("taskira:test:c", { wait: true }, async () => {
      order.push("a:start");
      await sleep(80);
      order.push("a:end");
    });
    await sleep(20);
    const b = withAdvisoryLock("taskira:test:c", { wait: true }, async () => {
      order.push("b:start");
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
  });
});

describe("email-воркер: один тик на всех", () => {
  test("два одновременных тика отправляют письмо один раз, проигравший возвращает null", async () => {
    const fx = await seedFixture();
    const uid = Object.values(fx.users)[0] as string;
    await q(`UPDATE users SET email = 'a@taskira.test', notify_prefs = '{"email":"instant"}'::jsonb WHERE id = $1`, [uid]);
    await q(`INSERT INTO notifications (user_id, type, project_id, email_state) VALUES ($1, 'project.member', $2, 'pending')`, [uid, fx.projects.p1]);
    let sent = 0;
    _setTransport({
      sendMail: (async () => {
        await sleep(80);
        sent++;
        return {};
      }) as never,
    });
    const results = await Promise.all([runNotifierTick(), runNotifierTick()]);
    expect(sent).toBe(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.find((r) => r !== null)).toMatchObject({ sent: 1 });
    expect((await q<{ email_state: string }>(`SELECT email_state FROM notifications`))[0].email_state).toBe("sent");
  });
});

describe("фоновые джобы: лидер на каждый", () => {
  test("занятый джоб пропускает тик, свободный — выполняется", async () => {
    let runs = 0;
    let release!: () => void;
    const busy = runJobLocked("test-job", () => new Promise<void>((r) => (release = r)));
    await sleep(50);
    const skipped = await runJobLocked("test-job", async () => {
      runs++;
    });
    expect(skipped).toBe(false);
    expect(runs).toBe(0);
    // другой джоб не блокируется первым
    expect(await runJobLocked("other-job", async () => void runs++)).toBe(true);
    expect(runs).toBe(1);
    release();
    expect(await busy).toBe(true);
    expect(await runJobLocked("test-job", async () => void runs++)).toBe(true);
  });
});

describe("стартовые сиды", () => {
  test("два одновременных старта на пустой БД: оба успешно, один админ и один проект", async () => {
    const results = await Promise.allSettled([runStartupSeeds(), runStartupSeeds()]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const [{ u, p }] = await q<{ u: number; p: number }>(`SELECT (SELECT count(*) FROM users)::int AS u, (SELECT count(*) FROM projects)::int AS p`);
    expect(u).toBe(1);
    expect(p).toBe(1);
  });
});
