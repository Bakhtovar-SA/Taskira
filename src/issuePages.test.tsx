import { afterEach, describe, expect, test, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { issuesApi, type IssuePageParams, type ServerIssue } from "./api";
import { appendUnique, issueSetKey, useIssueSet, type IssueSet, type IssueSetQuery } from "./issuePages";
import type { Issue } from "./types";

/**
 * PERF-05: постраничный набор задач. Проверяем то, на чём стоит ленивая
 * загрузка: курсор идёт из ответа в следующий запрос, страницы не дублируются и
 * не теряются, смена фильтра сбрасывает набор (и отбрасывает опоздавший ответ),
 * а счётчик запрашивается один раз на набор, а не на каждую страницу.
 */

const dto = (n: number, over: Partial<ServerIssue> = {}): ServerIssue =>
  ({
    id: `i${n}`,
    key: `A-${n}`,
    title: `Задача ${n}`,
    description: "",
    typeId: "task",
    statusId: "s1",
    priorityId: "medium",
    assigneeIds: [],
    reporterId: "u1",
    epicId: null,
    parentId: null,
    labels: [],
    complexity: null,
    dueDate: null,
    rank: n,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    doneAt: null,
    archivedAt: null,
    ...over,
  }) as unknown as ServerIssue;

/** Мини-«сервер»: фильтр по исполнителю, страницы по `limit`, курсор = индекс продолжения. */
function fakeServer(all: ServerIssue[]) {
  const matching = (p: IssuePageParams) =>
    all.filter((i) => (p.assignee === "none" ? i.assigneeIds.length === 0 : p.assignee ? i.assigneeIds.includes(p.assignee) : true));
  const page = vi.spyOn(issuesApi, "page").mockImplementation(async (_pid, p) => {
    const rows = matching(p);
    const from = p.cursor ? Number(p.cursor.replace("c", "")) : 0;
    const limit = p.limit ?? 100;
    const items = rows.slice(from, from + limit);
    const hasMore = from + limit < rows.length;
    return { items, hasMore, nextCursor: hasMore ? `c${from + limit}` : null };
  });
  const counts = vi.spyOn(issuesApi, "counts").mockImplementation(async (_pid, p) => ({
    total: matching(p).length,
    byStatus: {},
  }));
  return { page, counts };
}

const baseQuery = (over: Partial<IssueSetQuery["filters"]> = {}): IssueSetQuery => ({
  projectId: "p1",
  filters: over,
  sort: "rank",
  dir: "asc",
});

function Probe({ query, onSet }: { query: IssueSetQuery | null; onSet: (s: IssueSet) => void }) {
  onSet(useIssueSet(query));
  return null;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = () => act(async () => { await flush(); await flush(); });

function mount(initial: IssueSetQuery | null) {
  let latest!: IssueSet;
  const utils = render(<Probe query={initial} onSet={(s) => (latest = s)} />);
  return {
    get set() {
      return latest;
    },
    rerender: (q: IssueSetQuery | null) => utils.rerender(<Probe query={q} onSet={(s) => (latest = s)} />),
    unmount: utils.unmount,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("issueSetKey", () => {
  test("не зависит от порядка полей и игнорирует пустые значения", () => {
    const a = issueSetKey({ ...baseQuery({ assignee: "u1", type: "bug" }) });
    const b = issueSetKey({ ...baseQuery({ type: "bug", assignee: "u1", q: undefined, status: "" }) });
    expect(a).toBe(b);
  });
  test("меняется от проекта, фильтра и сортировки", () => {
    const k = issueSetKey(baseQuery());
    expect(issueSetKey({ ...baseQuery(), projectId: "p2" })).not.toBe(k);
    expect(issueSetKey(baseQuery({ assignee: "u1" }))).not.toBe(k);
    expect(issueSetKey({ ...baseQuery(), sort: "priority" })).not.toBe(k);
    expect(issueSetKey({ ...baseQuery(), dir: "desc" })).not.toBe(k);
  });
});

describe("appendUnique", () => {
  test("добавляет в конец и пропускает уже загруженные", () => {
    const mk = (id: string) => ({ id }) as unknown as Issue;
    expect(appendUnique([mk("a"), mk("b")], [mk("b"), mk("c")]).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("useIssueSet", () => {
  test("первая страница и счётчик — по одному запросу; total берётся у сервера, не из числа загруженных", async () => {
    const { page, counts } = fakeServer(Array.from({ length: 250 }, (_, n) => dto(n)));
    const h = mount(baseQuery());
    expect(h.set.loading).toBe(true);
    await settle();
    expect(page).toHaveBeenCalledTimes(1);
    expect(counts).toHaveBeenCalledTimes(1);
    expect(h.set.items).toHaveLength(100);
    expect(h.set.total).toBe(250);
    expect(h.set.hasMore).toBe(true);
    expect(h.set.loading).toBe(false);
    h.unmount();
  });

  test("подгрузка десяти страниц подряд: без дублей и потерь, счётчик не перезапрашивается", async () => {
    const all = Array.from({ length: 1000 }, (_, n) => dto(n));
    const { page, counts } = fakeServer(all);
    const h = mount(baseQuery());
    await settle();
    for (let i = 0; i < 9; i++) {
      await act(async () => {
        h.set.loadMore();
        await flush();
      });
    }
    expect(page).toHaveBeenCalledTimes(10);
    expect(counts).toHaveBeenCalledTimes(1);
    const ids = h.set.items.map((i) => i.id);
    expect(ids).toEqual(all.map((d) => d.id));
    expect(new Set(ids).size).toBe(1000);
    expect(h.set.hasMore).toBe(false);
    // курсор каждой следующей страницы — из ответа предыдущей, а не смещение
    expect(page.mock.calls.slice(1).map((c) => c[1].cursor)).toEqual(["c100", "c200", "c300", "c400", "c500", "c600", "c700", "c800", "c900"]);
    h.unmount();
  });

  test("повторный loadMore, пока идёт подгрузка, не шлёт второй запрос", async () => {
    const { page } = fakeServer(Array.from({ length: 300 }, (_, n) => dto(n)));
    const h = mount(baseQuery());
    await settle();
    await act(async () => {
      h.set.loadMore();
      h.set.loadMore();
      h.set.loadMore();
      await flush();
    });
    expect(page).toHaveBeenCalledTimes(2);
    expect(h.set.items).toHaveLength(200);
    h.unmount();
  });

  test("страница, пересекающаяся с уже загруженной, не создаёт дублей", async () => {
    const all = Array.from({ length: 6 }, (_, n) => dto(n));
    vi.spyOn(issuesApi, "counts").mockResolvedValue({ total: 6, byStatus: {} });
    const page = vi.spyOn(issuesApi, "page");
    page.mockResolvedValueOnce({ items: all.slice(0, 3), hasMore: true, nextCursor: "x" });
    page.mockResolvedValueOnce({ items: all.slice(2, 6), hasMore: false, nextCursor: null }); // i2 повторно
    const h = mount(baseQuery());
    await settle();
    await act(async () => {
      h.set.loadMore();
      await flush();
    });
    expect(h.set.items.map((i) => i.id)).toEqual(["i0", "i1", "i2", "i3", "i4", "i5"]);
  });

  test("смена фильтра сбрасывает набор: старые элементы исчезают, находится задача из-за пределов первой страницы", async () => {
    // цель — 300-я задача; в первую страницу без фильтра она не попадает
    const all = Array.from({ length: 300 }, (_, n) => dto(n, n === 299 ? { assigneeIds: ["u7"] } : {}));
    fakeServer(all);
    const h = mount(baseQuery());
    await settle();
    expect(h.set.items.map((i) => i.id)).not.toContain("i299");
    h.rerender(baseQuery({ assignee: "u7" }));
    await settle();
    expect(h.set.items.map((i) => i.id)).toEqual(["i299"]);
    expect(h.set.total).toBe(1);
    expect(h.set.hasMore).toBe(false);
    h.unmount();
  });

  test("опоздавший ответ прежнего фильтра не смешивается с новым набором", async () => {
    let resolveOld!: (v: { items: ServerIssue[]; hasMore: boolean; nextCursor: string | null }) => void;
    const page = vi.spyOn(issuesApi, "page");
    page.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
    page.mockResolvedValueOnce({ items: [dto(50)], hasMore: false, nextCursor: null });
    vi.spyOn(issuesApi, "counts").mockResolvedValue({ total: 1, byStatus: {} });

    const h = mount(baseQuery());
    h.rerender(baseQuery({ assignee: "u1" })); // меняем фильтр, пока первый запрос ещё в пути
    await settle();
    expect(h.set.items.map((i) => i.id)).toEqual(["i50"]);
    await act(async () => {
      resolveOld({ items: [dto(1), dto(2)], hasMore: true, nextCursor: "old" });
      await flush();
    });
    expect(h.set.items.map((i) => i.id)).toEqual(["i50"]);
    expect(h.set.hasMore).toBe(false);
    h.unmount();
  });

  test("курсор не попадает ни в ключ набора, ни в параметры первой страницы", async () => {
    const { page, counts } = fakeServer(Array.from({ length: 300 }, (_, n) => dto(n)));
    const h = mount(baseQuery({ assignee: "none" }));
    await settle();
    expect(page.mock.calls[0][1].cursor).toBeUndefined();
    expect(page.mock.calls[0][1]).toMatchObject({ assignee: "none", sort: "rank", dir: "asc" });
    expect(counts.mock.calls[0][1]).toEqual({ assignee: "none" }); // без sort/limit/cursor
    expect(issueSetKey(baseQuery({ assignee: "none" }))).not.toContain("c100");
    h.unmount();
  });

  test("ошибка первой загрузки: error без элементов; reload повторяет", async () => {
    const page = vi.spyOn(issuesApi, "page");
    page.mockRejectedValueOnce(new Error("сеть недоступна"));
    page.mockResolvedValueOnce({ items: [dto(1)], hasMore: false, nextCursor: null });
    vi.spyOn(issuesApi, "counts").mockResolvedValue({ total: 1, byStatus: {} });
    const h = mount(baseQuery());
    await settle();
    expect(h.set.error).toBe("сеть недоступна");
    expect(h.set.items).toHaveLength(0);
    await act(async () => {
      h.set.reload();
      await flush();
      await flush();
    });
    expect(h.set.error).toBeNull();
    expect(h.set.items).toHaveLength(1);
    h.unmount();
  });

  test("ошибка подгрузки сохраняет уже показанное и позволяет повторить с того же курсора", async () => {
    const all = Array.from({ length: 200 }, (_, n) => dto(n));
    const { page } = fakeServer(all);
    const h = mount(baseQuery());
    await settle();
    page.mockRejectedValueOnce(new Error("503"));
    await act(async () => {
      h.set.loadMore();
      await flush();
    });
    expect(h.set.error).toBe("503");
    expect(h.set.items).toHaveLength(100);
    expect(h.set.hasMore).toBe(true);
    await act(async () => {
      h.set.loadMore();
      await flush();
    });
    expect(h.set.error).toBeNull();
    expect(h.set.items).toHaveLength(200);
    expect(page.mock.calls[page.mock.calls.length - 1][1].cursor).toBe("c100");
    h.unmount();
  });

  test("revalidate перечитывает загруженный диапазон и обновляет счётчик, не сбрасывая набор", async () => {
    let all = Array.from({ length: 250 }, (_, n) => dto(n));
    fakeServer(all);
    // перехватываем «сервер», чтобы сменить данные под уже загруженный набор
    const h = mount(baseQuery());
    await settle();
    await act(async () => {
      h.set.loadMore();
      await flush();
    });
    expect(h.set.items).toHaveLength(200);
    all = all.filter((d) => d.id !== "i5"); // задачу удалили
    vi.restoreAllMocks();
    fakeServer(all);
    await act(async () => {
      h.set.revalidate();
      await flush();
      await flush();
      await flush();
    });
    expect(h.set.items.map((i) => i.id)).not.toContain("i5");
    expect(h.set.items).toHaveLength(200); // прежняя глубина сохранена
    expect(h.set.total).toBe(249);
    h.unmount();
  });

  test("query = null: запросов нет", async () => {
    const { page, counts } = fakeServer([]);
    const h = mount(null);
    await settle();
    expect(page).not.toHaveBeenCalled();
    expect(counts).not.toHaveBeenCalled();
    expect(h.set.loading).toBe(false);
    h.unmount();
  });
});
