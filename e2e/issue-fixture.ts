import type { Page } from "@playwright/test";
import { boardFixture } from "./board-fixture";

export async function issueFixture(page: Page, theme = "light", role = "admin", lang = "ru", sprints = true) {
  const { issues, users, statuses, project } = await boardFixture(page, theme, 4, lang);
  users[0].globalRole = "member";
  const comments = [{ id: "comment1", issueId: "i1", authorId: "u2", author: users[1], body: "Проверил требования. Можно брать в работу.", createdAt: "2026-10-03T11:00:00Z" }];
  const activity = [{ id: "activity1", actorId: "u1", actor: users[0], event: null, text: "создал(а) задачу", createdAt: "2026-10-01T12:00:00Z" }];
  const detail = { ...issues[0], title: "Единая авторизация для корпоративных сервисов", description: "Настроить единый вход для сотрудников и проверить права доступа.\n\nСогласовать сценарии с @igor перед запуском.", complexity: "medium", labels: ["платформа", "запуск"], sprintId: sprints ? "sp1" : null,
    attachments: [], links: [], checklist: [{ id: "check1", text: "Проверить уведомления", done: false }], customFieldValues: [], collaboratorIds: [], comments: [], activity: [], watch: { watching: true, watchers: 2 }, subtasksSummary: { total: 1, done: 0 },
  };
  const child = { ...issues[1], id: "child1", key: "CORP-11", title: "Проверить вход", parentId: "i1", attachments: [], links: [], checklist: [], customFieldValues: [] };
  const writes: { path: string; method: string; body: Record<string, unknown> | null }[] = [];
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    if (path === "/api/auth/me") return route.fulfill({ json: { ...users[0], favoriteProjectIds: ["p1"], onboarding: { hidden: true } } });
    if (path === "/api/projects/p1") return route.fulfill({ json: {
      project: { ...project, sprintsEnabled: sprints }, users, members: users.map(user => ({ userId: user.id, role })),
      workflow: { statuses, transitions: [{ from: "s1", to: "s2" }, { from: "s2", to: "s4" }] }, issueTemplates: [], customFields: [],
      sprints: sprints ? [{ id: "sp1", projectId: "p1", name: "Октябрьский запуск", goal: "", status: "active", startDate: "2026-10-01", endDate: "2026-10-14" }] : [],
    } });
    if (path === "/api/projects/p1/issues" && url.searchParams.get("parentId")) return route.fulfill({ json: { items: url.searchParams.get("parentId") === "i1" ? [child] : [], hasMore: false, nextCursor: null } });
    if (path === "/api/projects/p1/issues/i1" && method === "GET") return route.fulfill({ json: detail });
    if (path === "/api/projects/p1/issues/epic1") return route.fulfill({ json: { ...detail, id: "epic1", key: "CORP-E1", title: "Корпоративная платформа", epicId: null, color: null } });
    if (path === "/api/projects/p1/issues/i1/comments" && method === "GET") return route.fulfill({ json: comments });
    if (path === "/api/projects/p1/issues/i1/activity") return route.fulfill({ json: activity });
    if (path === "/api/projects/p1/issues/i1/collaborators") return route.fulfill({ json: [] });
    if (path.startsWith("/api/projects/p1/issues/i1/") && method !== "GET" || path === "/api/projects/p1/issues/i1" && method === "PATCH") {
      const body = method === "DELETE" || path.endsWith("/watchers/me") || path.endsWith("/attachments") ? null : route.request().postDataJSON();
      writes.push({ path, method, body });
      if (path.endsWith("/transition")) { detail.statusId = body.to; return route.fulfill({ json: detail }); }
      if (method === "PATCH") { Object.assign(detail, body); return route.fulfill({ json: detail }); }
      if (path.endsWith("/comments")) {
        const comment = { ...comments[0], id: "comment2", authorId: "u1", author: users[0], body: body.body, createdAt: "2026-10-04T07:00:00Z" };
        comments.push(comment); return route.fulfill({ json: comment });
      }
      if (path.endsWith("/watchers/me")) { detail.watch = { watching: method === "POST", watchers: method === "POST" ? 2 : 1 }; return route.fulfill({ json: detail.watch }); }
      if (path.endsWith("/attachments")) return route.fulfill({ json: { id: "attachment1", filename: "notes.txt", byteSize: 5, mimeType: "text/plain", uploadedById: "u1", createdAt: "2026-10-04T07:00:00Z" } });
      return route.fulfill({ json: { ok: true } });
    }
    return route.fallback();
  });
  return writes;
}
