import { expect, test, type Browser, type BrowserContext, type Page, type WebSocketRoute } from "@playwright/test";
import { boardFixture } from "./board-fixture";

// Existing browser tests mock HTTP. Exercise the real UI, store, socket and
// HTTP refresh with shared API data. Database delivery belongs to server tests.
type Issue = Awaited<ReturnType<typeof boardFixture>>["issues"][number];
type Peer = {
  page: Page; context: BrowserContext; offline: boolean; sockets: Set<WebSocketRoute>;
  subscriptions: { projectId: string; cursor: string | null }[];
  reads: (string | null)[]; navigations: number;
};

async function collaborationFixture(browser: Browser, baseURL: string) {
  const peers: Peer[] = [];
  let issues: Issue[] = [], cursor = 0, retainedFrom = 0, conflicts = 0;
  const journal: { cursor: number; id: string }[] = [];
  const batch = (from: string | null) => {
    const reset = from === null || Number(from) < retainedFrom;
    return {
      type: "sync", projectId: "p1", cursor: String(cursor), reset,
      issueIds: reset ? [] : [...new Set(journal.filter(event => event.cursor > Number(from)).map(event => event.id))],
      ts: Date.now(),
    };
  };
  const hint = () => {
    for (const peer of peers) if (!peer.offline) {
      for (const socket of peer.sockets) socket.send(JSON.stringify(batch(String(Math.max(0, cursor - 1)))));
    }
  };
  const changed = (id: string) => {
    journal.push({ cursor: ++cursor, id });
    const issue = issues.find(item => item.id === id);
    if (issue) issue.updatedAt = new Date(Date.parse("2026-10-04T07:00:00Z") + cursor).toISOString();
    hint();
  };
  const addPeer = async (userIndex: number) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const fixture = await boardFixture(page);
    if (peers.length === 0) issues = fixture.issues.map(issue => ({ ...issue, epicId: null }));
    const peer: Peer = { page, context, offline: false, sockets: new Set(), subscriptions: [], reads: [], navigations: 0 };
    peers.push(peer);
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) peer.navigations++; });
    await page.route("**/api/**", async route => {
      if (peer.offline) return route.abort("internetdisconnected");
      const request = route.request(), url = new URL(request.url());
      const path = url.pathname, method = request.method();
      if (path === "/api/auth/me") return route.fulfill({ json: {
        ...fixture.users[userIndex], favoriteProjectIds: ["p1"], onboarding: { hidden: true },
      } });
      if (path === "/api/projects/p1/sync") {
        const from = url.searchParams.get("cursor"); peer.reads.push(from);
        return route.fulfill({ json: batch(from) });
      }
      if (path === "/api/projects/p1/issues" && method === "POST") {
        const id = `rt${cursor + 1}`;
        const issue = {
          ...issues[0], ...request.postDataJSON(), id, key: `CORP-${issues.length + 1}`,
          rank: issues.length, dueDate: null, doneAt: null, repeat: null,
          createdAt: "2026-10-04T07:00:00Z", updatedAt: "2026-10-04T07:00:00Z",
        } as Issue;
        issues.push(issue); changed(id);
        return route.fulfill({ json: issue });
      }
      if (path === "/api/projects/p1/issues" || path === "/api/projects/p1/issues/counts") {
        const params = url.searchParams;
        const items = issues.filter(issue =>
          (!params.get("status") || issue.statusId === params.get("status")) &&
          (!params.get("q") || String(issue.title).toLowerCase().includes(params.get("q")!.toLowerCase())) &&
          (!params.get("parentId") || issue.parentId === params.get("parentId")) &&
          (params.get("closed") !== "hide" || issue.statusId !== "s4") &&
          (params.get("closed") !== "older" || issue.id === "i9") &&
          (params.get("closed") !== "recent" || issue.id !== "i9"));
        return route.fulfill({ json: path.endsWith("/counts") ? {
          total: items.length,
          byStatus: Object.fromEntries(fixture.statuses.map(status => [status.id, items.filter(issue => issue.statusId === status.id).length])),
        } : { items, hasMore: false, nextCursor: null } });
      }
      const match = /^\/api\/projects\/p1\/issues\/([^/]+)(?:\/(.*))?$/.exec(path);
      if (match && !["epics", "assignees"].includes(match[1])) {
        const issue = issues.find(item => item.id === match[1]);
        if (!issue) return route.fulfill({ status: 404, json: { error: "not_found", message: "Задача не найдена" } });
        const childPath = match[2];
        if (childPath === "transition" && method === "POST") {
          issue.statusId = request.postDataJSON().to; changed(issue.id);
        } else if (!childPath && method === "PATCH") {
          const { expectedVersion, ...patch } = request.postDataJSON();
          if (expectedVersion !== undefined && Date.parse(expectedVersion) !== Date.parse(issue.updatedAt)) {
            conflicts++;
            return route.fulfill({ status: 409, json: { error: { code: "STALE_VERSION", reason: "Задачу изменил другой участник" } } });
          }
          Object.assign(issue, patch); changed(issue.id);
        } else if (!childPath && method === "DELETE") {
          issues = issues.filter(item => item.id !== issue.id); changed(issue.id);
          return route.fulfill({ json: { ok: true } });
        } else if (childPath === "comments" || childPath === "activity" || childPath === "collaborators") {
          return route.fulfill({ json: [] });
        }
        if (!childPath || childPath === "transition") return route.fulfill({ json: {
          ...issue, attachments: [], links: [], checklist: [], customFieldValues: [], collaboratorIds: [],
          comments: [], activity: [], watch: { watching: false, watchers: 0 }, subtasksSummary: { total: 0, done: 0 },
        } });
      }
      return route.fallback();
    });
    // Last registered route replaces shellFixture's deliberately closed socket.
    await page.routeWebSocket("**/api/ws", socket => {
      if (peer.offline) { void socket.close({ code: 1013 }); return; }
      peer.sockets.add(socket);
      socket.onClose(() => { peer.sockets.delete(socket); });
      socket.onMessage(raw => {
        const message = JSON.parse(String(raw));
        if (message.type === "sync:subscribe") {
          peer.subscriptions.push(message);
          socket.send(JSON.stringify(batch(message.cursor ?? null)));
        } else if (message.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
      });
      socket.send(JSON.stringify({ type: "auth_ok" }));
    });
    await page.goto("/p/CORP/board");
    await expect(page.locator('.board-card[data-issue-id="i1"]')).toBeVisible();
    await expect.poll(() => peer.subscriptions.some(item => item.projectId === "p1")).toBe(true);
    await expect.poll(() => peer.reads.length).toBeGreaterThan(0);
    // Observe a follow-up read from the applied cursor before disconnecting.
    // Seeing the first request alone does not mean its refresh was acknowledged.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => peer.reads.includes("0")).toBe(true);
    return peer;
  };
  const author = await addPeer(0), observer = await addPeer(1);
  return {
    author, observer, hint,
    get cursor() { return cursor; },
    get conflicts() { return conflicts; },
    pruneHistory: () => { retainedFrom = cursor; },
    disconnect: async () => {
      observer.offline = true;
      await observer.context.setOffline(true);
      const sockets = [...observer.sockets]; observer.sockets.clear();
      await Promise.all(sockets.map(socket => socket.close({ code: 1012, reason: "Connection interrupted" })));
    },
    reconnect: async () => { observer.offline = false; await observer.context.setOffline(false); },
    dispose: () => Promise.all(peers.map(peer => peer.context.close())),
  };
}

