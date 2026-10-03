import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getApp, stopApp } from "./helpers.js";
import { withClient } from "../src/db.js";

const sql = readFileSync(new URL("../migrations/20261003T0100_avatar_content_type.sql", import.meta.url), "utf8");
beforeAll(() => getApp());
afterAll(() => stopApp());

test("repairs missing avatar MIME metadata without losing avatars; repeatable and transactional", async () => {
  await withClient(async client => {
    await client.query("BEGIN");
    try {
      // Shadows users only on this connection, never alters application records.
      await client.query("CREATE TEMP TABLE users (id int, avatar_key text) ON COMMIT DROP");
      await client.query("INSERT INTO users VALUES (1, 'existing/avatar.png'), (2, NULL)");
      await client.query("SAVEPOINT missing_column");
      await expect(client.query("UPDATE users SET avatar_content_type = 'image/png' WHERE id = 1")).rejects.toMatchObject({ code: "42703" });
      await client.query("ROLLBACK TO SAVEPOINT missing_column");
      await client.query("SAVEPOINT repair");
      await client.query(sql);
      expect((await client.query("SELECT avatar_key, avatar_content_type FROM users ORDER BY id")).rows).toEqual([
        { avatar_key: "existing/avatar.png", avatar_content_type: null },
        { avatar_key: null, avatar_content_type: null },
      ]);
      await client.query("UPDATE users SET avatar_content_type = 'image/png' WHERE id = 1");
      await client.query(sql);
      expect((await client.query("SELECT avatar_content_type FROM users WHERE id = 1")).rows[0].avatar_content_type).toBe("image/png");
      await client.query("ROLLBACK TO SAVEPOINT repair");
      await expect(client.query("SELECT avatar_content_type FROM users")).rejects.toMatchObject({ code: "42703" });
    } finally { await client.query("ROLLBACK"); }
  });
});
