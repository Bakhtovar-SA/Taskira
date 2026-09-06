import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type {
  AccessRole,
  Data,
  Issue,
  IssueTypeId,
  PriorityId,
  ProjectRole,
  ProjectSummary,
  Toast,
  User,
  ViewId,
  Workflow,
} from "./types";
import { can as canDo, denialReason, resolveRole, roleMeta, type PermId } from "./permissions";
import { LIMITS, sanitizeText, validateComment, validateDescription, validateLabels, validatePoints, validateTitle } from "./validation";
import {
  ApiError,
  authApi,
  clearToken,
  commentsApi,
  getToken,
  issuesApi,
  membersApi,
  projectsApi,
  sprintsApi,
  type ServerIssue,
  type SafeUser,
  workflowApi,
} from "./api";

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

export type BootStatus = "idle" | "loading" | "ready" | "unauthenticated" | "error";

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
  dueDate?: string | null;
}

const PROJECT_KEY = "taskira.project";
const readLastProject = (): string => {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? "";
  } catch {
    return "";
  }
};
const writeLastProject = (id: string): void => {
  try {
    localStorage.setItem(PROJECT_KEY, id);
  } catch {
    /* noop */
  }
};

const emptyData = (): Data => ({
  project: { key: "…", name: "…", description: "" },
  projects: [],
  currentProjectId: "",
  users: [],
  members: {},
  currentUserId: "",
  issues: [],
  sprints: [],
  workflow: { statuses: [], transitions: [] },
  seq: 1,
});

function mapUser(u: SafeUser, members: Record<string, ProjectRole>): User {
  return {
    id: u.id,
    name: u.name,
    initials: u.initials,
    color: u.color,
    role: u.jobRole,
    globalRole: u.globalRole,
    // Реальная эффективная роль в текущем проекте (globalRole + членство).
    // Не-участник и не admin ресурса → роли нет: фолбэк 'viewer' (минимум прав).
    // Для `me` store дополнительно пересчитывает её в memo при изменении data.members.
    accessRole: resolveRole(u.globalRole, members[u.id]) ?? "viewer",
    username: u.username,
  };
}

function normalizeType(t: string): IssueTypeId {
  if (t === "bug" || t === "request" || t === "task") return t;
  return "task";
}

function mapIssue(dto: ServerIssue, prev?: Issue): Issue {
  return {
    id: dto.id,
    key: dto.key,
    title: dto.title,
    description: dto.description ?? "",
    typeId: normalizeType(dto.typeId),
    statusId: dto.statusId,
    priorityId: (dto.priorityId as PriorityId) || "medium",
    assigneeId: dto.assigneeId,
    reporterId: dto.reporterId,
    epicId: dto.epicId,
    labels: dto.labels ?? [],
    points: dto.points,
    sprintId: dto.sprintId,
    dueDate: dto.dueDate,
    rank: dto.rank,
    color: dto.color ?? undefined,
    tStart: dto.tStart ?? undefined,
    tSpan: dto.tSpan ?? undefined,
    comments: prev?.comments ?? [],
    activity: prev?.activity ?? [],
    createdAt: Date.parse(dto.createdAt) || Date.now(),
    updatedAt: Date.parse(dto.updatedAt) || Date.now(),
  };
}

function upsertIssue(list: Issue[], issue: Issue): Issue[] {
  const i = list.findIndex((x) => x.id === issue.id);
  if (i < 0) return [...list, issue];
  const next = list.slice();
  next[i] = { ...issue, comments: list[i].comments, activity: list[i].activity };
  return next;
}

interface Api {
  data: Data;
  me: User;
  ui: UIState;
  toasts: Toast[];
  bootStatus: BootStatus;
  can: (perm: PermId, issue?: Issue) => boolean;
  bootstrap: () => Promise<void>;
  switchProject: (projectId: string) => void;
  logout: () => void;
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
  setMemberRole: (userId: string, role: ProjectRole) => void;
  removeMember: (userId: string) => void;
  resetDemo: () => void;
}

const Ctx = createContext<Api | null>(null);