const column = (page: Page, name: string) => page.locator(".board-col").filter({ has: page.getByRole("heading", { name, exact: true }) });
const card = (page: Page, id: string) => page.locator(`.board-card[data-issue-id="${id}"]`);
const count = (page: Page, name: string) => column(page, name).locator(".board-col-header > span.tabular");
async function create(page: Page, title: string) {
  const todo = column(page, "К выполнению");
  await todo.getByRole("button", { name: "Добавить в «К выполнению»", exact: true }).click();
  await todo.getByRole("textbox").fill(title);
  await todo.getByRole("textbox").press("Enter");
  await expect(page.locator(".board-card").filter({ hasText: title })).toBeVisible();
}
async function move(page: Page, id: string) {
  await card(page, id).locator(".board-card-open").focus();
  await page.keyboard.press("m");
  await page.getByRole("menuitem", { name: "В работе", exact: true }).click();
}

test.describe("realtime collaboration", () => {
  test.setTimeout(60_000);

  test("another user sees creation, move, deletion and counters without navigation", async ({ browser, baseURL }) => {
    const fixture = await collaborationFixture(browser, baseURL!);
    const { page: author } = fixture.author, { page: observer } = fixture.observer;
    try {
      const navigations = fixture.observer.navigations;
      await expect(count(observer, "К выполнению")).toHaveText("3");
      await create(author, "Совместная задача");
      await expect(card(observer, "rt1")).toContainText("Совместная задача", { timeout: 5_000 });
      await expect(count(observer, "К выполнению")).toHaveText("4");
      await move(author, "rt1");
      await expect(column(observer, "В работе").locator('[data-issue-id="rt1"]')).toBeVisible({ timeout: 5_000 });
      await expect(count(observer, "К выполнению")).toHaveText("3");
      await expect(count(observer, "В работе")).toHaveText("3");
      await card(author, "rt1").locator(".board-card-open").click();
      await author.locator(".issue-toolbar").getByRole("button", { name: "Действия", exact: true }).click();
      await author.getByRole("menuitem", { name: "Удалить", exact: true }).click();
      await author.getByRole("dialog", { name: "Вы действительно хотите удалить задачу?", exact: true }).getByRole("button", { name: "Удалить", exact: true }).click();
      await expect(card(observer, "rt1")).toHaveCount(0, { timeout: 5_000 });
      await expect(count(observer, "В работе")).toHaveText("2");
      expect(fixture.observer.navigations).toBe(navigations);
    } finally { await fixture.dispose(); }
  });

  for (const retained of [true, false]) test(`reconnect recovers missed changes with ${retained ? "cursor replay" : "expired history reset"}`, async ({ browser, baseURL }) => {
    const fixture = await collaborationFixture(browser, baseURL!);
    const { page: author } = fixture.author, { page: observer } = fixture.observer;
    try {
      const navigations = fixture.observer.navigations, before = String(fixture.cursor);
      const connections = fixture.observer.subscriptions.length;
      await fixture.disconnect();
      await create(author, "Создано во время обрыва");
      await move(author, "i1");
      await expect(card(observer, "rt1")).toHaveCount(0);
      if (!retained) fixture.pruneHistory();
      fixture.observer.reads.length = 0;
      await fixture.reconnect();
      await expect(card(observer, "rt1")).toBeVisible({ timeout: 10_000 });
      await expect(column(observer, "В работе").locator('[data-issue-id="i1"]')).toBeVisible();
      await expect.poll(() => fixture.observer.reads.includes(before)).toBe(true);
      await expect.poll(() => fixture.observer.subscriptions.length).toBeGreaterThan(connections);
      fixture.hint(); fixture.hint();
      await expect(card(observer, "rt1")).toHaveCount(1);
      await expect(count(observer, "К выполнению")).toHaveText("3");
      await expect(count(observer, "В работе")).toHaveText("3");
      expect(fixture.observer.navigations).toBe(navigations);
    } finally { await fixture.dispose(); }
  });

  test("remote rename preserves drafts and stale saves require explicit conflict resolution", async ({ browser, baseURL }) => {
    const fixture = await collaborationFixture(browser, baseURL!);
    const { page: author } = fixture.author, { page: observer } = fixture.observer;
    try {
      for (const page of [author, observer]) await card(page, "i1").locator(".board-card-open").click();
      const panel = observer.getByRole("dialog");
      const comment = panel.getByRole("textbox", { name: "Комментарии", exact: true });
      await comment.fill("Комментарий, который ещё не отправлен");
      await panel.getByRole("button", { name: /^Переименовать/ }).click();
      const title = panel.getByRole("textbox", { name: /^Переименовать/ });
      await title.fill("Мой несохранённый заголовок");
      await author.getByRole("dialog").getByRole("button", { name: /^Переименовать/ }).click();
      const authorTitle = author.getByRole("dialog").getByRole("textbox", { name: /^Переименовать/ });
      await authorTitle.fill("Заголовок другого участника");
      await authorTitle.press("Enter");
      // Label derives from refreshed issue; value remains the unsaved local draft.
      await expect(title).toHaveAttribute("aria-label", /Заголовок другого участника/, { timeout: 5_000 });
      await expect(title).toHaveValue("Мой несохранённый заголовок");
      await expect(title).toBeFocused();
      await expect(comment).toHaveValue("Комментарий, который ещё не отправлен");
      await expect(panel.getByText("Сейчас на сервере: Заголовок другого участника", { exact: true })).toBeVisible();
      await title.press("Enter");
      await expect.poll(() => fixture.conflicts).toBe(1);
      await expect(title).toHaveValue("Мой несохранённый заголовок");
      await panel.getByRole("button", { name: "Сохранить мой вариант", exact: true }).click();
      await expect(panel.getByRole("button", { name: /Переименовать.*Мой несохранённый заголовок/ })).toBeVisible();
      await expect(author.getByRole("dialog").getByRole("button", { name: /Переименовать.*Мой несохранённый заголовок/ })).toBeVisible();
      await expect(comment).toHaveValue("Комментарий, который ещё не отправлен");
    } finally { await fixture.dispose(); }
  });
});
