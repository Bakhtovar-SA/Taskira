
import type { Page } from "@playwright/test";

const project = { id: "p1", key: "TEST", name: "Test project", description: "", departmentId: null, isShared: false, sprintsEnabled: true, defaultView: null, suggestedLabels: [], icon: null, color: null, background: null, backgroundPhoto: null, isDemo: false };
const user = { id: "u1", username: "admin", name: "Test Admin", initials: "TA", color: "", jobRole: "", globalRole: "admin", isActive: true, authSource: "local", favoriteProjectIds: [], notifyPrefs: {}, onboarding: { hidden: true } };
const boot = { project, users: [user], members: [{ userId: "u1", role: "admin" }], workflow: { statuses: [{ id: "s1", sid: "todo", name: "Todo", category: "todo", position: 0 }], transitions: [] }, issueTemplates: [], customFields: [], sprints: [] };
export async function mockApi(page: Page, userOverrides: Partial<typeof user> & { givenName?: string | null } = {}) {
  const profile = { ...user, ...userOverrides };
  // Ordinary UI fixtures represent a healthy server with no remote writes.
  // Realtime scenarios replace these routes with their shared journal. Returning
  // [] or closing every socket would put unrelated tests into recovery mode.
  const sync = (projectId: string, cursor: string | null) => ({
    type: "sync", projectId, cursor: "0", issueIds: [], reset: cursor !== "0", ts: Date.now(),
  });
  await page.routeWebSocket("**/api/ws", socket => {
    socket.send(JSON.stringify({ type: "auth_ok" }));
    socket.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.type === "auth") socket.send(JSON.stringify({ type: "auth_ok" }));
      if (message.type === "sync:subscribe") socket.send(JSON.stringify(sync(message.projectId, message.cursor)));
    });
    const heartbeat = setInterval(() => socket.send(JSON.stringify({ type: "heartbeat", ts: Date.now() })), 25_000);
    heartbeat.unref();
    socket.onClose(() => clearInterval(heartbeat));
    page.once("close", () => clearInterval(heartbeat));
  });
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  page.on("console", (msg) => { if (msg.type() === "error") console.error("browser:", msg.text()); });
  let brand = { name: null, hue: null, logoUpdatedAt: null, transparencyDefault: "auto" };
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    const path = pathname.replace(/^\/api/, "");
    const method = route.request().method();
    let body: unknown = [];
    if (path === "/admin/setup") body = { completed: true };
    else if (/^\/projects\/[^/]+\/sync$/.test(path)) {
      body = sync(path.split("/")[2], new URL(route.request().url()).searchParams.get("cursor"));
    }
    else if (path === "/me/onboarding") body = { done: [], hints: [], hidden: true };
    else if (path === "/auth/me") body = profile;
    else if (path === "/auth/config") body = { authMode: "local" };
    else if (path === "/projects") body = [project];
    else if (path === "/dashboards") body = [];
    else if (path === "/projects/p1") body = { ...boot, users: [profile] };
    else if (path === "/instance/brand") body = brand;
    else if (path === "/roadmap") body = { projects: [], dependencies: [] };
    else if (path === "/issues/assigned-to-me") body = { items: [], truncated: false, limit: 100 };
    else if (path === "/issues/search") body = { items: [], truncated: false };
    else if (path === "/admin/brand" && method === "PATCH") {
      const patch = route.request().postDataJSON();
      writes.push({ path, body: patch });
      brand = { ...brand, ...patch }; body = brand;
    } else if (path === "/projects/p1/issues" && method === "POST") {
      const draft = route.request().postDataJSON(); writes.push({ path, body: draft });
      body = { ...draft, id: "i1", key: "TEST-1", reporterId: "u1", assigneeIds: [], labels: [], parentId: null, epicId: null, complexity: null, sprintId: null, rank: 0, createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", doneAt: null, archivedAt: null };
    } else if (path.endsWith("/issues/counts")) body = { total: 0, byStatus: {}, byPriority: {}, overdue: 0 };
    else if (path.endsWith("/issues/epics") || path.endsWith("/issues/assignees")) body = { items: [], truncated: false, limit: 200 };
    else if (path.endsWith("/issues")) body = { items: [], hasMore: false, nextCursor: null };
    else if (path === "/notifications") body = { items: [], nextCursor: null };
    else if (path === "/notifications/unread-count") body = { count: 0 };
    else if (path === "/maintenance") body = { settings: { auditRetentionDays: 90 } };
    else if (path.startsWith("/reports/")) body = { from: "2026-09-01", to: "2026-10-01", groupBy: "project", projectCount: 1, totals: { closed: 0, created: 0, open: 0, overdue: 0, avgLeadDays: null, medianLeadDays: null }, rows: [], trend: [] };
    await route.fulfill({ json: body });
  });
  return writes;
}

