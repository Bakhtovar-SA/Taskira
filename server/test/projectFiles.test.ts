import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  getApp,
  stopApp,
  resetDb,
  seedFixture,
  login,
  auth,
  q,
  type Fixture,
} from "./helpers.js";

let app: FastifyInstance, fixture: Fixture;
let tokens: Record<string, string>;
const base = () => `/api/projects/${fixture.projects.p1}`;
const get = (path: string, actor = "viw1") =>
  app.inject({ url: path, headers: auth(tokens[actor]) });
async function upload(path: string, filename: string, contents: string) {
  const boundary = `taskira${randomUUID()}`;
  const result = await app.inject({
    method: "POST",
    url: path,
    headers: {
      ...auth(tokens.admin),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${contents}\r\n--${boundary}--\r\n`,
    ),
  });
  expect(result.statusCode, result.body).toBe(201);
  return result.json();
}
async function document() {
  const enabled = await app.inject({
    method: "PATCH",
    url: `${base()}/workspace/modules`,
    headers: auth(tokens.admin),
    payload: {
      documents: true,
      objects: false,
      processes: false,
      planning: false,
    },
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
  const result = await app.inject({
    method: "POST",
    url: `${base()}/documents`,
    headers: auth(tokens.admin),
    payload: { title: "Протокол проверки" },
  });
  expect(result.statusCode, result.body).toBe(201);
  return result.json();
}
beforeAll(async () => {
  app = await getApp();
});
afterAll(stopApp);
beforeEach(async () => {
  await resetDb();
  fixture = await seedFixture();
  tokens = {};
  for (const who of ["admin", "viw1", "outsider"])
    tokens[who] = await login(app, who);
});

test("file catalogue switch persists; old clients preserve it and disabling never deletes attachments", async () => {
  await upload(
    `${base()}/issues/${fixture.issues.p1issue}/attachments`,
    "retained.txt",
    "retained",
  );
  const state = (await get(`${base()}/workspace/modules`)).json();
  expect(state.files).toBe(true);
  const changed = await app.inject({
    method: "PATCH",
    url: `${base()}/workspace/modules`,
    headers: auth(tokens.admin),
    payload: { ...state, files: false },
  });
  expect(changed.statusCode, changed.body).toBe(200);
  expect((await get(`${base()}/workspace/modules`)).json().files).toBe(false);
  const { files: _files, ...legacy } = state;
  const olderClient = await app.inject({
    method: "PATCH",
    url: `${base()}/workspace/modules`,
    headers: auth(tokens.admin),
    payload: legacy,
  });
  expect(olderClient.statusCode, olderClient.body).toBe(200);
  expect(olderClient.json().files).toBe(false);
  expect((await get(`${base()}/files`)).json().items[0].filename).toBe(
    "retained.txt",
  );
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: `${base()}/workspace/modules`,
        headers: auth(tokens.viw1),
        payload: state,
      })
    ).statusCode,
  ).toBe(403);
});

test("catalogue combines original attachments with source links and remains readable when modules are disabled", async () => {
  const doc = await document();
  const issueFile = await upload(
    `${base()}/issues/${fixture.issues.p1issue}/attachments`,
    "evidence.txt",
    "issue evidence",
  );
  const docFile = await upload(
    `${base()}/documents/${doc.id}/attachments`,
    "protocol.txt",
    "document evidence",
  );
  const disabled = await app.inject({
    method: "PATCH",
    url: `${base()}/workspace/modules`,
    headers: auth(tokens.admin),
    payload: {
      documents: false,
      objects: false,
      processes: false,
      planning: false,
      files: false,
    },
  });
  expect(disabled.statusCode, disabled.body).toBe(200);
  const result = await get(`${base()}/files`);
  expect(result.statusCode, result.body).toBe(200);
  const body = result.json();
  expect(body.total).toBe(2);
  expect(body.totalBytes).toBe(
    Buffer.byteLength("issue evidence") +
      Buffer.byteLength("document evidence"),
  );
  expect(body.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: issueFile.id,
        filename: "evidence.txt",
        source: {
          kind: "issue",
          id: fixture.issues.p1issue,
          title: "t",
          key: "CORP-1",
          archived: false,
        },
      }),
      expect.objectContaining({
        id: docFile.id,
        source: {
          kind: "document",
          id: doc.id,
          title: doc.title,
          key: null,
          archived: false,
        },
      }),
    ]),
  );
  expect(result.body).not.toMatch(/storage_key|storageKey|sha256/);
  const downloaded = await get(
    `${base()}/documents/${doc.id}/attachments/${docFile.id}`,
  );
  expect(downloaded.statusCode).toBe(200);
  expect(downloaded.body).toBe("document evidence");
});

test("project membership is required even for an invited task collaborator; another project's files never enter totals", async () => {
  await upload(
    `/api/projects/${fixture.projects.p2}/issues/${fixture.issues.p2issue}/attachments`,
    "private.txt",
    "secret",
  );
  await q("INSERT INTO issue_collaborators(issue_id,user_id) VALUES($1,$2)", [
    fixture.issues.p1issue,
    fixture.users.outsider,
  ]);
  expect((await get(`${base()}/files`, "outsider")).statusCode).toBe(403);
  const result = await get(`${base()}/files`, "admin");
  expect(result.json()).toMatchObject({ total: 0, totalBytes: 0, items: [] });
  expect(
    (await get(`/api/projects/${fixture.projects.p2}/files`)).statusCode,
  ).toBe(403);
});

test("literal search covers file names and source keys; paging preserves filtered totals and deterministic sorting", async () => {
  await upload(
    `${base()}/issues/${fixture.issues.p1issue}/attachments`,
    "b_100%.txt",
    "123",
  );
  await upload(
    `${base()}/issues/${fixture.issues.p1issue}/attachments`,
    "a.txt",
    "12345",
  );
  const page = (
    await get(
      `${base()}/files?source=issue&sort=name&limit=1&offset=1&q=corp-1`,
    )
  ).json();
  expect(page).toMatchObject({ total: 2, totalBytes: 8, offset: 1, limit: 1 });
  expect(page.items.map((file: { filename: string }) => file.filename)).toEqual(
    ["b_100%.txt"],
  );
  expect((await get(`${base()}/files?q=100%25`)).json().total).toBe(1);
  expect((await get(`${base()}/files?q=%25`)).json().total).toBe(1);
  expect((await get(`${base()}/files?source=document`)).json().total).toBe(0);
  expect(
    (await get(`${base()}/files?sort=size&limit=1`)).json().items[0].filename,
  ).toBe("a.txt");
  expect((await get(`${base()}/files?sort=invalid`)).statusCode).toBe(400);
  expect((await get(`${base()}/files?offset=-1`)).statusCode).toBe(400);
});

test("archiving sources keeps their attachments and marks their origin; deletion removes the original from the catalogue", async () => {
  const doc = await document();
  const file = await upload(
    `${base()}/documents/${doc.id}/attachments`,
    "archive.txt",
    "retained",
  );
  await upload(
    `${base()}/issues/${fixture.issues.p1issue}/attachments`,
    "issue.txt",
    "retained too",
  );
  await q("UPDATE workspace_documents SET archived=true WHERE id=$1", [doc.id]);
  await q("UPDATE issues SET archived_at=now() WHERE id=$1", [
    fixture.issues.p1issue,
  ]);
  const body = (await get(`${base()}/files`)).json();
  expect(body.total).toBe(2);
  expect(
    body.items.every(
      (item: { source: { archived: boolean } }) => item.source.archived,
    ),
  ).toBe(true);
  await q("DELETE FROM workspace_document_files WHERE id=$1", [file.id]);
  expect((await get(`${base()}/files`)).json().total).toBe(1);
});
