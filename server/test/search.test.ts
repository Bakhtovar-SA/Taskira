/** Кросс-проектный поиск (GET /api/issues/search, миграция 024) — по ВСЕМ
 *  видимым пользователю проектам, не только текущему. Предикат видимости
 *  должен совпадать с services/projects.ts listVisibleProjects (см. и
 *  home.test.ts для того же инварианта на assigned-to-me). */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, newIssue, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

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

const g = (url: string, token: string) => app.inject({ url, headers: auth(token) });
const post = (url: string, token: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: auth(token), payload });

const p1 = () => fx.projects.p1;
const p2 = () => fx.projects.p2;
const search = (q: string, token: string) => g(`/api/issues/search?q=${encodeURIComponent(q)}`, token);

async function createIssue(projectId: string, token: string, over: Record<string, unknown> = {}) {
  const r = await post(`/api/projects/${projectId}/issues`, token, newIssue(over));
  expect(r.statusCode).toBe(201);
  return JSON.parse(r.body);
}

describe("кросс-проектный поиск", () => {
  test("находит задачу в проекте, который сейчас не открыт (global admin видит оба)", async () => {
    const admin = await login(app, "admin");
    const mgr2 = await login(app, "mgr2");
    const issue = await createIssue(p2(), mgr2, { title: "Уникальная задача в SEC" });

    const r = await search("Уникальная задача", admin);
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.items.some((i: { id: string }) => i.id === issue.id)).toBe(true);
    expect(body.items.find((i: { id: string }) => i.id === issue.id)).toMatchObject({
      projectId: p2(),
      projectKey: "SEC",
    });
  });

  test("не показывает задачи из проекта, к которому нет доступа", async () => {
    const outsider = await login(app, "outsider");
    const mgr2 = await login(app, "mgr2");
    const issue = await createIssue(p2(), mgr2, { title: "Секретная для outsider задача" });

    const r = await search("Секретная для outsider", outsider);
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.items.some((i: { id: string }) => i.id === issue.id)).toBe(false);
  });

  test("находит по ключу задачи, не только по названию", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(p1(), mgr, { title: "т" });

    const r = await search(issue.key, mgr);
    const body = JSON.parse(r.body);
    expect(body.items.some((i: { id: string }) => i.id === issue.id)).toBe(true);
  });

  test("не находит заархивированные задачи", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(p1(), mgr, { title: "Архивная находка" });
    await q(`UPDATE issues SET archived_at = now() WHERE id = $1`, [issue.id]);

    const r = await search("Архивная находка", mgr);
    const body = JSON.parse(r.body);
    expect(body.items.some((i: { id: string }) => i.id === issue.id)).toBe(false);
  });

  test("пустой q отклоняется валидацией — 400", async () => {
    const mgr = await login(app, "mgr1");
    const r = await g("/api/issues/search?q=", mgr);
    expect(r.statusCode).toBe(400);
  });

  // ТЗ 3.4 (план v2 Трек 3): полнотекстовый поиск — по описанию, комментариям,
  // пунктам чек-листа, не только по названию/ключу.
  test("находит задачу по слову только в описании (не в названии)", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(p1(), mgr, { title: "т", description: "содержит уникальноеслово нигде больше" });
    const r = await search("уникальноеслово", mgr);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).items.map((i: { id: string }) => i.id)).toContain(issue.id);
  });

  test("находит задачу по слову только в комментарии", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(p1(), mgr, { title: "т", description: "" });
    const c = await app.inject({
      method: "POST",
      url: `/api/projects/${p1()}/issues/${issue.id}/comments`,
      headers: auth(mgr),
      payload: { body: "обсуждаем комментарийсрочнофиксить прямо здесь" },
    });
    expect(c.statusCode).toBe(201);
    const r = await search("комментарийсрочнофиксить", mgr);
    expect(JSON.parse(r.body).items.map((i: { id: string }) => i.id)).toContain(issue.id);
  });

  test("находит задачу по слову только в пункте чек-листа", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(p1(), mgr, { title: "т", description: "" });
    const item = await app.inject({
      method: "POST",
      url: `/api/projects/${p1()}/issues/${issue.id}/checklist`,
      headers: auth(mgr),
      payload: { text: "проверитьчеклистуникум перед релизом" },
    });
    expect(item.statusCode).toBe(200);
    const r = await search("проверитьчеклистуникум", mgr);
    expect(JSON.parse(r.body).items.map((i: { id: string }) => i.id)).toContain(issue.id);
  });

  test("ранжирование: совпадение в заголовке выше совпадения в старом комментарии", async () => {
    const mgr = await login(app, "mgr1");
    const titleHit = await createIssue(p1(), mgr, { title: "жарптица в названии", description: "" });
    const commentHit = await createIssue(p1(), mgr, { title: "другая штука", description: "" });
    const c = await app.inject({
      method: "POST",
      url: `/api/projects/${p1()}/issues/${commentHit.id}/comments`,
      headers: auth(mgr),
      payload: { body: "здесь тоже упомянута жарптица, но в комментарии" },
    });
    expect(c.statusCode).toBe(201);

    const r = await search("жарптица", mgr);
    const ids = JSON.parse(r.body).items.map((i: { id: string }) => i.id);
    expect(ids.indexOf(titleHit.id)).toBeLessThan(ids.indexOf(commentHit.id));
  });

  test("находит и кириллицей, и латиницей ('simple' — без стемминга ни одного из языков)", async () => {
    const mgr = await login(app, "mgr1");
    const ru = await createIssue(p1(), mgr, { title: "кириллическийпоиск т", description: "" });
    const en = await createIssue(p1(), mgr, { title: "latinsearchterm issue", description: "" });
    const rRu = await search("кириллическийпоиск", mgr);
    expect(JSON.parse(rRu.body).items.map((i: { id: string }) => i.id)).toContain(ru.id);
    const rEn = await search("latinsearchterm", mgr);
    expect(JSON.parse(rEn.body).items.map((i: { id: string }) => i.id)).toContain(en.id);
  });

  test("частичное совпадение по ключу всё ещё работает (ILIKE-ветка, не FTS)", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(p1(), mgr, { title: "т" });
    const r = await search(issue.key.slice(0, -1), mgr); // без последней цифры
    expect(JSON.parse(r.body).items.map((i: { id: string }) => i.id)).toContain(issue.id);
  });

  test("заархивированная задача не находится даже по совпадению в комментарии", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(p1(), mgr, { title: "т", description: "" });
    await q(`UPDATE issues SET archived_at = now() WHERE id = $1`, [issue.id]);
    const c = await app.inject({
      method: "POST",
      url: `/api/projects/${p1()}/issues/${issue.id}/comments`,
      headers: auth(mgr),
      payload: { body: "архивнаязадачакомментарий" },
    });
    expect(c.statusCode).toBe(201);
    const r = await search("архивнаязадачакомментарий", mgr);
    expect(JSON.parse(r.body).items.map((i: { id: string }) => i.id)).not.toContain(issue.id);
  });
});

