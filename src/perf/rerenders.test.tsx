/**
 * ТЗ 5.2 / ADR-0011 — ЗАМЕР перерисовок (не тест поведения).
 *
 * Часть 1 — настоящая Доска: `StoreProvider` + `Board` + `Bell` + `Toasts`, API
 * замокан так же, как в board.lookups.test.tsx; 3 колонки × 100 карточек.
 * Часть 2 — синтетический стенд 300 карточек в трёх вариантах подписки:
 *   A «как store.tsx»: один контекст, value — новый объект на каждый рендер провайдера;
 *   B «разделённые контексты»: данные / тосты / действия отдельно, value мемоизированы;
 *   C «селекторы»: прототип `src/store/experimental/selectorStore.ts` (useSyncExternalStore).
 *
 * Что считается: коммиты React, число отрендеренных компонентов (по имени) и
 * суммарное `actualDuration` из <Profiler>. Отрендеренный компонент определяется
 * через хук React DevTools (__REACT_DEVTOOLS_GLOBAL_HOOK__): волокно, которое
 * в этом коммите — новый объект (не переиспользовано без клонирования) и имеет
 * флаг PerformedWork. Время — jsdom + development-сборка React: абсолютные мс
 * не равны браузерным, сравнивать можно только варианты между собой.
 *
 * Таблицы печатаются только при TASKIRA_PERF_REPORT=1 (`npm run perf:rerenders`).
 * Утверждения — только «замер состоялся» (без порогов), чтобы файл не был
 * хрупким: улучшение или ухудшение цифр не роняет `npm test`.
 */
