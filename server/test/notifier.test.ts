/**
 * Email-воркер уведомлений (NOTIFICATIONS_MIGRATION.md Фаза 3).
 * Запускается только при NOTIFY_EMAIL_ENABLED=true + SMTP_* (иначе describe.skip):
 *   - CI: job `mail` в .github/workflows/test.yml (docker compose Mailpit),
 *     MAIL_KIND=mailpit, MAIL_API=http://localhost:8025;
 *   - локально без Docker: этот файл сам поднимает test/mail/sink.mjs
 *     (SMTP-catcher на smtp-server). См. test/mail/README.md.
 *
 * Главное здесь — регрессия D9: заголовок задачи и текст комментария из фикстуры
 * НЕ должны попадать в письмо (тело/HTML/raw). В письме — только тип события,
 * ключ задачи и ссылка.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { getApp, stopApp, resetDb, seedFixture, login, auth, q, type Fixture } from "./helpers.js";
import { runNotifierOnce, _resetTransport } from "../src/services/notifier.js";
import { loadConfig } from "../src/config.js";

const RUN = process.env.NOTIFY_EMAIL_ENABLED === "true" && !!process.env.SMTP_HOST;
const d = RUN ? describe : describe.skip;

const MAIL_KIND = process.env.MAIL_KIND ?? "sink";
const SINK_SMTP = Number(process.env.SMTP_PORT ?? 1025);
const SINK_HTTP = SINK_SMTP + 1000;
const mailApi = process.env.MAIL_API ?? `http://127.0.0.1:${SINK_HTTP}`;

interface Captured {
  to: string;
  subject: string;
  text: string;
  html: string;
  raw: string;
}

async function captured(): Promise<Captured[]> {
  if (MAIL_KIND === "mailpit") {
    const list = (await fetch(`${mailApi}/api/v1/messages?limit=100`).then((r) => r.json())) as {
      messages?: { ID: string }[];
    };
    return Promise.all(
      (list.messages ?? []).map(async (m) => {
        const f = (await fetch(`${mailApi}/api/v1/message/${m.ID}`).then((r) => r.json())) as Record<string, unknown>;
        const text = (f.Text as string) ?? "";
        const html = (f.HTML as string) ?? "";
        return {
          to: ((f.To as { Address: string }[]) ?? []).map((t) => t.Address).join(", "),
          subject: (f.Subject as string) ?? "",
          text,
          html,
          raw: `${text}\n${html}`,
        };
      }),
    );
  }
  return fetch(mailApi).then((r) => r.json() as Promise<Captured[]>);
}
const clearMail = () =>
  fetch(MAIL_KIND === "mailpit" ? `${mailApi}/api/v1/messages` : mailApi, { method: "DELETE" }).catch(() => undefined);

let app: FastifyInstance;
let fx: Fixture;
let sink: ChildProcess | null = null;

/** Уникальные маркеры для D9: они кладутся в заголовок задачи и текст коммента,
 *  а потом проверяется, что в письме их НЕТ. */
const TITLE_MARK = "ЗАГОЛОВОК-СЕКРЕТ-cf83a1";
const COMMENT_MARK = "текст-комментария-секрет-zz9107";

/** Дать пользователю email + notify_prefs. */
const setUser = (id: string, email: string | null, prefs: object = {}) =>
  q(`UPDATE users SET email = $2, notify_prefs = $3::jsonb WHERE id = $1`, [id, email, JSON.stringify(prefs)]);

/** Прокомментировать p1issue от mgr1, предварительно дав задаче секретный заголовок. */
async function commentWithSecrets(): Promise<void> {
  const mgrTok = await login(app, "mgr1");
  await app.inject({
    method: "PATCH",
    url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`,
    headers: auth(mgrTok),
    payload: { title: TITLE_MARK },
  });
  await app.inject({
    method: "POST",
    url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/comments`,
    headers: auth(mgrTok),
    payload: { body: `важное: ${COMMENT_MARK} — посмотрите` },
  });
}

