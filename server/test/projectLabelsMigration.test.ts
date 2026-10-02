import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getApp, stopApp } from "./helpers.js";
import { withClient } from "../src/db.js";

const sql = readFileSync(new URL("../migrations/20261002T1700_project_labels_type.sql", import.meta.url), "utf8");
beforeAll(() => getApp());
afterAll(() => stopApp());

test.each(["json", "jsonb", "text[]"])("labels migration preserves values and is repeatable for %s", async type => {
  await withClient(async client => {
    await client.query("BEGIN");
    try {
      // Temporary projects shadows the real table: this test never changes application schema or records.
      await client.query(`CREATE TEMP TABLE projects (id int, suggested_labels ${type}) ON COMMIT DROP`);
      const labels = ["закупки", "a,b", 'say "hello"', "", "закупки"];
      await client.query("INSERT INTO projects VALUES (1, $1), (2, $2)", type === "text[]" ? [labels, []] : [JSON.stringify(labels), "[]"]);
      if (type !== "text[]") {
        await client.query("SAVEPOINT legacy_write");
        await expect(client.query("UPDATE projects SET suggested_labels = $1 WHERE id = 1", [labels])).rejects.toMatchObject({ code: "22P02" });
        await client.query("ROLLBACK TO SAVEPOINT legacy_write");
      }
      await client.query(sql);
      await client.query(sql);
      const rows = (await client.query("SELECT suggested_labels FROM projects ORDER BY id")).rows;
      expect(rows.map(row => row.suggested_labels)).toEqual([labels, []]);
      await client.query("UPDATE projects SET suggested_labels = $1 WHERE id = 1", [["new", "метка"]]);
      expect((await client.query("SELECT suggested_labels FROM projects WHERE id = 1")).rows[0].suggested_labels).toEqual(["new", "метка"]);
    } finally { await client.query("ROLLBACK"); }
  });
});

test.each(['{"label":"bad"}', '["ok", 1]', '[null]', 'null'])("invalid legacy labels abort conversion without changing data: %s", async value => {
  await withClient(async client => {
    await client.query("BEGIN");
    try {
      await client.query("CREATE TEMP TABLE projects (suggested_labels jsonb) ON COMMIT DROP");
      await client.query("INSERT INTO projects VALUES ($1)", [value]);
      await client.query("SAVEPOINT migration");
      await expect(client.query(sql)).rejects.toThrow(/migration cancelled/);
      await client.query("ROLLBACK TO SAVEPOINT migration");
      expect((await client.query("SELECT suggested_labels FROM projects")).rows[0].suggested_labels).toEqual(JSON.parse(value));
    } finally { await client.query("ROLLBACK"); }
  });
});

test("legacy SQL NULL becomes an empty array with a non-null default", async () => {
  await withClient(async client => {
    await client.query("BEGIN");
    try {
      await client.query("CREATE TEMP TABLE projects (suggested_labels json) ON COMMIT DROP");
      await client.query("INSERT INTO projects VALUES (NULL)");
      await client.query(sql);
      await client.query("INSERT INTO projects DEFAULT VALUES");
      expect((await client.query("SELECT suggested_labels FROM projects")).rows.map(row => row.suggested_labels)).toEqual([[], []]);
    } finally { await client.query("ROLLBACK"); }
  });
});