import { Profiler, createContext, memo, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Хук DevTools должен появиться ДО загрузки react-dom — vi.hoisted выполняется раньше импортов.
const probe = vi.hoisted(() => {
  type Fiber = { tag: number; flags: number; type: unknown; child: Fiber | null; sibling: Fiber | null };
  const COMPONENT_TAGS = new Set([0, 1, 11, 15]); // Function, Class, ForwardRef, SimpleMemo
  const PERFORMED_WORK = 1;
  const state = {
    prev: new Set<Fiber>(),
    commits: 0,
    renders: new Map<string, number>(),
  };
  const nameOf = (f: Fiber): string => {
    const t = f.type as { displayName?: string; name?: string; render?: { name?: string } } | null;
    return t?.displayName || t?.name || t?.render?.name || "Anonymous";
  };
  const hook = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => 1,
    checkDCE: () => {},
    onScheduleFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    setStrictMode: () => {},
    onCommitFiberRoot(_id: number, root: { current: Fiber }) {
      state.commits++;
      const next = new Set<Fiber>();
      const stack: Fiber[] = [root.current];
      while (stack.length) {
        const f = stack.pop()!;
        if (COMPONENT_TAGS.has(f.tag)) {
          next.add(f);
          if (!state.prev.has(f) && f.flags & PERFORMED_WORK) {
            const n = nameOf(f);
            state.renders.set(n, (state.renders.get(n) ?? 0) + 1);
          }
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
      state.prev = next;
    },
  };
  (globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  return state;
});

import { StoreProvider, useStore } from "../store";
import { authApi, departmentsApi, issuesApi, notificationsApi, projectsApi, type IssuePageParams, type ProjectBootstrap, type ServerIssue } from "../api";
import { I18nProvider } from "../i18n";
import Board from "../components/Board";
import { Bell } from "../components/Topbar";
import { Toasts } from "../ui";
import { PriorityIcon, TypeIcon } from "../icons";
import type { PriorityId } from "../types";
import { createExternalStore, createIssueListStore, useColumnIssueIds, useIssue, useStoreSelector } from "../store/experimental/selectorStore";

const REPORT = !!process.env.TASKIRA_PERF_REPORT;
const REPEAT = REPORT ? 7 : 1;

/* ── Сбор замера ──────────────────────────────────────────────────────────── */

let profilerMs = 0;
const onRender = (_id: string, _phase: string, actualDuration: number) => {
  profilerMs += actualDuration;
};

interface Sample {
  commits: number;
  renders: number;
  byName: Map<string, number>;
  ms: number;
}

async function sample(action: () => void | Promise<void>, settleAfter: () => Promise<void>): Promise<Sample> {
  await settleAfter();
  probe.commits = 0;
  probe.renders = new Map();
  profilerMs = 0;
  await act(async () => {
    await action();
  });
  await settleAfter();
  const byName = new Map(probe.renders); // снимок: следующие коммиты (уборка после сценария) сюда не попадают
  return { commits: probe.commits, renders: [...byName.values()].reduce((a, b) => a + b, 0), byName, ms: profilerMs };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

interface Row {
  scenario: string;
  commits: number;
  renders: number;
  cards: number;
  ms: number;
  top: string;
}

function row(scenario: string, samples: Sample[], cardName: string): Row {
  const s = samples[0];
  const top = [...s.byName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([n, c]) => `${n}×${c}`)
    .join(", ");
  return {
    scenario,
    commits: s.commits,
    renders: s.renders,
    cards: s.byName.get(cardName) ?? 0,
    ms: Math.round(median(samples.map((x) => x.ms)) * 10) / 10,
    top,
  };
}

function print(title: string, rows: Row[]) {
  if (!REPORT) return;
  const lines = [
    `\n### ${title}`,
    "| сценарий | коммитов | компонентов отрендерено | из них карточек | Σ actualDuration, мс (медиана) | больше всего |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.scenario} | ${r.commits} | ${r.renders} | ${r.cards} | ${r.ms} | ${r.top} |`),
  ];
  console.log(lines.join("\n"));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/* ── Часть 1: настоящая доска ─────────────────────────────────────────────── */

const USERS = Array.from({ length: 6 }, (_, i) => ({
  id: `u${i}`,
  username: `u${i}`,
  name: `Пользователь ${i}`,
  initials: `П${i}`,
  color: "var(--gray-9)",
  jobRole: "Тест",
  globalRole: "member" as const,
  isActive: true,
  authSource: "local" as const,
}));
const project = { id: "p1", key: "A21", name: "Проект", description: "", departmentId: "d1", isShared: false, sprintsEnabled: false };
const STATUSES = [
  { id: "s1", sid: "todo", name: "К работе", category: "todo" as const, position: 0 },
  { id: "s2", sid: "inprogress", name: "В работе", category: "inprogress" as const, position: 1 },
  { id: "s3", sid: "done", name: "Готово", category: "done" as const, position: 2 },
];
const PER_COLUMN = 100;
const PRIORITIES: PriorityId[] = ["low", "medium", "high", "critical"];

const boot: ProjectBootstrap = {
  project,
  users: USERS as never,
  members: USERS.map((u) => ({ userId: u.id, role: "manager" as const })),
  workflow: {
    statuses: STATUSES,
    transitions: [
      { id: "t1", from: "s1", to: "s2" },
      { id: "t2", from: "s2", to: "s3" },
      { id: "t3", from: "s2", to: "s1" },
    ],
  },
  issueTemplates: [],
  customFields: [],
  sprints: [],
} as unknown as ProjectBootstrap;

const FIXED_TS = "2026-09-20T10:00:00.000Z";
const EDITED_TS = "2026-09-21T10:00:00.000Z";
const dto = (statusId: string, n: number, over: Partial<ServerIssue> = {}): ServerIssue =>
  ({
    id: `${statusId}-${n}`,
    key: `A21-${statusId}${n}`,
    title: `Задача ${statusId}-${n}: достаточно длинный заголовок, чтобы переноситься на вторую строку`,
    description: "",
    typeId: n % 5 === 0 ? "bug" : "task",
    statusId,
    priorityId: PRIORITIES[n % 4],
    assigneeIds: [USERS[n % 6].id, ...(n % 3 === 0 ? [USERS[(n + 1) % 6].id] : [])],
    reporterId: "u0",
    epicId: null,
    parentId: null,
    labels: n % 4 === 0 ? ["frontend", "ux"] : [],
    complexity: null,
    dueDate: n % 7 === 0 ? "2026-10-01" : null,
    rank: n,
    // Фиксированные метки, как у настоящего сервера: неизменённая задача при перечитывании
    // приходит с тем же updatedAt (на этом стоит структурное разделение в useIssueSet).
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    doneAt: statusId === "s3" ? FIXED_TS : null,
    archivedAt: null,
    ...over,
  }) as unknown as ServerIssue;

class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor() {
    FakeWebSocket.last = this;
  }
  send(): void {}
  close(): void {}
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await flush(); });
const dataTransfer = () => ({ setData: () => {}, getData: () => "", effectAllowed: "", dropEffect: "" });

async function setupBoard() {
  localStorage.setItem("taskira.token", "test-token");
  vi.stubGlobal("WebSocket", FakeWebSocket);
  let gate: Promise<void> | null = null;
  let unread = 0;
  vi.spyOn(authApi, "me").mockResolvedValue({ ...USERS[0], globalRole: "admin" } as never);
  vi.spyOn(authApi, "config").mockResolvedValue({ authMode: "local" });
  vi.spyOn(projectsApi, "list").mockResolvedValue([project] as never);
  vi.spyOn(departmentsApi, "list").mockResolvedValue([]);
  vi.spyOn(issuesApi, "collaborating").mockResolvedValue([]);
  vi.spyOn(projectsApi, "get").mockResolvedValue(boot);
  vi.spyOn(issuesApi, "list").mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  vi.spyOn(notificationsApi, "list").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(notificationsApi, "unreadCount").mockImplementation(async () => ({ count: unread }));
  vi.spyOn(issuesApi, "assignees").mockResolvedValue({ items: USERS.map((u) => ({ userId: u.id, count: 10 })) } as never);
  const noCounts: Record<string, number> = {};
  const allCounts: Record<string, number> = { s1: PER_COLUMN, s2: PER_COLUMN, s3: PER_COLUMN };
  vi.spyOn(issuesApi, "counts").mockImplementation(async (_p, f) =>
    (f as { closed?: string } | undefined)?.closed === "older"
      ? { total: 0, byStatus: noCounts }
      : { total: 3 * PER_COLUMN, byStatus: allCounts },
  );
  vi.spyOn(issuesApi, "epics").mockResolvedValue({ items: [], truncated: false });
  const priority = new Map<string, PriorityId>();
  vi.spyOn(issuesApi, "page").mockImplementation(async (_p, params: IssuePageParams) => {
    if (gate) await gate;
    const st = params.status ?? "s1";
    return {
      items: Array.from({ length: PER_COLUMN }, (_, n) => {
        const d = dto(st, n);
        const p = priority.get(d.id);
        return p ? ({ ...d, priorityId: p, updatedAt: EDITED_TS } as ServerIssue) : d;
      }),
      hasMore: false,
      nextCursor: null,
    };
  });
  vi.spyOn(issuesApi, "get").mockImplementation(async (_p, id) => {
    const [st, n] = id.split("-");
    return dto(st, Number(n));
  });
  vi.spyOn(issuesApi, "patch").mockImplementation(async (_p, id, body) => {
    const [st, n] = id.split("-");
    priority.set(id, body.priorityId as PriorityId);
    return dto(st, Number(n), { priorityId: body.priorityId as PriorityId, updatedAt: EDITED_TS } as Partial<ServerIssue>);
  });

  let store!: ReturnType<typeof useStore>;
  function Grab() {
    store = useStore();
    return null;
  }
  render(
    <Profiler id="app" onRender={onRender}>
      <I18nProvider>
        <StoreProvider>
          <Grab />
          <Bell />
          <Toasts />
          <Board />
        </StoreProvider>
      </I18nProvider>
    </Profiler>,
  );
  await act(async () => {
    await store.bootstrap();
  });
  await settle();
  return {
    store: () => store,
    setUnread: (n: number) => (unread = n),
    closeGate: () => {
      let open!: () => void;
      gate = new Promise<void>((r) => (open = r));
      return () => {
        gate = null;
        open();
      };
    },
  };
}

describe("ADR-0011: перерисовки настоящей доски (300 карточек)", () => {
  test("тост, счётчик уведомлений, правка одной задачи, перетаскивание", async () => {
    const h = await setupBoard();
    const cards = screen.getAllByRole("article");
    expect(cards.length).toBe(3 * PER_COLUMN);
    const rows: Row[] = [];

    const toastS: Sample[] = [];
    for (let i = 0; i < REPEAT; i++) toastS.push(await sample(() => h.store().toast("info", `Тост ${i}`), settle));
    rows.push(row("(a) тост", toastS, "Card"));

    const unreadS: Sample[] = [];
    for (let i = 0; i < REPEAT; i++) {
      h.setUnread(i + 1);
      unreadS.push(await sample(() => FakeWebSocket.last!.onmessage!({ data: JSON.stringify({ type: "notify" }) }), settle));
    }
    rows.push(row("(b) счётчик непрочитанных +1 (WS notify)", unreadS, "Card"));

    const patchS: Sample[] = [];
    const revalS: Sample[] = [];
    for (let i = 0; i < REPEAT; i++) {
      const id = `s1-${i + 1}`;
      await act(async () => {
        await h.store().lookupIssue(id); // задача попадает в кэш стора заранее — это не часть замера
      });
      const release = h.closeGate();
      patchS.push(await sample(() => h.store().updateIssue(id, { priorityId: i % 2 ? "low" : "critical" }), settle));
      revalS.push(await sample(release, settle));
    }
    rows.push(row("(c1) правка приоритета одной задачи: ответ PATCH", patchS, "Card"));
    rows.push(row("(c2) … и перечитывание колонок по issuesRevision", revalS, "Card"));

    const dragStartS: Sample[] = [];
    const dragOverS: Sample[] = [];
    for (let i = 0; i < REPEAT; i++) {
      const card = screen.getAllByRole("article")[i];
      const columns = document.querySelectorAll("section");
      dragStartS.push(await sample(() => void fireEvent.dragStart(card, { dataTransfer: dataTransfer() }), settle));
      dragOverS.push(await sample(() => void fireEvent.dragOver(columns[1], { dataTransfer: dataTransfer() }), settle));
      await act(async () => void fireEvent.dragEnd(card, { dataTransfer: dataTransfer() }));
      await settle();
    }
    rows.push(row("(d1) начало перетаскивания", dragStartS, "Card"));
    rows.push(row("(d2) карточка над другой колонкой (dragover)", dragOverS, "Card"));

    print("Настоящая доска: StoreProvider + Board + Bell + Toasts, 3 × 100 карточек", rows);
    for (const r of rows) expect(r.commits).toBeGreaterThan(0);
  }, 60_000);
});

/* ── Часть 2: синтетический стенд A / B / C ───────────────────────────────── */

interface SIssue {
  id: string;
  key: string;
  title: string;
  statusId: string;
  typeId: string;
  priorityId: PriorityId;
}
const S_ISSUES: SIssue[] = STATUSES.flatMap((st) =>
  Array.from({ length: PER_COLUMN }, (_, n) => ({
    id: `${st.id}-${n}`,
    key: `A21-${st.id}${n}`,
    title: `Задача ${st.id}-${n}`,
    statusId: st.id,
    typeId: n % 5 === 0 ? "bug" : "task",
    priorityId: PRIORITIES[n % 4],
  })),
);

/** Тело карточки одинаково во всех вариантах — различается только подписка. Без классов
 *  Tailwind: файл попадает в сканирование исходников Tailwind, а стенду оформление не нужно. */
function CardBody({ issue, onOpen }: { issue: SIssue; onOpen: (id: string) => void }) {
  return (
    <article aria-label={issue.key} onClick={() => onOpen(issue.id)}>
      <div>
        <TypeIcon type={issue.typeId} size={14} />
        <span>{issue.key}</span>
      </div>
      <h4>{issue.title}</h4>
      <div>
        <PriorityIcon p={issue.priorityId} size={14} />
        <span>{issue.statusId}</span>
      </div>
    </article>
  );
}

interface Controls {
  toast(text: string): void;
  setUnread(n: number): void;
  patch(id: string, p: Partial<SIssue>): void;
}

// Вариант A — как store.tsx сейчас: один контекст, value — новый объект на каждый рендер.
const ACtx = createContext<{ data: { issues: SIssue[]; unreadCount: number }; toasts: string[]; openIssue: (id: string) => void } | null>(null);
function AProvider({ ctl, children }: { ctl: Partial<Controls>; children: ReactNode }) {
  const [data, setData] = useState({ issues: S_ISSUES, unreadCount: 0 });
  const [toasts, setToasts] = useState<string[]>([]);
  ctl.toast = (t) => setToasts((x) => [...x.slice(-3), t]);
  ctl.setUnread = (n) => setData((d) => ({ ...d, unreadCount: n }));
  ctl.patch = (id, p) => setData((d) => ({ ...d, issues: d.issues.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
  const openIssue = useCallback(() => {}, []);
  return <ACtx.Provider value={{ data, toasts, openIssue }}>{children}</ACtx.Provider>;
}
const useA = () => useContext(ACtx)!;
const ACard = memo(function ACard({ issue }: { issue: SIssue }) {
  const { openIssue } = useA();
  return <CardBody issue={issue} onOpen={openIssue} />;
});
function AColumn({ statusId }: { statusId: string }) {
  const { data } = useA();
  const items = useMemo(() => data.issues.filter((i) => i.statusId === statusId), [data.issues, statusId]);
  return <section>{items.map((i) => <ACard key={i.id} issue={i} />)}</section>;
}
function ABoard() {
  useA();
  return <div>{STATUSES.map((s) => <AColumn key={s.id} statusId={s.id} />)}</div>;
}
function ABell() {
  return <span>{useA().data.unreadCount}</span>;
}
function AToasts() {
  return <div>{useA().toasts.map((t) => <p key={t}>{t}</p>)}</div>;
}

// Вариант B — те же useState, но три контекста с мемоизированными value.
const BData = createContext<{ issues: SIssue[]; unreadCount: number } | null>(null);
const BToasts = createContext<string[]>([]);
const BActions = createContext<{ openIssue: (id: string) => void } | null>(null);
function BProvider({ ctl, children }: { ctl: Partial<Controls>; children: ReactNode }) {
  const [data, setData] = useState({ issues: S_ISSUES, unreadCount: 0 });
  const [toasts, setToasts] = useState<string[]>([]);
  ctl.toast = (t) => setToasts((x) => [...x.slice(-3), t]);
  ctl.setUnread = (n) => setData((d) => ({ ...d, unreadCount: n }));
  ctl.patch = (id, p) => setData((d) => ({ ...d, issues: d.issues.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
  const openIssue = useCallback(() => {}, []);
  const actions = useMemo(() => ({ openIssue }), [openIssue]);
  return (
    <BActions.Provider value={actions}>
      <BToasts.Provider value={toasts}>
        <BData.Provider value={data}>{children}</BData.Provider>
      </BToasts.Provider>
    </BActions.Provider>
  );
}
const BCard = memo(function BCard({ issue }: { issue: SIssue }) {
  const { openIssue } = useContext(BActions)!;
  return <CardBody issue={issue} onOpen={openIssue} />;
});
const BColumn = memo(function BColumn({ items }: { items: SIssue[] }) {
  return <section>{items.map((i) => <BCard key={i.id} issue={i} />)}</section>;
});
function BBoard() {
  const { issues } = useContext(BData)!;
  const cols = useMemo(() => STATUSES.map((s) => issues.filter((i) => i.statusId === s.id)), [issues]);
  return <div>{cols.map((items, k) => <BColumn key={STATUSES[k].id} items={items} />)}</div>;
}
function BBell() {
  return <span>{useContext(BData)!.unreadCount}</span>;
}
function BToastList() {
  return <div>{useContext(BToasts).map((t) => <p key={t}>{t}</p>)}</div>;
}

// Вариант C — прототип селекторов: задачи, счётчик и тосты — внешние сторы.
function makeC() {
  const issues = createIssueListStore(S_ISSUES);
  const notif = createExternalStore({ unreadCount: 0 });
  const toasts = createExternalStore<string[]>([]);
  const openIssue = () => {};
  const ctl: Controls = {
    toast: (t) => toasts.setState((x) => [...x.slice(-3), t]),
    setUnread: (n) => notif.setState((s) => ({ ...s, unreadCount: n })),
    patch: (id, p) => issues.patchIssue(id, p),
  };
  const CCard = memo(function CCard({ id }: { id: string }) {
    const issue = useIssue(issues.store, id);
    return issue ? <CardBody issue={issue} onOpen={openIssue} /> : null;
  });
  const CColumn = memo(function CColumn({ statusId }: { statusId: string }) {
    const ids = useColumnIssueIds(issues.store, statusId);
    return <section>{ids.map((id) => <CCard key={id} id={id} />)}</section>;
  });
  function CBoard() {
    return <div>{STATUSES.map((s) => <CColumn key={s.id} statusId={s.id} />)}</div>;
  }
  function CBell() {
    return <span>{useStoreSelector(notif, (s) => s.unreadCount)}</span>;
  }
  function CToasts() {
    return <div>{useStoreSelector(toasts, (s) => s).map((t) => <p key={t}>{t}</p>)}</div>;
  }
  const tree = (
    <>
      <CBell />
      <CToasts />
      <CBoard />
    </>
  );
  return { ctl, tree };
}

async function measureVariant(name: string, tree: ReactNode, ctl: Partial<Controls>, card: string): Promise<Row[]> {
  render(
    <Profiler id={name} onRender={onRender}>
      <I18nProvider>{tree}</I18nProvider>
    </Profiler>,
  );
  await settle();
  expect(screen.getAllByRole("article").length).toBe(S_ISSUES.length);
  const run = async (label: string, fn: (i: number) => void) => {
    const xs: Sample[] = [];
    for (let i = 0; i < REPEAT; i++) xs.push(await sample(() => fn(i), settle));
    return row(`${name}: ${label}`, xs, card);
  };
  const rows = [
    await run("(a) тост", (i) => ctl.toast!(`Тост ${i}`)),
    await run("(b) счётчик непрочитанных", (i) => ctl.setUnread!(i + 1)),
    await run("(c) правка одной задачи", (i) => ctl.patch!(`s1-${i}`, { priorityId: i % 2 ? "low" : "critical" })),
    await run("(c') перенос задачи в другую колонку", (i) => ctl.patch!(`s1-${10 + i}`, { statusId: "s2" })),
  ];
  cleanup();
  return rows;
}

describe("ADR-0011: синтетический стенд, 300 карточек — A (один контекст) / B (разделённые контексты) / C (селекторы)", () => {
  test("замер трёх вариантов подписки", async () => {
    const aCtl: Partial<Controls> = {};
    const bCtl: Partial<Controls> = {};
    const c = makeC();
    const rows = [
      ...(await measureVariant(
        "A",
        <AProvider ctl={aCtl}>
          <ABell />
          <AToasts />
          <ABoard />
        </AProvider>,
        aCtl,
        "ACard",
      )),
      ...(await measureVariant(
        "B",
        <BProvider ctl={bCtl}>
          <BBell />
          <BToastList />
          <BBoard />
        </BProvider>,
        bCtl,
        "BCard",
      )),
      ...(await measureVariant("C", c.tree, c.ctl, "CCard")),
    ];
    print("Синтетический стенд: 3 × 100 карточек, три способа подписки", rows);
    for (const r of rows) expect(r.commits).toBeGreaterThan(0);
  }, 60_000);
});