let toastSeq = 1;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Data>(emptyData);
  const [bootStatus, setBootStatus] = useState<BootStatus>("idle");
  const [ui, setUi] = useState<UIState>({
    view: "board",
    selectedIssueId: null,
    createOpen: false,
    lastEvent: null,
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dataRef = useRef(data);
  dataRef.current = data;

  /** id текущего проекта — для вызовов /api/projects/:projectId/... */
  const pid = () => dataRef.current.currentProjectId;

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const handleApiError = useCallback(
    (err: unknown, fallback = "Ошибка запроса") => {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          clearToken();
          setBootStatus("unauthenticated");
          setData(emptyData());
        }
        toast("error", err.message || fallback);
        return;
      }
      toast("error", fallback);
    },
    [toast],
  );

  const me = useMemo<User>(() => {
    const base =
      data.users.find((u) => u.id === data.currentUserId) ??
      data.users[0] ?? {
        id: "",
        name: "…",
        initials: "?",
        color: "#64748B",
        role: "",
        globalRole: "member" as const,
        accessRole: "viewer" as const,
      };
    // Эффективная роль текущего пользователя: admin (глобально) или роль в проекте.
    // Успешный bootstrap гарантирует членство либо globalRole='admin', так что
    // null тут на практике не возникает; 'viewer' — безопасный фолбэк для типа.
    const effective: AccessRole =
      resolveRole(base.globalRole, data.members[base.id]) ?? "viewer";
    return { ...base, accessRole: effective };
  }, [data.users, data.currentUserId, data.members]);

  const canFn = useCallback((perm: PermId, issue?: Issue) => canDo(me, perm, issue), [me]);

  const requirePerm = useCallback(
    (perm: PermId, issue?: Issue): boolean => {
      if (canDo(me, perm, issue)) return true;
      toast("error", denialReason(me, perm, issue));
      return false;
    },
    [me, toast],
  );

  /** Грузит данные одного проекта (bootstrap + задачи) в объект Data. */
  const buildProjectData = useCallback(
    async (projectId: string, currentUserId: string, projects: ProjectSummary[]): Promise<Data> => {
      const boot = await projectsApi.get(projectId);
      const issuesRes = await issuesApi.list(projectId, { limit: 200 });
      const members: Record<string, ProjectRole> = {};
      for (const m of boot.members) members[m.userId] = m.role;
      const users = boot.users.map((u) => mapUser(u, members));
      return {
        project: {
          id: boot.project.id,
          key: boot.project.key,
          name: boot.project.name,
          description: boot.project.description ?? "",
          departmentId: boot.project.departmentId,
          isShared: boot.project.isShared,
        },
        projects,
        currentProjectId: projectId,
        users,
        members,
        currentUserId,
        issues: issuesRes.items.map((i) => mapIssue(i)).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
        sprints: boot.sprints.map((s) => ({
          id: s.id,
          name: s.name,
          goal: s.goal ?? "",
          status: s.status,
          startDate: s.startDate ?? "",
          endDate: s.endDate ?? "",
        })),
        workflow: {
          statuses: boot.workflow.statuses.map((s) => ({ id: s.id, name: s.name, category: s.category })),
          transitions: boot.workflow.transitions.map((t) => ({ id: t.id, from: t.from, to: t.to })),
        },
        seq: issuesRes.total + 1,
      };
    },
    [],
  );

  const bootstrap = useCallback(async () => {
    if (!getToken()) {
      setBootStatus("unauthenticated");
      return;
    }
    setBootStatus("loading");
    try {
      const user = await authApi.me();
      const list = await projectsApi.list();
      const projects: ProjectSummary[] = list.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        departmentId: p.departmentId,
        isShared: p.isShared,
      }));
      if (projects.length === 0) {
        setData({ ...emptyData(), currentUserId: user.id });
        setBootStatus("ready");
        toast("info", "Вам пока не открыт ни один проект — обратитесь к администратору");
        return;
      }
      const wanted = readLastProject();
      const chosen = projects.find((p) => p.id === wanted)?.id ?? projects[0].id;
      setData(await buildProjectData(chosen, user.id, projects));
      writeLastProject(chosen);
      setBootStatus("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        setBootStatus("unauthenticated");
        return;
      }
      handleApiError(err, "Не удалось загрузить данные");
      setBootStatus("error");
    }
  }, [handleApiError, buildProjectData, toast]);

  const switchProject = useCallback(
    (projectId: string) => {
      const cur = dataRef.current;
      if (projectId === cur.currentProjectId || !cur.projects.some((p) => p.id === projectId)) return;
      setBootStatus("loading");
      void (async () => {
        try {
          setData(await buildProjectData(projectId, cur.currentUserId, cur.projects));
          writeLastProject(projectId);
          setUi((u) => ({ ...u, selectedIssueId: null }));
          setBootStatus("ready");
        } catch (err) {
          handleApiError(err, "Не удалось открыть проект");
          setBootStatus("ready");
        }
      })();
    },
    [buildProjectData, handleApiError],
  );

  const logout = useCallback(() => {
    clearToken();
    setData(emptyData());
    setUi({ view: "board", selectedIssueId: null, createOpen: false, lastEvent: null });
    setBootStatus("unauthenticated");
  }, []);

  const refreshIssues = useCallback(async () => {
    try {
      const issuesRes = await issuesApi.list(pid(), { limit: 200 });
      setData((prev) => ({
        ...prev,
        issues: issuesRes.items.map((dto) => {
          const old = prev.issues.find((x) => x.id === dto.id);
          return mapIssue(dto, old);
        }),
      }));
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError]);

  const openIssue = useCallback(
    (id: string | null) => {
      setUi((u) => ({ ...u, selectedIssueId: id }));
      if (!id) return;
      void (async () => {
        try {
          const [dto, comments] = await Promise.all([issuesApi.get(pid(), id), commentsApi.list(pid(), id).catch(() => [])]);
          setData((prev) => {
            const mapped = mapIssue(dto, prev.issues.find((x) => x.id === id));
            mapped.comments = (comments as { id: string; authorId: string; body: string; createdAt: string }[]).map(
              (c) => ({
                id: c.id,
                authorId: c.authorId,
                body: c.body,
                ts: Date.parse(c.createdAt) || Date.now(),
              }),
            );
            return { ...prev, issues: upsertIssue(prev.issues, mapped) };
          });
        } catch (err) {
          handleApiError(err, "Не удалось открыть задачу");
        }
      })();
    },
    [handleApiError],
  );

  const createIssue = useCallback(
    (input: CreateInput) => {
      if (!requirePerm("create")) return;
      const t = validateTitle(input.title);
      if (!t.ok) return toast("error", t.error);
      const d = validateDescription(input.description);
      if (!d.ok) return toast("error", d.error);
      const l = validateLabels(input.labels);
      if (!l.ok) return toast("error", l.error);
      const p = validatePoints(input.points);
      if (!p.ok) return toast("error", p.error);

      void (async () => {
        try {
          const dto = await issuesApi.create(pid(), {
            title: t.value,
            description: d.value,
            typeId: input.typeId,
            priorityId: input.priorityId,
            assigneeId: input.assigneeId,
            epicId: input.epicId,
            labels: l.value,
            points: p.value,
            sprintId: input.sprintId,
            statusId: input.statusId,
            dueDate: input.dueDate ?? null,
          });
          const issue = mapIssue(dto);
          setData((prev) => ({ ...prev, issues: [...prev.issues, issue] }));
          setUi((u) => ({ ...u, lastEvent: { issueId: issue.id, ts: Date.now() }, createOpen: false }));
          toast("success", `${issue.key} создана`);
        } catch (err) {
          handleApiError(err, "Не удалось создать задачу");
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const updateIssue = useCallback(
    (id: string, patch: Partial<Issue>) => {
      const iss = dataRef.current.issues.find((i) => i.id === id);
      if (!iss) return;
      if (!requirePerm("edit", iss)) return;

      const body: Record<string, unknown> = {};
      if (patch.title !== undefined) {
        const r = validateTitle(patch.title);
        if (!r.ok) return toast("error", r.error);
        body.title = r.value;
      }
      if (patch.description !== undefined) body.description = sanitizeText(patch.description, LIMITS.description.max);
      if (patch.labels !== undefined) {
        const r = validateLabels(patch.labels);
        if (!r.ok) return toast("error", r.error);
        body.labels = r.value;
      }
      if (patch.points !== undefined) {
        const r = validatePoints(patch.points);
        if (!r.ok) return toast("error", r.error);
        body.points = r.value;
      }
      if (patch.priorityId !== undefined) body.priorityId = patch.priorityId;
      if (patch.assigneeId !== undefined) body.assigneeId = patch.assigneeId;
      if (patch.epicId !== undefined) body.epicId = patch.epicId;
      if (patch.sprintId !== undefined) body.sprintId = patch.sprintId;
      if (patch.dueDate !== undefined) body.dueDate = patch.dueDate;
      if (patch.tStart !== undefined) body.tStart = patch.tStart;
      if (patch.tSpan !== undefined) body.tSpan = patch.tSpan;
      if (patch.color !== undefined) body.color = patch.color;

      if (Object.keys(body).length === 0) return;

      void (async () => {
        try {
          const dto = await issuesApi.patch(pid(), id, body);
          setData((prev) => ({
            ...prev,
            issues: prev.issues.map((i) => (i.id === id ? mapIssue(dto, i) : i)),
          }));
        } catch (err) {
          handleApiError(err, "Не удалось сохранить задачу");
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const moveStatus = useCallback(
    (issueId: string, toStatus: string, beforeId?: string | null) => {
      if (!requirePerm("transition")) return;
      const iss = dataRef.current.issues.find((i) => i.id === issueId);
      if (!iss) return;
      const wf = dataRef.current.workflow;
      if (iss.statusId !== toStatus && !canTransition(wf, iss.statusId, toStatus)) {
        const fromN = statusById(wf, iss.statusId)?.name ?? iss.statusId;
        const toN = statusById(wf, toStatus)?.name ?? toStatus;
        toast("error", `Переход «${fromN} → ${toN}» запрещён рабочим процессом`);
        return;
      }
      void (async () => {
        try {
          const dto = await issuesApi.transition(pid(), issueId, toStatus, beforeId);
          setData((prev) => ({
            ...prev,
            issues: prev.issues.map((i) => (i.id === issueId ? mapIssue(dto, i) : i)),
          }));
          setUi((u) => ({ ...u, lastEvent: { issueId, ts: Date.now() } }));
        } catch (err) {
          handleApiError(err, "Не удалось сменить статус");
          void refreshIssues();
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshIssues],
  );

  const setSprint = useCallback(
    (issueId: string, sprintId: string | null) => {
      if (!requirePerm("manageSprints")) return;
      void (async () => {
        try {
          const dto = await issuesApi.setSprint(pid(), issueId, sprintId);
          setData((prev) => ({
            ...prev,
            issues: prev.issues.map((i) => (i.id === issueId ? mapIssue(dto, i) : i)),
          }));
        } catch (err) {
          handleApiError(err);
        }
      })();
    },
    [requirePerm, handleApiError],
  );

  const addComment = useCallback(
    (issueId: string, body: string) => {
      if (!requirePerm("comment")) return;
      const r = validateComment(body);
      if (!r.ok) return toast("error", r.error);
      void (async () => {
        try {
          const c = await commentsApi.create(pid(), issueId, r.value);
          setData((prev) => ({
            ...prev,
            issues: prev.issues.map((i) =>
              i.id === issueId
                ? {
                    ...i,
                    comments: [
                      ...i.comments,
                      {
                        id: c.id,
                        authorId: c.authorId,
                        body: c.body,
                        ts: Date.parse(c.createdAt) || Date.now(),
                      },
                    ],
                  }
                : i,
            ),
          }));
          toast("success", "Комментарий добавлен");
        } catch (err) {
          handleApiError(err);
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const deleteIssue = useCallback(
    (issueId: string) => {
      if (!requirePerm("delete")) return;
      const iss = dataRef.current.issues.find((i) => i.id === issueId);
      void (async () => {
        try {
          await issuesApi.remove(pid(), issueId);
          setData((prev) => ({
            ...prev,
            issues: prev.issues
              .filter((i) => i.id !== issueId)
              .map((i) => (i.epicId === issueId ? { ...i, epicId: null } : i)),
          }));
          setUi((u) => ({ ...u, selectedIssueId: u.selectedIssueId === issueId ? null : u.selectedIssueId }));
          if (iss) toast("info", `${iss.key} удалена`);
        } catch (err) {
          handleApiError(err);
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const addTransition = useCallback(
    (from: string, to: string): string | null => {
      if (!requirePerm("editWorkflow")) return "Нет прав";
      if (from === to) return "Статусы «из» и «в» совпадают";
      void (async () => {
        try {
          const tr = await workflowApi.addTransition(pid(), from, to);
          setData((prev) => ({
            ...prev,
            workflow: {
              ...prev.workflow,
              transitions: [...prev.workflow.transitions, { id: tr.id, from: tr.from, to: tr.to }],
            },
          }));
          toast("success", "Переход добавлен");
        } catch (err) {
          handleApiError(err);
        }
      })();
      return null;
    },
    [requirePerm, toast, handleApiError],
  );

  const removeTransition = useCallback(
    (id: string) => {
      if (!requirePerm("editWorkflow")) return;
      void (async () => {
        try {
          await workflowApi.removeTransition(pid(), id);
          setData((prev) => ({
            ...prev,
            workflow: {
              ...prev.workflow,
              transitions: prev.workflow.transitions.filter((t) => t.id !== id),
            },
          }));
          toast("info", "Переход удалён");
        } catch (err) {
          handleApiError(err);
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const resetWorkflow = useCallback(() => {
    if (!requirePerm("editWorkflow")) return;
    void (async () => {
      try {
        await workflowApi.reset(pid());
        const boot = await projectsApi.get(pid());
        setData((prev) => ({
          ...prev,
          workflow: {
            statuses: boot.workflow.statuses.map((s) => ({ id: s.id, name: s.name, category: s.category })),
            transitions: boot.workflow.transitions.map((t) => ({ id: t.id, from: t.from, to: t.to })),
          },
        }));
        toast("info", "Схема восстановлена");
      } catch (err) {
        handleApiError(err);
      }
    })();
  }, [requirePerm, toast, handleApiError]);

  const startSprint = useCallback(() => {
    if (!requirePerm("manageSprints")) return;
    void (async () => {
      try {
        await sprintsApi.start(pid());
        const boot = await projectsApi.get(pid());
        setData((prev) => ({
          ...prev,
          sprints: boot.sprints.map((s) => ({
            id: s.id,
            name: s.name,
            goal: s.goal ?? "",
            status: s.status,
            startDate: s.startDate ?? "",
            endDate: s.endDate ?? "",
          })),
        }));
        toast("success", "Спринт начат");
      } catch (err) {
        handleApiError(err);
      }
    })();
  }, [requirePerm, toast, handleApiError]);

  const completeSprint = useCallback(() => {
    if (!requirePerm("manageSprints")) return;
    const active = dataRef.current.sprints.find((s) => s.status === "active");
    if (!active) return;
    void (async () => {
      try {
        await sprintsApi.complete(pid(), active.id);
        await refreshIssues();
        const boot = await projectsApi.get(pid());
        setData((prev) => ({
          ...prev,
          sprints: boot.sprints.map((s) => ({
            id: s.id,
            name: s.name,
            goal: s.goal ?? "",
            status: s.status,
            startDate: s.startDate ?? "",
            endDate: s.endDate ?? "",
          })),
        }));
        toast("success", `${active.name} завершён`);
      } catch (err) {
        handleApiError(err);
      }
    })();
  }, [requirePerm, toast, handleApiError, refreshIssues]);

  const setMemberRole = useCallback(
    (userId: string, role: ProjectRole) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          const res = await membersApi.set(pid(), userId, role);
          setData((prev) => ({ ...prev, members: { ...prev.members, [res.userId]: res.role } }));
          toast("success", "Роль участника обновлена");
        } catch (err) {
          handleApiError(err, "Не удалось изменить роль участника");
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const removeMember = useCallback(
    (userId: string) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          await membersApi.remove(pid(), userId);
          setData((prev) => {
            const members = { ...prev.members };
            delete members[userId];
            return { ...prev, members };
          });
          toast("info", "Участник удалён из проекта");
        } catch (err) {
          handleApiError(err, "Не удалось удалить участника");
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  // Демо-переключение роли: только на localhost и только для превью UX прав.
  // Меняет локально «кто такой me» — кнопки/бейджи/тултипы и клиентский requirePerm
  // пересчитываются по эффективной роли выбранного пользователя. ВАЖНО: JWT остаётся
  // вашим, поэтому мутации, если проскочат мимо UI-гейта, сервер выполнит под вашим
  // входом. Для настоящей проверки серверных прав — реальный логин (пароль тестовых
  // пользователей задавали при их создании).
  const switchUser = useCallback(
    (id: string) => {
      const onLocalhost =
        typeof location !== "undefined" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
      if (!onLocalhost) {
        toast("info", "Демо-переключение ролей отключено — используйте вход под другим пользователем");
        return;
      }
      const u = dataRef.current.users.find((x) => x.id === id);
      if (!u) return;
      setData((prev) => ({ ...prev, currentUserId: id }));
      const eff = resolveRole(u.globalRole, dataRef.current.members[u.id]);
      toast(
        "info",
        `UI от лица «${u.name}» — ${eff ? roleMeta(eff).name : "нет доступа к проекту"}. Запросы к API идут под вашим входом.`,
      );
    },
    [toast],
  );

  const resetDemo = useCallback(() => {
    toast("info", "Сброс демо недоступен в режиме API");
  }, [toast]);

  const api: Api = {
    data,
    me,
    ui,
    toasts,
    bootStatus,
    can: canFn,
    bootstrap,
    switchProject,
    logout,
    setView: (v) => setUi((u) => ({ ...u, view: v })),
    openIssue,
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
    setMemberRole,
    removeMember,
    resetDemo,
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStore(): Api {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore вне StoreProvider");
  return ctx;
}
