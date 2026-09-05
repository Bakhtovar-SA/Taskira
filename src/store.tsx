import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Data, Issue, IssueTypeId, PriorityId, Toast, Transition, User, ViewId, Workflow } from "./types";
import { ISSUE_TYPES, PRIORITIES } from "./types";
import { DEFAULT_WORKFLOW, freshData } from "./seed";
import { can as canDo, denialReason, roleMeta, type PermId } from "./permissions";
import { LIMITS, sanitizeText, validateComment, validateDescription, validateLabels, validatePoints, validateTitle } from "./validation";

const LS_KEY = "taskira.v1";

/* ---------------- утилиты ---------------- */
export const canTransition = (wf: Workflow, from: string, to: string) =>
  from === to || wf.transitions.some((t) => t.from === from && t.to === to);

export const statusById = (wf: Workflow, id: string) => wf.statuses.find((s) => s.id === id);

export const relTime = (ts: number) => {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 6e4);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const dN = Math.floor(h / 24);
  if (dN === 1) return "вчера";
  if (dN < 7) return `${dN} дн назад`;
  return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
};

export const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

/* ---------------- состояние ---------------- */
export interface UIState {
  view: ViewId;
  selectedIssueId: string | null;
  createOpen: boolean;
  lastEvent: { issueId: string; ts: number } | null;
}

export interface CreateInput {
  title: string;
  description: string;
  typeId: IssueTypeId;
  priorityId: PriorityId;
  assigneeId: string | null;
  epicId: string | null;
  labels: string[];
  points: number | null;
  sprintId: string | null;
  statusId?: string;
}

interface Api {
  data: Data;
  me: User;
  ui: UIState;
  toasts: Toast[];
  /** Единая точка проверки прав в компонентах: can("edit", issue) */
  can: (perm: PermId, issue?: Issue) => boolean;
  setView: (v: ViewId) => void;
  openIssue: (id: string | null) => void;
  setCreateOpen: (v: boolean) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  switchUser: (id: string) => void;
  createIssue: (input: CreateInput) => void;
  updateIssue: (id: string, patch: Partial<Issue>) => void;
  moveStatus: (issueId: string, toStatus: string, beforeId?: string | null) => void;
  setSprint: (issueId: string, sprintId: string | null) => void;
  addComment: (issueId: string, body: string) => void;
  deleteIssue: (issueId: string) => void;
  addTransition: (from: string, to: string) => string | null;
  removeTransition: (id: string) => void;
  resetWorkflow: () => void;
  startSprint: () => void;
  completeSprint: () => void;
  resetDemo: () => void;
}

const Ctx = createContext<Api | null>(null);

/* Загрузка с миграцией: пользователи и их роли всегда из сида (источник истины),
   задачи/спринты/схема/счётчик — из localStorage. Старые данные без accessRole
   автоматически получают роль из сида. */
function load(): Data {
  const base = freshData();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.issues) && parsed.workflow && Array.isArray(parsed.sprints)) {
        return { ...base, issues: parsed.issues, sprints: parsed.sprints, workflow: parsed.workflow, seq: parsed.seq ?? base.seq };
      }
    }
  } catch {
    /* повреждённые данные — начинаем заново */
  }
  return base;
}

let toastSeq = 1;

/* Идентификаторы — RFC 4122 UUID (Этап 1): формат совпадает с серверными PK в PostgreSQL.
   Fallback — для несекьюрного контекста (http вне localhost), где crypto.randomUUID недоступен. */
const uuid = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
      );

