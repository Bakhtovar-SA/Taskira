// Native PostgreSQL backup rehearsal; only disposable taskira_test_workspace_backup* databases.
import "./env.js";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { TEST_DB_NAME, TEST_DB_URL } from "./env.js";
import { initConfig, loadConfig } from "../src/config.js";
import { initPool, migrate, closePool } from "../src/db.js";
import {
  getApp,
  stopApp,
  resetDb,
  seedFixture,
  login,
  auth,
  q,
} from "./helpers.js";
import { seedWorkspace } from "./access/workspaceFixture.js";
import {
  getDocument,
  saveContent,
} from "../src/services/workspaceDocuments.js";
import { getStorage } from "../src/services/storage.js";
if (!TEST_DB_NAME.startsWith("taskira_test_workspace_backup"))
  throw new Error("A disposable backup rehearsal database is required");
const [mode, output] = process.argv.slice(2);
if (!["seed", "verify"].includes(mode) || !output)
  throw new Error("seed|verify OUTPUT.json required");
initConfig();
if (mode === "seed") {
  initPool(TEST_DB_URL);
  await migrate();
  await closePool();
}
const app = await getApp();
if (mode === "seed") {
  await resetDb();
  const f = await seedFixture(),
    token = await login(app, "admin");
  const fixture = await seedWorkspace(app, f.projects.p1, token, f.users.mgr1);
  const row = await getDocument(f.projects.p1, fixture.workspaceDocument),
    document = new Y.Doc();
  Y.applyUpdate(document, row.content!);
  const paragraph = document.getXmlFragment("default").get(0) as Y.XmlElement;
  if (!paragraph.length) paragraph.insert(0, [new Y.XmlText()]);
  (paragraph.get(0) as Y.XmlText).insert(0, "backup-checkpoint");
  await saveContent(
    f.projects.p1,
    row.id,
    row.generation,
    document,
    f.users.mgr1,
  );
  document.destroy();
  const version = (
    await app.inject({
      method: "POST",
      url: `/api/projects/${f.projects.p1}/documents/${row.id}/versions`,
      headers: auth(token),
      payload: { name: "Backup checkpoint" },
    })
  ).json();
  const verified = await app.inject({
    method: "POST",
    url: `/api/projects/${f.projects.p1}/documents/${row.id}/verify`,
    headers: auth(token),
    payload: { versionId: version.id, validUntil: "2027-02-10" },
  });
  if (verified.statusCode !== 200) throw new Error(verified.body);
}
const tables = await q<{ name: string }>(
  "SELECT tablename name FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'workspace_%' ORDER BY tablename",
);
const records = [];
for (const { name } of tables) {
  if (!/^workspace_[a-z_]+$/.test(name)) throw new Error("Unexpected table");
  records.push({
    table: name,
    ...(
      await q<{ count: number; hash: string }>(
        `SELECT count(*)::integer count,md5(COALESCE(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) hash FROM ${name} t`,
      )
    )[0],
  });
}
const storage = await getStorage(loadConfig()),
  files = [];
for (const file of await q<{ storage_key: string }>(
  "SELECT storage_key FROM workspace_document_files ORDER BY storage_key",
)) {
  const hash = createHash("sha256");
  for await (const chunk of await storage.get(file.storage_key))
    hash.update(chunk);
  files.push({ key: file.storage_key, sha256: hash.digest("hex") });
}
if (
  !(
    await q(
      "SELECT id FROM workspace_documents WHERE search_text='backup-checkpoint' AND verified_version_id IS NOT NULL",
    )
  ).length
)
  throw new Error("CRDT checkpoint or verification missing");
if (!files.length) throw new Error("Document attachment missing");
await writeFile(output, JSON.stringify({ records, files }, null, 2));
await stopApp();
console.log(
  `Backup rehearsal ${mode}: ${records.length} workspace tables and ${files.length} files verified`,
);
