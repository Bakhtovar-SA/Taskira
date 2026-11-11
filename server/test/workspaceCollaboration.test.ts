import { beforeAll, afterAll, test, expect } from "vitest";
import WebSocket from "ws";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import {
  getApp,
  stopApp,
  resetDb,
  seedFixture,
  login,
  auth,
  q,
} from "./helpers.js";

let app: Awaited<ReturnType<typeof getApp>>;
let base: string;
const providers: HocuspocusProvider[] = [];
beforeAll(async () => {
  app = await getApp();
  base = (await app.listen({ host: "127.0.0.1", port: 0 })).replace(
    "http",
    "ws",
  );
});
afterAll(async () => {
  for (const p of providers) p.destroy();
  await stopApp();
});
async function until(check: () => boolean | Promise<boolean>, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end)
      throw new Error("Collaboration did not reach the expected state");
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}
test("notification transport retains its 8 KiB limit alongside document collaboration", async () => {
  const socket = new WebSocket(`${base}/api/ws`);
  const closed = new Promise<number>((resolve, reject) => {
    socket.once("error", reject);
    socket.once("close", resolve);
    socket.once("open", () => socket.send(Buffer.alloc(8193, 32)));
  });
  try {
    expect(await closed).toBe(1009);
  } finally {
    socket.terminate();
  }
});
test("two editors merge changes, reconnect pending edits, and persist across fresh connections", async () => {
  await resetDb();
  const f = await seedFixture();
  const token = await login(app, "mgr1");
  const call = (
    method: "POST" | "PATCH" | "GET",
    path: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/projects/${f.projects.p1}${path}`,
      headers: auth(token),
      ...(payload ? { payload } : {}),
    });
  await call("PATCH", "/workspace/modules", {
    documents: true,
    objects: true,
    processes: true,
    planning: true,
  });
  const d = (await call("POST", "/documents", { title: "Concurrent" })).json();
  const connect = async (username: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username, password: f.pass },
    });
    const raw = res.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0] : (raw ?? "")).split(";", 1)[0];
    class CookieSocket extends WebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols, { headers: { cookie } });
        this.on("unexpected-response", (_req, res) =>
          console.error("WS RESPONSE", res.statusCode, url),
        );
        this.on("error", (error) => console.error("WS ERROR", error.message));
      }
    }
    const document = new Y.Doc();
    let synced = false;
    const provider = new HocuspocusProvider({
      url: `${base}/api/projects/${f.projects.p1}/documents/${d.id}/collaboration?generation=${d.generation}`,
      WebSocketPolyfill: CookieSocket,
      name: `${f.projects.p1}:${d.id}:${d.generation}`,
      document,
      token: "cookie",
      onAuthenticationFailed: ({ reason }) =>
        console.error("COLLAB AUTH", reason),
      onSynced: () => {
        synced = true;
      },
    } as ConstructorParameters<typeof HocuspocusProvider>[0]);
    providers.push(provider);
    await until(() => synced);
    return { provider, document };
  };
  const a = await connect("mgr1"),
    b = await connect("emp1");
  const text = (doc: Y.Doc) =>
    (doc.getXmlFragment("default").get(0) as Y.XmlElement).get(0) as Y.XmlText;
  // Blank documents have a paragraph; insert a text child exactly once.
  const paragraph = a.document.getXmlFragment("default").get(0) as Y.XmlElement;
  if (!paragraph.length) paragraph.insert(0, [new Y.XmlText()]);
  await until(
    () =>
      !!(b.document.getXmlFragment("default").get(0) as Y.XmlElement).length,
  );
  text(a.document).insert(0, "alpha ");
  text(b.document).insert(0, "beta ");
  await until(
    () =>
      text(a.document).toString().includes("beta") &&
      text(b.document).toString().includes("alpha"),
  );
  b.provider.disconnect();
  await until(
    () => b.provider.configuration.websocketProvider.status === "disconnected",
  );
  text(b.document).insert(text(b.document).length, "offline");
  text(a.document).insert(text(a.document).length, "online");
  await b.provider.connect();
  await until(
    () =>
      text(a.document).toString().includes("offline") &&
      text(b.document).toString().includes("online"),
  );
  a.provider.sendStateless(JSON.stringify({ type: "persist" }));
  await until(async () =>
    (
      await q<{ search_text: string }>(
        "SELECT search_text FROM workspace_documents WHERE id=$1",
        [d.id],
      )
    )[0].search_text.includes("offline"),
  );
  const viewer = await connect("viw1");
  text(viewer.document).insert(0, "forbidden");
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(text(a.document).toString()).not.toContain("forbidden");
  a.provider.destroy();
  b.provider.destroy();
  viewer.provider.destroy();
  await stopApp();
  app = await getApp();
  base = (await app.listen({ host: "127.0.0.1", port: 0 })).replace(
    "http",
    "ws",
  );
  const fresh = await connect("mgr1");
  expect(text(fresh.document).toString()).toContain("alpha");
  expect(text(fresh.document).toString()).toContain("offline");
  expect(text(fresh.document).toString()).not.toContain("forbidden");
  const version = await call("POST", `/documents/${d.id}/versions`, {
    name: "Pinned",
  });
  expect(version.statusCode, version.body).toBe(200);
  text(fresh.document).insert(0, "after_checkpoint ");
  fresh.provider.sendStateless(JSON.stringify({ type: "persist" }));
  await until(async () =>
    (
      await q<{ search_text: string }>(
        "SELECT search_text FROM workspace_documents WHERE id=$1",
        [d.id],
      )
    )[0].search_text.includes("after_checkpoint"),
  );
  const restored = await call("POST", `/documents/${d.id}/restore`, {
    versionId: version.json().id,
  });
  expect(restored.statusCode, restored.body).toBe(200);
  fresh.provider.destroy();
  d.generation = restored.json().generation;
  const rebased = await connect("mgr1");
  expect(text(rebased.document).toString()).not.toContain("after_checkpoint");
  expect(text(rebased.document).toString()).toContain("offline");
  // A multibyte document near its storage cap must fit the existing WS frame limit.
  text(rebased.document).insert(
    text(rebased.document).length,
    "界".repeat(330000),
  );
  expect(Y.encodeStateAsUpdate(rebased.document).byteLength).toBeGreaterThan(
    900000,
  );
  expect(Y.encodeStateAsUpdate(rebased.document).byteLength).toBeLessThan(
    1000000,
  );
  rebased.provider.sendStateless(JSON.stringify({ type: "persist" }));
  await until(
    async () =>
      (
        await q<{ size: number }>(
          "SELECT octet_length(content) size FROM workspace_documents WHERE id=$1",
          [d.id],
        )
      )[0].size > 900000,
  );
  rebased.provider.destroy();
  const large = await connect("emp1");
  expect(text(large.document).length).toBeGreaterThanOrEqual(330000);
  large.provider.destroy();
}, 25000);
