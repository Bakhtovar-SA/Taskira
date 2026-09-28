import { afterEach, describe, expect, test, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { issuesApi, type IssueEpic, type IssueFilterParams, type IssuePageParams, type ServerIssue } from "./api";
import {
  appendUnique,
  freshRows,
  issueSetKey,
  shareUnchanged,
  useEpics,
  useIssueCounts,
  useIssueSet,
  type IssueCountsState,
  type IssueSet,
  type IssueSetQuery,
} from "./issuePages";
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

describe("shareUnchanged (ADR-0011, шаг 0)", () => {
  const mk = (id: string, over: Partial<Issue> = {}) =>
    ({ id, title: id, updatedAt: 1, labels: ["a"], assigneeIds: ["u1"], ...over }) as unknown as Issue;

  test("ничего не изменилось — прежний массив и прежние объекты", () => {
    const prev = [mk("a"), mk("b")];
    expect(shareUnchanged(prev, [mk("a"), mk("b")])).toBe(prev);
  });

  test("изменилась одна задача — новая только она, остальные прежними объектами", () => {
    const prev = [mk("a"), mk("b"), mk("c")];
    const next = shareUnchanged(prev, [mk("a"), mk("b", { title: "B!", updatedAt: 2 }), mk("c")]);
    expect(next).not.toBe(prev);
    expect(next[0]).toBe(prev[0]);
    expect(next[1]).not.toBe(prev[1]);
    expect(next[1].title).toBe("B!");
    expect(next[2]).toBe(prev[2]);
  });

  test("тот же updatedAt, но другое содержимое (ранг, исполнители) — задача заменяется", () => {
    const prev = [mk("a", { rank: 1 }), mk("b")];
    const next = shareUnchanged(prev, [mk("a", { rank: 2 }), mk("b", { assigneeIds: ["u2"] })]);
    expect(next[0]).not.toBe(prev[0]);
    expect(next[0].rank).toBe(2);
    expect(next[1]).not.toBe(prev[1]);
    expect(next[1].assigneeIds).toEqual(["u2"]);
  });

  test("порядок и состав берутся из нового ответа; удалённая пропадает, новая появляется", () => {
    const prev = [mk("a"), mk("b"), mk("c")];
    const next = shareUnchanged(prev, [mk("c"), mk("d"), mk("a")]);
    expect(next.map((i) => i.id)).toEqual(["c", "d", "a"]);
    expect(next[0]).toBe(prev[2]);
    expect(next[2]).toBe(prev[0]);
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

  test("revalidate без изменений на сервере сохраняет прежние объекты задач и прежний массив", async () => {
    const stamp = "2026-09-01T10:00:00.000Z";
    let all = Array.from({ length: 5 }, (_, n) => dto(n, { createdAt: stamp, updatedAt: stamp } as Partial<ServerIssue>));
    fakeServer(all);
    const h = mount(baseQuery());
    await settle();
    const before = h.set.items;
    expect(before).toHaveLength(5);
    await act(async () => {
      h.set.revalidate();
      await flush();
      await flush();
    });
    expect(h.set.items).toBe(before);

    // правка одной задачи — новый объект только у неё
    all = all.map((d) => (d.id === "i2" ? ({ ...d, title: "Правка", updatedAt: "2026-09-02T10:00:00.000Z" } as ServerIssue) : d));
    vi.restoreAllMocks();
    fakeServer(all);
    await act(async () => {
      h.set.revalidate();
      await flush();
      await flush();
    });
    const after = h.set.items;
    expect(after).not.toBe(before);
    expect(after[2].title).toBe("Правка");
    expect(after[2]).not.toBe(before[2]);
    for (const k of [0, 1, 3, 4]) expect(after[k]).toBe(before[k]);
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

describe("useIssueCounts", () => {
  function CountsProbe({
    pid,
    filters,
    revision,
    onState,
  }: {
    pid: string | null;
    filters: IssueFilterParams | null;
    revision: string;
    onState: (s: IssueCountsState) => void;
  }) {
    onState(useIssueCounts(pid, filters, revision));
    return null;
  }
  function mountCounts(pid: string | null, filters: IssueFilterParams | null, revision = "r1") {
    let latest!: IssueCountsState;
    const ui = render(<CountsProbe pid={pid} filters={filters} revision={revision} onState={(s) => (latest = s)} />);
    return {
      get state() {
        return latest;
      },
      rerender: (p: string | null, f: IssueFilterParams | null, r = revision) =>
        ui.rerender(<CountsProbe pid={p} filters={f} revision={r} onState={(s) => (latest = s)} />),
      unmount: ui.unmount,
    };
  }

  test("один запрос на набор; перерисовка с тем же содержимым фильтра его не повторяет", async () => {
    const counts = vi.spyOn(issuesApi, "counts").mockResolvedValue({ total: 7, byStatus: { s1: 7 } });
    const h = mountCounts("p1", { assignee: "u1" });
    expect(h.state.loading).toBe(true);
    await settle();
    expect(h.state.counts).toEqual({ total: 7, byStatus: { s1: 7 } });
    h.rerender("p1", { assignee: "u1" }); // новый объект, то же содержимое
    await settle();
    expect(counts).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  test("смена фильтра: старое значение не показывается, приходит новое; опоздавший ответ отбрасывается", async () => {
    let resolveOld!: (v: { total: number; byStatus: Record<string, number> }) => void;
    const counts = vi.spyOn(issuesApi, "counts");
    counts.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
    counts.mockResolvedValueOnce({ total: 2, byStatus: {} });
    const h = mountCounts("p1", { assignee: "u1" });
    h.rerender("p1", { assignee: "u2" });
    await settle();
    expect(h.state.counts?.total).toBe(2);
    await act(async () => {
      resolveOld({ total: 999, byStatus: {} });
      await flush();
    });
    expect(h.state.counts?.total).toBe(2);
    h.unmount();
  });

  test("смена ревизии перечитывает счётчик, не сбрасывая показанное", async () => {
    const counts = vi.spyOn(issuesApi, "counts");
    counts.mockResolvedValueOnce({ total: 5, byStatus: {} });
    counts.mockResolvedValueOnce({ total: 4, byStatus: {} });
    const h = mountCounts("p1", {}, "r1");
    await settle();
    expect(h.state.counts?.total).toBe(5);
    h.rerender("p1", {}, "r2");
    expect(h.state.counts?.total).toBe(5); // пока идёт перечитывание — прежнее значение
    await settle();
    expect(h.state.counts?.total).toBe(4);
    expect(counts).toHaveBeenCalledTimes(2);
    h.unmount();
  });

  test("filters = null: запросов нет, значения нет", async () => {
    const counts = vi.spyOn(issuesApi, "counts").mockResolvedValue({ total: 1, byStatus: {} });
    const h = mountCounts("p1", null);
    await settle();
    expect(counts).not.toHaveBeenCalled();
    expect(h.state.counts).toBeNull();
    expect(h.state.loading).toBe(false);
    h.unmount();
  });

  test("ошибка: counts = null, error задан", async () => {
    vi.spyOn(issuesApi, "counts").mockRejectedValue(new Error("сеть"));
    const h = mountCounts("p1", {});
    await settle();
    expect(h.state.counts).toBeNull();
    expect(h.state.error).toBe("сеть");
    h.unmount();
  });
});

describe("useIssueSet без счётчика (колонка доски)", () => {
  test("страница грузится, counts не запрашивается, total = null", async () => {
    const { page, counts } = fakeServer(Array.from({ length: 150 }, (_, n) => dto(n)));
    let latest!: IssueSet;
    function P() {
      latest = useIssueSet(baseQuery({ status: "s1" }), { withCounts: false });
      return null;
    }
    const ui = render(<P />);
    await settle();
    expect(page).toHaveBeenCalledTimes(1);
    expect(counts).not.toHaveBeenCalled();
    expect(latest.items).toHaveLength(100);
    expect(latest.total).toBeNull();
    expect(latest.hasMore).toBe(true);
    ui.unmount();
  });
});

describe("freshRows", () => {
  test("правки берутся из стора, порядок сервера сохраняется, неизвестные стору задачи не отбрасываются", () => {
    const mk = (id: string, title = id) => ({ id, title }) as unknown as Issue;
    const byId = new Map([["a", mk("a", "правка")]]);
    expect(freshRows([mk("a"), mk("b"), mk("c")], byId).map((i) => i.title)).toEqual(["правка", "b", "c"]);
    expect(freshRows([mk("x")], new Map()).map((i) => i.id)).toEqual(["x"]);
  });
});

describe("useEpics", () => {
  const epic = (id: string, title = id): IssueEpic => ({ id, key: `A-${id}`, title, color: "#123456", tStart: null, tSpan: null, childTotal: 2, childDone: 1 });
  function EpicsProbe({ pid, revision, on }: { pid: string | null; revision: number; on: (s: ReturnType<typeof useEpics>) => void }) {
    on(useEpics(pid, revision));
    return null;
  }
  function mountEpics(pid: string | null, revision = 0) {
    let latest!: ReturnType<typeof useEpics>;
    const ui = render(<EpicsProbe pid={pid} revision={revision} on={(s) => (latest = s)} />);
    return {
      get s() {
        return latest;
      },
      rerender: (p: string | null, r = revision) => ui.rerender(<EpicsProbe pid={p} revision={r} on={(s) => (latest = s)} />),
      unmount: ui.unmount,
    };
  }

  test("один запрос на открытие; справочник по id и списком", async () => {
    const spy = vi.spyOn(issuesApi, "epics").mockResolvedValue({ items: [epic("e1", "Альфа"), epic("e2")], truncated: false });
    const h = mountEpics("p1");
    expect(h.s.loading).toBe(true);
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(h.s.byId.get("e1")?.title).toBe("Альфа");
    expect(h.s.list.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(h.s.loading).toBe(false);
    await settle();
    expect(spy).toHaveBeenCalledTimes(1); // перерисовки не перезапрашивают
    h.unmount();
  });

  test("смена ревизии перечитывает справочник, не сбрасывая показанное", async () => {
    const spy = vi.spyOn(issuesApi, "epics");
    spy.mockResolvedValueOnce({ items: [epic("e1", "До")], truncated: false });
    spy.mockResolvedValueOnce({ items: [epic("e1", "После")], truncated: false });
    const h = mountEpics("p1", 0);
    await settle();
    h.rerender("p1", 1);
    expect(h.s.byId.get("e1")?.title).toBe("До"); // пока идёт перечитывание — прежнее
    await settle();
    expect(h.s.byId.get("e1")?.title).toBe("После");
    expect(spy).toHaveBeenCalledTimes(2);
    h.unmount();
  });

  test("смена проекта: справочник прежнего проекта не показывается", async () => {
    const spy = vi.spyOn(issuesApi, "epics");
    spy.mockResolvedValueOnce({ items: [epic("e1")], truncated: false });
    let release!: (v: { items: IssueEpic[]; truncated: boolean }) => void;
    spy.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const h = mountEpics("p1");
    await settle();
    h.rerender("p2");
    expect(h.s.list).toEqual([]);
    await act(async () => {
      release({ items: [epic("x9")], truncated: false });
      await flush();
    });
    expect(h.s.list.map((e) => e.id)).toEqual(["x9"]);
    h.unmount();
  });

  test("ошибка: error задан, ранее показанное сохраняется; projectId = null — запросов нет", async () => {
    const spy = vi.spyOn(issuesApi, "epics");
    spy.mockResolvedValueOnce({ items: [epic("e1")], truncated: true });
    spy.mockRejectedValueOnce(new Error("сеть"));
    const h = mountEpics("p1", 0);
    await settle();
    expect(h.s.truncated).toBe(true);
    h.rerender("p1", 1);
    await settle();
    expect(h.s.error).toBe("сеть");
    expect(h.s.byId.has("e1")).toBe(true);
    h.unmount();
    spy.mockClear();
    const none = mountEpics(null);
    await settle();
    expect(spy).not.toHaveBeenCalled();
    none.unmount();
  });
});