describe("GET /api/issues/resolve — ключ → id/projectId (ТЗ 3.1, роутер)", () => {
  const resolve = (key: string, token: string) => g(`/api/issues/resolve?key=${encodeURIComponent(key)}`, token);

  test("точный ключ видимой задачи → id, projectId, projectKey", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(p1(), mgr, { title: "т" });

    const r = await resolve(issue.key, mgr);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ id: issue.id, projectId: p1(), projectKey: "CORP" });
  });

  test("ключа не существует → 404", async () => {
    const mgr = await login(app, "mgr1");
    const r = await resolve("NOPE-999999", mgr);
    expect(r.statusCode).toBe(404);
  });

  test("ключ существует, но проект не виден вызывающему → 404 (не отличимо от «не существует»)", async () => {
    const outsider = await login(app, "outsider");
    const mgr2 = await login(app, "mgr2");
    const issue = await createIssue(p2(), mgr2, { title: "Секретная для outsider задача" });

    const r = await resolve(issue.key, outsider);
    expect(r.statusCode).toBe(404);
  });

  test("частичное совпадение не резолвится — только точный ключ", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(p1(), mgr, { title: "т" });

    const r = await resolve(issue.key.slice(0, -1), mgr); // CORP-12 → CORP-1
    expect(r.statusCode).toBe(404);
  });

  test("заархивированная задача всё равно резолвится — deep link переживает архивацию (issue lifecycle: архивация — не удаление)", async () => {
    const mgr = await login(app, "mgr1");
    const issue = await createIssue(p1(), mgr, { title: "Архивная" });
    await q(`UPDATE issues SET archived_at = now() WHERE id = $1`, [issue.id]);

    const r = await resolve(issue.key, mgr);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).id).toBe(issue.id);
  });

  test("пустой key отклоняется валидацией — 400", async () => {
    const mgr = await login(app, "mgr1");
    const r = await g("/api/issues/resolve?key=", mgr);
    expect(r.statusCode).toBe(400);
  });
});
