import type { Page } from "@playwright/test";
import { mockApi } from "./fixtures";
const issue = (n: number, dueDate: string | null) => ({ id: `i${n}`, key: `TEST-${n}`, title: `Calendar issue ${n}`, typeId: "task", priorityId: n % 2 ? "critical" : "low", statusId: "s1", assigneeIds: [], reporterId: "u1", dueDate,
  epicId: null, parentId: null, sprintId: null, labels: [], complexity: null, rank: n, description: "", createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-01T12:00:00Z", archivedAt: null, doneAt: null });
export async function calendarApi(page: Page, count = 8) {
  await mockApi(page);
  let items = Array.from({ length: count }, (_, i) => issue(i + 1, i < 5 ? "2026-10-01" : "2026-10-02"));
  items.push(issue(count + 1, null));
  const queries: URLSearchParams[] = []; const writes: unknown[] = []; let reject = false;
  await page.route("**/api/projects/p1/issues**", async route => {
    const url = new URL(route.request().url());
    const tail = url.pathname.split("/issues")[1];
    if (tail === "" && route.request().method() === "GET") {
      queries.push(url.searchParams);
      let selected = items.filter(i => url.searchParams.has("dueEmpty") ? !i.dueDate : !url.searchParams.has("dueFrom") || !!i.dueDate && i.dueDate >= url.searchParams.get("dueFrom")! && i.dueDate <= url.searchParams.get("dueTo")!);
      const cursor = Number(url.searchParams.get("cursor") ?? 0); const limit = Number(url.searchParams.get("limit") ?? 100);
      const chunk = selected.slice(cursor, cursor + limit);
      return route.fulfill({ json: { items: chunk, hasMore: selected.length > cursor + limit, nextCursor: selected.length > cursor + limit ? String(cursor + limit) : null } });
    }
    if (/^\/i\d+$/.test(tail)) {
      const current = items.find(i => i.id === tail.slice(1))!;
      if (route.request().method() === "PATCH") {
        const patch = route.request().postDataJSON(); writes.push(patch);
        if (reject) return route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN", reason: "Only own issues" } } });
        items = items.map(i => i.id === current.id ? { ...i, ...patch } : i);
      }
      return route.fulfill({ json: items.find(i => i.id === current.id) });
    }
    return route.fallback();
  });
  return { queries, writes, reject: () => { reject = true; } };
}
