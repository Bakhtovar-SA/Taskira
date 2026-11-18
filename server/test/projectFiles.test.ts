import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";
import type { ProjectFilesResultDto } from "../src/contract.js";

let app: FastifyInstance;
let fx: Fixture;
let token: string;
let archivedIssue: string;
const url = (project: string, query = "") => `/api/projects/${project}/files${query ? `?${query}` : ""}`;
const catalogue = async (query = "", project = fx.projects.p1, bearer = token) => {
  const res = await app.inject({ method: "GET", url: url(project, query), headers: auth(bearer) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<ProjectFilesResultDto>();
};

async function addFile(issueId: string, filename: string, contentType: string, bytes: number, day: number) {
  const id = randomUUID();
  await q(`INSERT INTO attachments
    (id, issue_id, uploaded_by, filename, content_type, byte_size, sha256, storage_driver, storage_key, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'local', $8, $9)`,
  [id, issueId, fx.users.emp1, filename, contentType, bytes, "0".repeat(64), `${issueId}/${id}`, `2026-11-${String(day).padStart(2, "0")}T12:00:00Z`]);
  return id;
}

beforeAll(async () => { app = await getApp(); });
afterAll(stopApp);
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
  token = await login(app, "emp1");
  await q(`UPDATE issues SET title = 'Проверить портал' WHERE id = $1`, [fx.issues.p1issue]);
  const [archived] = await q<{ id: string }>(`INSERT INTO issues
    (project_id, num, key, title, description, type_id, status_id, priority_id, reporter_id, labels, rank, archived_at)
    VALUES ($1, 2, 'CORP-2', 'Архивная проверка', '', 'task', $2, 'medium', $3, '{}', 2, now()) RETURNING id`,
  [fx.projects.p1, fx.p1status.todo, fx.users.emp1]);
  archivedIssue = archived.id;
  await addFile(fx.issues.p1issue, "Alpha.png", "image/png", 10, 1);
  await addFile(archivedIssue, "Отчёт 100%_готов.PDF", "application/pdf", 20, 2);
  await addFile(fx.issues.p1issue, "Backup.ZIP", "application/octet-stream", 30, 3);
  await addFile(fx.issues.p1issue, "data.bin", "application/octet-stream", 40, 4);
  await addFile(fx.issues.p2issue, "секрет.pdf", "application/pdf", 999, 5);
});