/* Временный алиас: точки вызова перейдут на uuid() напрямую при переносе store на API (Этап 4) */
const nid = (_prefix: string): string => uuid();

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Data>(load);
  const [ui, setUi] = useState<UIState>({ view: "board", selectedIssueId: null, createOpen: false, lastEvent: null });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ issues: data.issues, sprints: data.sprints, workflow: data.workflow, seq: data.seq }),
    );
  }, [data]);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const me = () => dataRef.current.users.find((u) => u.id === dataRef.current.currentUserId) ?? dataRef.current.users[0];
  const wf = () => dataRef.current.workflow;
  const sName = (id: string) => statusById(wf(), id)?.name ?? id;

  /* Страж мутаций: проверяет право текущего пользователя и показывает тост-отказ */
  const requirePerm = useCallback(
    (perm: PermId, issue?: Issue): boolean => {
      const u = me();
      if (canDo(u, perm, issue)) return true;
      toast("error", denialReason(u, perm, issue));
      return false;
    },
    [toast],
  );

  /* ------- действия (каждое защищено проверкой прав) ------- */
  const createIssue = useCallback(
    (input: CreateInput) => {
      if (!requirePerm("create")) return;
      /* Валидация ввода (Этап 1). Сервер повторяет эти проверки zod-схемами. */
      const t = validateTitle(input.title);
      if (!t.ok) return toast("error", t.error);
      const d = validateDescription(input.description);
      if (!d.ok) return toast("error", d.error);
      const l = validateLabels(input.labels);
      if (!l.ok) return toast("error", l.error);
      const p = validatePoints(input.points);
      if (!p.ok) return toast("error", p.error);
      input = { ...input, title: t.value, description: d.value, labels: l.value, points: p.value };
      const d0 = dataRef.current;
      const num = d0.seq;
      const id = nid("i");
      const now = Date.now();
      const issue: Issue = {
        id,
        key: `${d0.project.key}-${num}`,
        title: input.title,
        description: input.description,
        typeId: input.typeId,
        statusId: input.statusId ?? "todo",
        priorityId: input.priorityId,
        assigneeId: input.assigneeId,
        reporterId: d0.currentUserId,
        epicId: input.epicId,
        labels: input.labels,
        points: input.points,
        sprintId: input.sprintId,
        comments: [],
        activity: [{ id: nid("a"), authorId: d0.currentUserId, issueId: id, ts: now, text: "создал(а) задачу" }],
        createdAt: now,
        updatedAt: now,
      };
      setData((prev) => ({ ...prev, seq: prev.seq + 1, issues: [...prev.issues, issue] }));
      setUi((u) => ({ ...u, lastEvent: { issueId: id, ts: now } }));
      toast("success", `${issue.key} «${issue.title.slice(0, 38)}${issue.title.length > 38 ? "…" : ""}» создана`);
    },
    [toast, requirePerm],
  );

  const updateIssue = useCallback(
    (id: string, patch: Partial<Issue>) => {
      const iss = dataRef.current.issues.find((i) => i.id === id);
      if (!iss) return;
      if (!requirePerm("edit", iss)) return;
      /* Нормализация входных значений (зеркалится сервером, Этап 3) */
      if (patch.title !== undefined) {
        const r = validateTitle(patch.title);
        if (!r.ok) return toast("error", r.error);
        patch = { ...patch, title: r.value };
      }
      if (patch.description !== undefined) patch = { ...patch, description: sanitizeText(patch.description, LIMITS.description.max) };
      if (patch.labels !== undefined) {
        const r = validateLabels(patch.labels);
        if (!r.ok) return toast("error", r.error);
        patch = { ...patch, labels: r.value };
      }
      if (patch.points !== undefined) {
        const r = validatePoints(patch.points);
        if (!r.ok) return toast("error", r.error);
        patch = { ...patch, points: r.value };
      }
      setData((prev) => {
        const cur = prev.issues.find((i) => i.id === id)!;
        const logs: string[] = [];
        if (patch.assigneeId !== undefined && patch.assigneeId !== cur.assigneeId) {
          const u = prev.users.find((x) => x.id === patch.assigneeId);
          logs.push(u ? `назначил(а) исполнителем ${u.name}` : "снял(а) исполнителя");
        }
        if (patch.priorityId && patch.priorityId !== cur.priorityId)
          logs.push(`изменил(а) приоритет: ${PRIORITIES[cur.priorityId].name} → ${PRIORITIES[patch.priorityId].name}`);
        if (patch.points !== undefined && patch.points !== cur.points)
          logs.push(`изменил(а) оценку: ${cur.points ?? "—"} → ${patch.points ?? "—"}`);
        if (patch.labels && JSON.stringify(patch.labels) !== JSON.stringify(cur.labels)) logs.push("обновил(а) метки");
        if (patch.epicId !== undefined && patch.epicId !== cur.epicId) logs.push("изменил(а) эпик");
        if (patch.sprintId !== undefined && patch.sprintId !== cur.sprintId) {
          const sp = prev.sprints.find((s) => s.id === patch.sprintId);
          logs.push(sp ? `переместил(а) в ${sp.name}` : "вернул(а) в бэклог");
        }
        if (patch.description !== undefined && patch.description !== cur.description) logs.push("обновил(а) описание");
        if (patch.title !== undefined && patch.title !== cur.title) logs.push("переименовал(а) задачу");
        let next = { ...cur, ...patch, updatedAt: Date.now() };
        for (const t of logs)
          next = { ...next, activity: [...next.activity, { id: nid("a"), authorId: prev.currentUserId, issueId: id, ts: Date.now(), text: t }] };
        return { ...prev, issues: prev.issues.map((i) => (i.id === id ? next : i)) };
      });
    },
    [requirePerm, toast],
  );

  const moveStatus = useCallback(
    (issueId: string, toStatus: string, beforeId?: string | null) => {
      if (!requirePerm("transition")) return;
      const d0 = dataRef.current;
      const iss = d0.issues.find((i) => i.id === issueId);
      if (!iss) return;
      if (iss.statusId !== toStatus && !canTransition(d0.workflow, iss.statusId, toStatus)) {
        toast("error", `Переход «${sName(iss.statusId)} → ${sName(toStatus)}» запрещён рабочим процессом`);
        return;
      }
      const now = Date.now();
      setData((prev) => {
        const cur = prev.issues.find((i) => i.id === issueId)!;
        const changed = cur.statusId !== toStatus;
        let updated: Issue = { ...cur, statusId: toStatus, updatedAt: now };
        if (changed)
          updated = {
            ...updated,
            activity: [
              ...updated.activity,
              { id: nid("a"), authorId: prev.currentUserId, issueId, ts: now, text: `переместил(а) из «${sName(cur.statusId)}» в «${sName(toStatus)}»` },
            ],
          };
        const rest = prev.issues.filter((i) => i.id !== issueId);
        let idx = rest.length;
        if (beforeId) {
          const b = rest.findIndex((i) => i.id === beforeId);
          if (b >= 0) idx = b;
        } else {
          const last = rest.map((i, k) => [i, k] as const).filter(([i]) => i.statusId === toStatus).pop();
          if (last) idx = last[1] + 1;
        }
        rest.splice(idx, 0, updated);
        return { ...prev, issues: rest };
      });
      setUi((u) => ({ ...u, lastEvent: { issueId, ts: now } }));
    },
    [toast, requirePerm],
  );

  const setSprint = useCallback(
    (issueId: string, sprintId: string | null) => {
      if (!requirePerm("manageSprints")) return;
      setData((prev) => {
        const iss = prev.issues.find((i) => i.id === issueId);
        if (!iss || iss.sprintId === sprintId) return prev;
        const sp = prev.sprints.find((s) => s.id === sprintId);
        const text = sp ? `переместил(а) в ${sp.name}` : "вернул(а) в бэклог";
        return {
          ...prev,
          issues: prev.issues.map((i) =>
            i.id === issueId
              ? { ...i, sprintId, updatedAt: Date.now(), activity: [...i.activity, { id: nid("a"), authorId: prev.currentUserId, issueId, ts: Date.now(), text }] }
              : i,
          ),
        };
      });
    },
    [requirePerm],
  );

  const addComment = useCallback(
    (issueId: string, body: string) => {
      if (!requirePerm("comment")) return;
      const r = validateComment(body);
      if (!r.ok) {
        toast("error", r.error);
        return;
      }
      const b = r.value;
      setData((prev) => ({
        ...prev,
        issues: prev.issues.map((i) =>
          i.id === issueId
            ? { ...i, updatedAt: Date.now(), comments: [...i.comments, { id: nid("c"), authorId: prev.currentUserId, body: b, ts: Date.now() }] }
            : i,
        ),
      }));
      toast("success", "Комментарий добавлен");
    },
    [toast, requirePerm],
  );

  const deleteIssue = useCallback(
    (issueId: string) => {
      if (!requirePerm("delete")) return;
      const iss = dataRef.current.issues.find((i) => i.id === issueId);
      setData((prev) => ({
        ...prev,
        issues: prev.issues.map((i) => (i.epicId === issueId ? { ...i, epicId: null } : i)).filter((i) => i.id !== issueId),
      }));
      setUi((u) => ({ ...u, selectedIssueId: u.selectedIssueId === issueId ? null : u.selectedIssueId }));
      if (iss) toast("info", `${iss.key} удалена`);
    },
    [toast, requirePerm],
  );

  const addTransition = useCallback(
    (from: string, to: string): string | null => {
      const u = me();
      if (!canDo(u, "editWorkflow")) {
        const msg = denialReason(u, "editWorkflow");
        toast("error", msg);
        return msg;
      }
      if (from === to) return "Статусы «из» и «в» совпадают";
      const d0 = dataRef.current;
      if (d0.workflow.transitions.some((t) => t.from === from && t.to === to)) return "Такой переход уже есть в схеме";
      const tr: Transition = { id: nid("t"), from, to };
      setData((prev) => ({ ...prev, workflow: { ...prev.workflow, transitions: [...prev.workflow.transitions, tr] } }));
      toast("success", `Переход «${sName(from)} → ${sName(to)}» добавлен`);
      return null;
    },
    [toast],
  );

  const removeTransition = useCallback(
    (id: string) => {
      if (!requirePerm("editWorkflow")) return;
      setData((prev) => ({ ...prev, workflow: { ...prev.workflow, transitions: prev.workflow.transitions.filter((t) => t.id !== id) } }));
      toast("info", "Переход удалён из схемы");
    },
    [toast, requirePerm],
  );

  const resetWorkflow = useCallback(() => {
    if (!requirePerm("editWorkflow")) return;
    setData((prev) => ({ ...prev, workflow: structuredClone(DEFAULT_WORKFLOW) }));
    toast("info", "Схема рабочего процесса восстановлена");
  }, [toast, requirePerm]);

  const startSprint = useCallback(() => {
    if (!requirePerm("manageSprints")) return;
    setData((prev) => {
      const future = prev.sprints.find((s) => s.status === "future");
      if (future) {
        const today = new Date();
        const end = new Date(Date.now() + 14 * 864e5);
        const iso = (dt: Date) => dt.toISOString().slice(0, 10);
        return {
          ...prev,
          sprints: prev.sprints.map((s) => (s.id === future.id ? { ...s, status: "active" as const, startDate: iso(today), endDate: iso(end) } : s)),
        };
      }
      const num = prev.sprints.length + 6;
      const sp = {
        id: nid("s"),
        name: `Спринт ${num}`,
        goal: "",
        status: "active" as const,
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
      };
      return { ...prev, sprints: [...prev.sprints, sp] };
    });
    toast("success", "Спринт начат — задачи на доске");
  }, [toast, requirePerm]);

  const completeSprint = useCallback(() => {
    if (!requirePerm("manageSprints")) return;
    const d0 = dataRef.current;
    const active = d0.sprints.find((s) => s.status === "active");
    if (!active) return;
    const doneId = d0.workflow.statuses.find((s) => s.category === "done")?.id;
    const unfinished = d0.issues.filter((i) => i.sprintId === active.id && i.statusId !== doneId && i.typeId !== "epic").length;
    setData((prev) => {
      const num = prev.sprints.length + 6;
      return {
        ...prev,
        issues: prev.issues.map((i) => (i.sprintId === active.id && i.statusId !== doneId ? { ...i, sprintId: null } : i)),
        sprints: [
          ...prev.sprints.map((s) => (s.id === active.id ? { ...s, status: "completed" as const } : s)),
          {
            id: nid("s"),
            name: `Спринт ${num}`,
            goal: "",
            status: "future" as const,
            startDate: new Date(Date.now() + 864e5).toISOString().slice(0, 10),
            endDate: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10),
          },
        ],
      };
    });
    toast("success", `${active.name} завершён${unfinished ? ` — ${unfinished} недозакрытых задач вернулись в бэклог` : ", все задачи закрыты"}`);
  }, [toast, requirePerm]);

  const switchUser = useCallback(
    (id: string) => {
      const u = dataRef.current.users.find((x) => x.id === id);
      if (!u || id === dataRef.current.currentUserId) return;
      setData((prev) => ({ ...prev, currentUserId: id }));
      toast("info", `Вы вошли как ${u.name} — роль «${roleMeta(u.accessRole).name}»`);
    },
    [toast],
  );

  const resetDemo = useCallback(() => {
    localStorage.removeItem(LS_KEY);
    setData(freshData());
    setUi({ view: "board", selectedIssueId: null, createOpen: false, lastEvent: null });
    toast("info", "Демо-данные сброшены к исходным");
  }, [toast]);

  const meUser = data.users.find((u) => u.id === data.currentUserId) ?? data.users[0];

  const api = useMemo<Api>(
    () => ({
      data,
      me: meUser,
      ui,
      toasts,
      can: (perm, issue) => canDo(meUser, perm, issue),
      setView: (v) => setUi((u) => ({ ...u, view: v })),
      openIssue: (id) => setUi((u) => ({ ...u, selectedIssueId: id })),
      setCreateOpen: (v) => setUi((u) => ({ ...u, createOpen: v })),
      toast,
      switchUser,
      createIssue,
      updateIssue,
      moveStatus,
      setSprint,
      addComment,
      deleteIssue,
      addTransition,
      removeTransition,
      resetWorkflow,
      startSprint,
      completeSprint,
      resetDemo,
    }),
    [data, meUser, ui, toasts, toast, switchUser, createIssue, updateIssue, moveStatus, setSprint, addComment, deleteIssue, addTransition, removeTransition, resetWorkflow, startSprint, completeSprint, resetDemo],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore вне провайдера");
  return ctx;
}

export const typeName = (t: IssueTypeId) => ISSUE_TYPES[t].name;
