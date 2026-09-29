/** Язык писем (трек E): шаблоны RU/EN одной формы; язык человека хранится на сервере (PUT /api/me/lang). */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { MAIL_STRINGS, renderDigest, renderOne, type MailItem } from "../src/services/emailTemplates.js";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp } from "./helpers.js";

const cyr = /[А-Яа-яЁё]/;
const item = (over: Partial<MailItem> = {}): MailItem => ({ type: "issue.assigned", issueKey: "CORP-7", projectId: "p", issueId: "i", ...over });

describe("шаблоны писем", () => {
  test("у обоих языков одни и те же события и ни одной пустой строки", () => {
    expect(Object.keys(MAIL_STRINGS.en.events).sort()).toEqual(Object.keys(MAIL_STRINGS.ru.events).sort());
    for (const lang of ["ru", "en"] as const) {
      const m = MAIL_STRINGS[lang];
      for (const v of [...Object.values(m.events), m.open, m.openLabel, m.project, m.footerText, m.footerHtml, m.digestHead(2), m.digestSubject(2)]) {
        expect(v.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("английское письмо — без кириллицы, с lang=en; русское — как раньше", () => {
    const en = renderOne("https://t.example", item(), "en");
    expect(en.subject).toBe("Taskira · you were assigned to an issue CORP-7");
    expect(cyr.test(en.subject + en.text + en.html)).toBe(false);
    expect(en.html).toContain('<html lang="en">');
    const ru = renderOne("https://t.example", item());
    expect(ru.subject).toBe("Taskira · вас назначили исполнителем задачи CORP-7");
    expect(ru.html).toContain("Открыть в Taskira");

    const digest = renderDigest("https://t.example", [item(), item({ type: "project.member", issueKey: null, issueId: null })], "en");
    expect(digest.subject).toBe("Taskira · notification digest (2)");
    expect(cyr.test(digest.subject + digest.text + digest.html)).toBe(false);
  });
});

describe("PUT /api/me/lang", () => {
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
  });

  test("сохраняет язык, /auth/me его отдаёт; по умолчанию — ru", async () => {
    const emp = await login(app, "emp1");
    const me = () => app.inject({ url: "/api/auth/me", headers: auth(emp) }).then((r) => JSON.parse(r.body) as { lang: string });
    expect((await me()).lang).toBe("ru");
    const r = await app.inject({ method: "PUT", url: "/api/me/lang", headers: auth(emp), payload: { lang: "en" } });
    expect(r.statusCode).toBe(204);
    expect((await me()).lang).toBe("en");
    const [row] = await q<{ lang: string }>(`SELECT lang FROM users WHERE username = 'emp1'`);
    expect(row.lang).toBe("en");
  });

  test("неизвестный язык — 400, без входа — 401", async () => {
    const emp = await login(app, "emp1");
    expect((await app.inject({ method: "PUT", url: "/api/me/lang", headers: auth(emp), payload: { lang: "de" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/me/lang", payload: { lang: "en" } })).statusCode).toBe(401);
  });
});
