import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, login, q, resetDb, seedFixture, stopApp, type Fixture } from "./helpers.js";

function multipart(filename: string, data: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----taskira-avatar-${Math.random().toString(16).slice(2)}`;
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("avatar image body"),
]);

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

describe("user avatars", () => {
  test("owner uploads it, any authenticated user can read it, and owner can remove it", async () => {
    const owner = await login(app, "emp1");
    const viewer = await login(app, "viw1");
    const file = multipart("profile.png", PNG);

    const upload = await app.inject({
      method: "POST",
      url: "/api/me/avatar",
      headers: { ...auth(owner), ...file.headers },
      payload: file.payload,
    });
    expect(upload.statusCode).toBe(200);
    expect(JSON.parse(upload.body).avatarUpdatedAt).toEqual(expect.any(Number));

    const row = (await q<{ avatar_key: string | null }>("SELECT avatar_key FROM users WHERE id = $1", [fx.users.emp1]))[0];
    expect(row.avatar_key).toBeTruthy();

    const get = await app.inject({ url: `/api/users/${fx.users.emp1}/avatar`, headers: auth(viewer) });
    expect(get.statusCode).toBe(200);
    expect(get.headers["content-type"]).toContain("image/png");
    expect(get.rawPayload).toEqual(PNG);
    expect(get.headers["cache-control"]).toContain("immutable");

    const anonymous = await app.inject({ url: `/api/users/${fx.users.emp1}/avatar` });
    expect(anonymous.statusCode).toBe(401);

    const remove = await app.inject({ method: "DELETE", url: "/api/me/avatar", headers: auth(owner) });
    expect(remove.statusCode).toBe(204);
    expect((await app.inject({ url: `/api/users/${fx.users.emp1}/avatar`, headers: auth(viewer) })).statusCode).toBe(404);
  });

  test("renamed non-image is rejected", async () => {
    const token = await login(app, "emp1");
    const file = multipart("profile.png", Buffer.from("plain text, not an image"));
    const res = await app.inject({
      method: "POST",
      url: "/api/me/avatar",
      headers: { ...auth(token), ...file.headers },
      payload: file.payload,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("AVATAR_REJECTED");
  });
});