describe("Project files: access and source metadata", () => {
  test.each(["limit=100", "type=x"])("access is checked before an invalid query: %s", async (query) => {
    await q(`INSERT INTO issue_collaborators (issue_id, user_id) VALUES ($1, $2)`, [fx.issues.p1issue, fx.users.outsider]);
    const invited = await login(app, "outsider");
    const foreign = await login(app, "mgr2");
    for (const [headers, status] of [[{}, 401], [auth(invited), 403], [auth(foreign), 403], [auth(token), 400]] as const) {
      const res = await app.inject({ method: "GET", url: url(fx.projects.p1, query), headers });
      expect(res.statusCode, res.body).toBe(status);
    }
  });

  test("global admin and all project roles browse, without foreign files or storage keys", async () => {
    for (const username of ["admin", "mgr1", "emp1", "viw1"]) {
      const result = await catalogue("", fx.projects.p1, await login(app, username));
      expect(result.total).toBe(4);
      expect(result.totalBytes).toBe(100);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
      expect(result.items).toHaveLength(4);
      expect(result.items.some((file) => file.filename === "секрет.pdf")).toBe(false);
      const archived = result.items.find((file) => file.issue.id === archivedIssue)!;
      expect(archived.issue).toEqual({ id: archivedIssue, key: "CORP-2", title: "Архивная проверка", archived: true });
      expect(archived.uploadedById).toBe(fx.users.emp1);
      expect(archived.uploaderName).toBeTruthy();
      expect(archived.createdAt).toBe("2026-11-02T12:00:00.000Z");
      expect(archived).not.toHaveProperty("storage_key");
      expect(archived).not.toHaveProperty("storageKey");
      expect(archived).not.toHaveProperty("sha256");
    }
  });

  test("an issue invitation allows its attachments but never the project catalogue", async () => {
    await q(`INSERT INTO issue_collaborators (issue_id, user_id) VALUES ($1, $2)`, [fx.issues.p1issue, fx.users.outsider]);
    const outsider = await login(app, "outsider");
    const allowed = await app.inject({ method: "GET", url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}/attachments`, headers: auth(outsider) });
    expect(allowed.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: url(fx.projects.p1), headers: auth(outsider) })).statusCode).toBe(403);
  });

  test("anonymous and another project member cannot browse; own project stays scoped", async () => {
    expect((await app.inject({ method: "GET", url: url(fx.projects.p1) })).statusCode).toBe(401);
    const other = await login(app, "mgr2");
    expect((await app.inject({ method: "GET", url: url(fx.projects.p1), headers: auth(other) })).statusCode).toBe(403);
    const result = await catalogue("", fx.projects.p2, other);
    expect(result.total).toBe(1);
    expect(result.totalBytes).toBe(999);
    expect(result.items[0].issue.id).toBe(fx.issues.p2issue);
    expect((await app.inject({ method: "GET", url: url(randomUUID()), headers: auth(token) })).statusCode).toBe(404);
  });

  test("an empty project and a removed uploader have valid explicit metadata", async () => {
    await q(`DELETE FROM attachments WHERE issue_id = $1`, [fx.issues.p2issue]);
    expect(await catalogue("", fx.projects.p2, await login(app, "mgr2"))).toEqual({ items: [], total: 0, totalBytes: 0, limit: 50, offset: 0 });
    await q(`UPDATE attachments SET uploaded_by = NULL WHERE issue_id = $1`, [archivedIssue]);
    const [archived] = (await catalogue("q=CORP-2")).items;
    expect(archived.uploadedById).toBeNull();
    expect(archived.uploaderName).toBeNull();
  });
});

describe("Project files: search, filters and pages", () => {
  test("a 5,000-file catalogue keeps exact search totals and deep-page results", async () => {
    await q(`WITH created AS (
      INSERT INTO issues (project_id, num, key, title, description, type_id, status_id, priority_id, reporter_id, labels, rank)
      SELECT $1, 1000 + n, 'CORP-' || (1000 + n), 'Bulk catalogue task ' || n, '', 'task', $2, 'medium', $3, '{}', n
      FROM generate_series(1, 1000) n RETURNING id, key
    )
    INSERT INTO attachments (issue_id, uploaded_by, filename, content_type, byte_size, sha256, storage_driver, storage_key)
    SELECT c.id, $3, 'bulk-' || c.key || '-' || n || '.pdf', 'application/pdf', 100, repeat('0', 64), 'local', c.id || '/' || n
    FROM created c CROSS JOIN generate_series(1, 5) n`, [fx.projects.p1, fx.p1status.todo, fx.users.emp1]);
    const result = await catalogue("q=bulk-&type=documents&sort=name");
    expect(result.items).toHaveLength(50);
    expect(result.total).toBe(5000);
    expect(result.totalBytes).toBe(500_000);
    const last = await catalogue("q=bulk-&type=documents&sort=name&offset=4950");
    expect(last.items).toHaveLength(50);
    expect(last.total).toBe(5000);
    expect(last.totalBytes).toBe(500_000);
    expect(last.items.some(file => result.items.some(first => first.id === file.id))).toBe(false);
    const precise = await catalogue("q=bulk-CORP-1001-");
    expect(precise.items).toHaveLength(5);
    expect(precise.total).toBe(5);
    expect(precise.totalBytes).toBe(500);
    const pastEnd = await catalogue("q=bulk-&offset=1000000");
    expect(pastEnd.items).toEqual([]);
    expect(pastEnd.total).toBe(5000);
    expect(pastEnd.totalBytes).toBe(500_000);
  });

  test("search matches case-insensitive filename, issue key or title; percent/underscore are literal", async () => {
    expect((await catalogue("q=alpha")).items.map((file) => file.filename)).toEqual(["Alpha.png"]);
    expect((await catalogue(`q=${encodeURIComponent("  ПОРТАЛ  ")}`)).total).toBe(3);
    expect((await catalogue("q=corp-2")).total).toBe(1);
    expect((await catalogue(`q=${encodeURIComponent("100%_")}`)).total).toBe(1);
    expect((await catalogue("q=does-not-exist")).items).toEqual([]);
    expect((await catalogue("q=does-not-exist")).totalBytes).toBe(0);
  });

  test("type filters cover images, documents, archive extension fallback and other", async () => {
    const expected = { images: "Alpha.png", documents: "Отчёт 100%_готов.PDF", archives: "Backup.ZIP", other: "data.bin" };
    for (const [type, filename] of Object.entries(expected)) {
      const result = await catalogue(`type=${type}`);
      expect(result.total).toBe(1);
      expect(result.items[0].filename).toBe(filename);
      expect(result.items[0].type).toBe(type);
      expect(result.totalBytes).toBe(result.items[0].byteSize);
    }
    expect((await catalogue("type=images&q=CORP-2")).total).toBe(0);
  });

  test("sorting and pagination keep totals for the complete filtered result", async () => {
    const newest = await catalogue();
    expect(newest.items.map((file) => file.byteSize)).toEqual([40, 30, 20, 10]);
    expect((await catalogue("sort=oldest")).items.map((file) => file.byteSize)).toEqual([10, 20, 30, 40]);
    expect((await catalogue("sort=size")).items.map((file) => file.byteSize)).toEqual([40, 30, 20, 10]);
    expect((await catalogue("sort=name")).items.slice(0, 3).map((file) => file.filename)).toEqual(["Alpha.png", "Backup.ZIP", "data.bin"]);
    const page = await catalogue("limit=2&offset=1");
    expect(page.items.map((file) => file.id)).toEqual(newest.items.slice(1, 3).map((file) => file.id));
    expect({ total: page.total, totalBytes: page.totalBytes, limit: page.limit, offset: page.offset }).toEqual({ total: 4, totalBytes: 100, limit: 2, offset: 1 });
    expect((await catalogue("offset=50")).items).toEqual([]);
    expect((await catalogue("offset=50")).total).toBe(4);
  });

  test("invalid enum, page boundaries and oversized search return validation errors", async () => {
    for (const query of ["type=secret", "sort=filename%3Bdelete", "limit=0", "limit=51", "offset=-1", "offset=1.5", `q=${"a".repeat(251)}`]) {
      const res = await app.inject({ method: "GET", url: url(fx.projects.p1, query), headers: auth(token) });
      expect(res.statusCode, query).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION");
    }
  });
});