d("Email-воркер против настоящего SMTP", () => {
  beforeAll(async () => {
    if (MAIL_KIND !== "mailpit") {
      sink = fork(fileURLToPath(new URL("./mail/sink.mjs", import.meta.url)), {
        env: { ...process.env, MAIL_SINK_SMTP: String(SINK_SMTP), MAIL_SINK_HTTP: String(SINK_HTTP) },
        stdio: "inherit",
      });
      for (let i = 0; i < 50; i++) {
        try {
          await fetch(mailApi);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    }
    app = await getApp();
  }, 20_000);

  afterAll(async () => {
    await stopApp();
    try {
      sink?.send("shutdown");
    } catch {
      /* ignore */
    }
    sink?.kill();
  });

  beforeEach(async () => {
    await resetDb();
    fx = await seedFixture();
    _resetTransport();
    await clearMail();
  });

  test("D9: письмо содержит ключ задачи и ссылку, но НЕ заголовок и НЕ текст комментария", async () => {
    await setUser(fx.users.emp1, "emp1@corp.example", { email: "instant" });
    await commentWithSecrets();

    const stats = await runNotifierOnce();
    expect(stats.sent).toBe(1);

    const mail = await captured();
    expect(mail).toHaveLength(1);
    const m = mail[0];
    expect(m.to).toContain("emp1@corp.example");

    // ЕСТЬ: ключ задачи и прямая ссылка
    const link = `#/issue/${fx.projects.p1}/${fx.issues.p1issue}`;
    expect(m.subject + m.text + m.html).toContain("CORP-1");
    expect(m.text + m.html).toContain(link);

    // НЕТ (D9): заголовок задачи и текст комментария — ни в теле, ни в HTML, ни в raw
    const haystack = `${m.subject}\n${m.text}\n${m.html}\n${m.raw}`;
    expect(haystack).not.toContain(TITLE_MARK);
    expect(haystack).not.toContain(COMMENT_MARK);
    expect(haystack).not.toContain("текст-комментария");

    // строка помечена отправленной
    const row = await q<{ email_state: string }>(
      `SELECT email_state FROM notifications WHERE user_id = $1`,
      [fx.users.emp1],
    );
    expect(row[0].email_state).toBe("sent");
  });

  test("notify_prefs.email='off' → строка 'skipped' сразу на emit, письмо не уходит", async () => {
    await setUser(fx.users.emp1, "emp1@corp.example", { email: "off" });
    await commentWithSecrets();

    const row = await q<{ email_state: string }>(`SELECT email_state FROM notifications WHERE user_id = $1`, [fx.users.emp1]);
    expect(row[0].email_state).toBe("skipped"); // emit проставил, воркеру нечего слать
    const stats = await runNotifierOnce();
    expect(stats.sent).toBe(0);
    expect(await captured()).toHaveLength(0);
  });

  test("prefs сменились на 'off' ПОСЛЕ emit → воркер защитно помечает 'skipped', не шлёт", async () => {
    await setUser(fx.users.emp1, "emp1@corp.example", { email: "instant" });
    await commentWithSecrets(); // строка создаётся 'pending'
    await q(`UPDATE users SET notify_prefs = '{"email":"off"}'::jsonb WHERE id = $1`, [fx.users.emp1]);

    const stats = await runNotifierOnce();
    expect(stats.skipped).toBe(1);
    expect(stats.sent).toBe(0);
    expect(await captured()).toHaveLength(0);
    const row = await q<{ email_state: string }>(`SELECT email_state FROM notifications WHERE user_id = $1`, [fx.users.emp1]);
    expect(row[0].email_state).toBe("skipped");
  });

  test("у получателя нет email → строка 'skipped' уже на этапе emit, воркеру нечего слать", async () => {
    await setUser(fx.users.emp1, null, {}); // email NULL
    await commentWithSecrets();

    const before = await q<{ email_state: string }>(`SELECT email_state FROM notifications WHERE user_id = $1`, [fx.users.emp1]);
    expect(before[0].email_state).toBe("skipped");
    const stats = await runNotifierOnce();
    expect(stats.sent).toBe(0);
    expect(await captured()).toHaveLength(0);
  });

  test("дайджест (email='daily'): пока окно не вышло — deferred; после — одно письмо-сводка без контента", async () => {
    await setUser(fx.users.emp1, "emp1@corp.example", { email: "daily" });
    await commentWithSecrets();
    await commentWithSecrets(); // два события

    let stats = await runNotifierOnce();
    expect(stats.deferred).toBe(2);
    expect(await captured()).toHaveLength(0);

    // «состарить» события за пределы окна дайджеста
    await q(
      `UPDATE notifications SET created_at = now() - ($1::int * interval '1 millisecond')
        WHERE user_id = $2`,
      [loadConfig().notify.digestWindowMs + 60_000, fx.users.emp1],
    );

    stats = await runNotifierOnce();
    expect(stats.sent).toBe(2); // две строки закрыты одним письмом

    const mail = await captured();
    expect(mail).toHaveLength(1);
    expect(mail[0].subject.toLowerCase()).toContain("сводка");
    expect(mail[0].text + mail[0].html).toContain("CORP-1");
    const haystack = `${mail[0].subject}\n${mail[0].text}\n${mail[0].html}\n${mail[0].raw}`;
    expect(haystack).not.toContain(TITLE_MARK);
    expect(haystack).not.toContain(COMMENT_MARK);
  });

  test("SMTP недоступен → ретрай, email_tries растёт, после лимита → 'failed', письма нет", async () => {
    await setUser(fx.users.emp1, "emp1@corp.example", { email: "instant" });
    await commentWithSecrets();

    const cfg = loadConfig().notify;
    const goodPort = cfg.smtp!.port;
    cfg.smtp!.port = 59_599; // заведомо закрытый
    _resetTransport();
    try {
      const max = cfg.emailMaxTries;
      for (let i = 1; i <= max; i++) {
        await runNotifierOnce();
        const r = await q<{ email_tries: number; email_state: string }>(
          `SELECT email_tries, email_state FROM notifications WHERE user_id = $1`,
          [fx.users.emp1],
        );
        expect(r[0].email_tries).toBe(i);
        expect(r[0].email_state).toBe(i >= max ? "failed" : "pending");
      }
      expect(await captured()).toHaveLength(0);
    } finally {
      cfg.smtp!.port = goodPort;
      _resetTransport();
    }
  });
});
