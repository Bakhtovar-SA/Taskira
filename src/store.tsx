import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  AccessRole,
  AssignedIssue,
  Attachment,
  Collaboration,
  Collaborator,
  Data,
  Department,
  Issue,
  NotificationT,
  NotifyPrefsT,
  IssueTypeId,
  PriorityId,
  ProjectRole,
  ProjectSummary,
  Toast,
  User,
  ViewId,
  Workflow,
} from "./types";
import { can as canDo, denialReason, resolveRole, type PermId } from "./permissions";
import { LIMITS, sanitizeText, validateComment, validateDescription, validateLabels, validatePoints, validateTitle } from "./validation";
import {
  ApiError,
  attachmentsApi,
  authApi,
  clearToken,
  collaboratorsApi,
  ldapApi,
  commentsApi,
  departmentsApi,
  getToken,
  issuesApi,
  membersApi,
  notificationsApi,
  projectsApi,
  type CollaboratingItem,
  type NotifyPrefs,
  type ServerAttachment,
  type ServerNotification,
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

export type BootStatus = "idle" | "loading" | "ready" | "unauthenticated" | "error" | "solo" | "home";

/** Одноразовое пояснение к главному экрану — показывается, когда пользователь
 *  впервые видит `<HomeView>` (стало ≥ 2 проектов). Флаг только в localStorage
 *  (UI_RESTRUCTURE.md D4-transition), на сервере не хранится. */
const HOME_INTRO_KEY = "taskira.homeIntro";
const takeHomeIntro = (): boolean => {
  try {
    if (localStorage.getItem(HOME_INTRO_KEY)) return false;
    localStorage.setItem(HOME_INTRO_KEY, "1");
    return true;
  } catch {
    return false;
  }
};

/** Режим одиночного просмотра: пользователь без единого видимого проекта, но
 *  приглашённый к каким-то задачам (issue collaborators). Урезанная оболочка —
 *  только «Мои подключения» + карточка задачи. См. COLLAB_MIGRATION.md Фаза 6. */
export interface SoloState {
  userId: string;
  userName: string;
  items: CollaboratingItem[];
  /** Задача из прямой ссылки #/issue/<projectId>/<issueId>, если была. */
  openTarget: { projectId: string; issueId: string } | null;
}

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

/** Прямая ссылка на задачу: #/issue/<projectId>/<issueId> (обе — uuid). */
const HASH_ISSUE_RE = /^#\/issue\/([0-9a-fA-F-]{36})\/([0-9a-fA-F-]{36})$/;
const readIssueHash = (): { projectId: string; issueId: string } | null => {
  try {
    const m = location.hash.match(HASH_ISSUE_RE);
    return m ? { projectId: m[1], issueId: m[2] } : null;
  } catch {
    return null;
  }
};

const emptyData = (): Data => ({
  project: { key: "…", name: "…", description: "" },
  projects: [],
  departments: [],
  currentProjectId: "",
  users: [],
  members: {},
  currentUserId: "",
  issues: [],
  workflow: { statuses: [], transitions: [] },
  assignedToMe: [],
  collaborations: [],
  notifications: [],
  unreadCount: 0,
  notifyPrefs: {},
  seq: 1,
});

function mapNotification(dto: ServerNotification): NotificationT {
  return {
    id: dto.id,
    type: dto.type as NotificationT["type"],
    actor: dto.actor,
    projectId: dto.projectId,
    issueId: dto.issueId,
    payload: (dto.payload ?? {}) as NotificationT["payload"],
    createdAt: Date.parse(dto.createdAt) || Date.now(),
    read: !!dto.read,
  };
}

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

const mapAttachment = (a: ServerAttachment): Attachment => ({
  id: a.id,
  filename: a.filename,
  contentType: a.contentType,
  byteSize: a.byteSize,
  uploadedById: a.uploadedById,
  createdAt: Date.parse(a.createdAt) || Date.now(),
});

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
    dueDate: dto.dueDate,
    rank: dto.rank,
    color: dto.color ?? undefined,
    tStart: dto.tStart ?? undefined,
    tSpan: dto.tSpan ?? undefined,
    comments: prev?.comments ?? [],
    activity: prev?.activity ?? [],
    // collaborators есть только в детальном ответе GET /issues/:id; в списке —
    // держим прежнее значение (upsertIssue их не трогает).
    collaborators:
      dto.collaborators?.map((c) => ({
        userId: c.userId,
        name: c.name,
        initials: c.initials,
        color: c.color,
        jobRole: c.jobRole,
      })) ??
      prev?.collaborators ??
      [],
    // attachments — тоже только в детальном ответе; в списке держим прежнее.
    attachments: dto.attachments?.map(mapAttachment) ?? prev?.attachments ?? [],
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
  /** Заполнено только при bootStatus === "solo" (одиночный просмотр приглашённого). */
  solo: SoloState | null;
  can: (perm: PermId, issue?: Issue) => boolean;
  bootstrap: () => Promise<void>;
  switchProject: (projectId: string) => void;
  /** Показать главный экран (`<HomeView>`), не выгружая текущий проект. */
  goHome: () => void;
  /** Войти в проект с главного экрана (переключить, если это другой проект). */
  enterProject: (projectId: string) => void;
  refreshCollaborations: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markNotificationsRead: (ids?: string[]) => void;
  setNotifyPrefs: (patch: NotifyPrefsT) => void;
  logout: () => void;
  setView: (v: ViewId) => void;
  openIssue: (id: string | null) => void;
  setCreateOpen: (v: boolean) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  createIssue: (input: CreateInput) => void;
  updateIssue: (id: string, patch: Partial<Issue>) => void;
  moveStatus: (issueId: string, toStatus: string, beforeId?: string | null) => void;
  addComment: (issueId: string, body: string) => void;
  addCollaborator: (issueId: string, userId: string) => void;
  removeCollaborator: (issueId: string, userId: string) => void;
  uploadAttachment: (issueId: string, file: File) => void;
  removeAttachment: (issueId: string, attId: string) => void;
  downloadAttachment: (issueId: string, att: { id: string; filename: string }) => void;
  deleteIssue: (issueId: string) => void;
  addTransition: (from: string, to: string) => string | null;
  removeTransition: (id: string) => void;
  resetWorkflow: () => void;
  setMemberRole: (userId: string, role: ProjectRole) => void;
  removeMember: (userId: string) => void;
  /** Состав произвольного проекта (для AdminView) — глобальный admin, любой проект. */
  setProjectMember: (projectId: string, userId: string, role: ProjectRole) => Promise<void>;
  removeProjectMember: (projectId: string, userId: string) => Promise<void>;
  createDepartment: (name: string) => void;
  renameDepartment: (id: string, name: string) => void;
  /** Режим аутентификации ресурса (для AdminView: LDAP-поля/ресинк). */
  authMode: "local" | "ldap";
  setDepartmentLdapGroup: (id: string, ldapGroupDn: string | null) => void;
  resyncLdap: () => void;
  deleteDepartment: (id: string) => void;
  createProject: (input: { key: string; name: string; departmentId: string; isShared?: boolean }) => void;
  patchProject: (
    id: string,
    patch: { name?: string; description?: string; departmentId?: string; isShared?: boolean },
  ) => void;
  deleteProject: (id: string) => void;
}

const Ctx = createContext<Api | null>(null);

let toastSeq = 1;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Data>(emptyData);
  const [bootStatus, setBootStatus] = useState<BootStatus>("idle");
  const [solo, setSolo] = useState<SoloState | null>(null);
  const [authMode, setAuthMode] = useState<"local" | "ldap">("local");
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
    async (
      projectId: string,
      currentUserId: string,
      projects: ProjectSummary[],
      departments: Department[],
      collaborations: Collaboration[],
    ): Promise<Data> => {
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
        departments,
        currentProjectId: projectId,
        users,
        members,
        currentUserId,
        issues: issuesRes.items.map((i) => mapIssue(i)).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
        assignedToMe: [],
        collaborations,
        notifications: [],
        unreadCount: 0,
        notifyPrefs: {},
        workflow: {
          statuses: boot.workflow.statuses.map((s) => ({ id: s.id, sid: s.sid, name: s.name, category: s.category })),
          transitions: boot.workflow.transitions.map((t) => ({ id: t.id, from: t.from, to: t.to })),
        },
        seq: issuesRes.total + 1,
      };
    },
    [],
  );

  /* -------- уведомления (миграция 011) -------- */

  const refreshNotifications = useCallback(async () => {
    try {
      const res = await notificationsApi.list();
      setData((prev) => ({ ...prev, notifications: res.items.map(mapNotification), unreadCount: res.unread }));
    } catch {
      /* тихо — колокол не критичен */
    }
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const { count } = await notificationsApi.unreadCount();
      setData((prev) => (prev.unreadCount === count ? prev : { ...prev, unreadCount: count }));
    } catch {
      /* тихо */
    }
  }, []);

  const markNotificationsRead = useCallback((ids?: string[]) => {
    void (async () => {
      try {
        await notificationsApi.markRead(ids);
        setData((prev) => {
          const set = ids && ids.length ? new Set(ids) : null;
          const notifications = prev.notifications.map((n) => (!set || set.has(n.id) ? { ...n, read: true } : n));
          // Уменьшаем на число реально непрочитанных из списка, а не на ids.length
          // (устойчиво к вызову с уже прочитанными id — review PR #19).
          const cleared = set ? prev.notifications.filter((n) => set.has(n.id) && !n.read).length : prev.unreadCount;
          const unreadCount = Math.max(0, prev.unreadCount - cleared);
          return { ...prev, notifications, unreadCount };
        });
      } catch (err) {
        handleApiError(err);
      }
    })();
  }, [handleApiError]);

  const setNotifyPrefs = useCallback(
    (patch: NotifyPrefs) => {
      void (async () => {
        try {
          const { notifyPrefs } = await notificationsApi.setPrefs(patch);
          setData((prev) => ({ ...prev, notifyPrefs: notifyPrefs as NotifyPrefsT }));
          toast("success", "Настройки уведомлений сохранены");
        } catch (err) {
          handleApiError(err, "Не удалось сохранить настройки");
        }
      })();
    },
    [toast, handleApiError],
  );

  const bootstrap = useCallback(async () => {
    if (!getToken()) {
      setBootStatus("unauthenticated");
      return;
    }
    setBootStatus("loading");
    try {
      const user = await authApi.me();
      const [list, deps, collabs, cfg] = await Promise.all([
        projectsApi.list(),
        departmentsApi.list().catch(() => []),
        issuesApi.collaborating().catch(() => [] as CollaboratingItem[]),
        authApi.config().catch(() => ({ authMode: "local" as const })),
      ]);
      setAuthMode(cfg.authMode);
      const projects: ProjectSummary[] = list.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        departmentId: p.departmentId,
        isShared: p.isShared,
      }));
      if (projects.length === 0) {
        // Ни одного видимого проекта, но, возможно, приглашён к отдельным задачам
        // (issue collaborators) — тогда одиночный режим (COLLAB_MIGRATION.md Фаза 6).
        if (collabs.length > 0) {
          const hash = readIssueHash();
          const openTarget = hash && collabs.some((c) => c.issueId === hash.issueId) ? hash : null;
          setSolo({ userId: user.id, userName: user.name, items: collabs, openTarget });
          setBootStatus("solo");
          return;
        }
        // users: [me] — иначе me-memo не найдёт currentUserId и свалится на
        // синтетического 'member'/'viewer' (глоб. admin потерял бы доступ к
        // AdminView, откуда только и можно создать первый проект).
        setData({ ...emptyData(), currentUserId: user.id, departments: deps, users: [mapUser(user, {})] });
        if (user.globalRole === "admin") {
          setUi((u) => ({ ...u, view: "admin" }));
          toast("info", "Проектов пока нет — создайте первый в разделе «Департаменты»");
        } else {
          toast("info", "Вам пока не открыт ни один проект — обратитесь к администратору");
        }
        setBootStatus("ready");
        return;
      }
      const hash = readIssueHash();
      const hashProjectVisible = !!hash && projects.some((p) => p.id === hash.projectId);
      // Прямая ссылка на приглашённую задачу (проект пользователю не открыт) —
      // ведёт в «Мои подключения», а не на главный экран (ниже по ветке ready).
      const hashIsCollab = !!hash && collabs.some((c) => c.issueId === hash.issueId);

      // ≥ 2 проектов и это НЕ переход по прямой ссылке на задачу → главный экран
      // (UI_RESTRUCTURE.md D4): список проектов и задач, в проект не входим.
      // При 1 проекте главный экран бессмыслен — сразу внутрь (ветка ниже).
      if (projects.length >= 2 && !hashProjectVisible && !hashIsCollab) {
        const assigned = await issuesApi.assignedToMe().catch(() => [] as AssignedIssue[]);
        setData({
          ...emptyData(),
          currentUserId: user.id,
          users: [mapUser(user, {})],
          departments: deps,
          projects,
          collaborations: collabs,
          assignedToMe: assigned as AssignedIssue[],
          notifyPrefs: user.notifyPrefs ?? {},
        });
        void refreshNotifications();
        if (takeHomeIntro()) {
          toast(
            "info",
            "Теперь при входе — список ваших проектов и задач. Открыть проект напрямую можно здесь.",
          );
        }
        setBootStatus("home");
        return;
      }

      const wanted = readLastProject();
      const chosen = hashProjectVisible ? hash!.projectId : projects.find((p) => p.id === wanted)?.id ?? projects[0].id;
      const next = await buildProjectData(chosen, user.id, projects, deps, collabs);
      setData({ ...next, notifyPrefs: user.notifyPrefs ?? {} });
      void refreshNotifications();
      writeLastProject(chosen);
      // Прямая ссылка на приглашённую задачу (в проекте, который не открыт) —
      // сразу в раздел «Мои подключения» (Фаза 6 для пользователей с проектами).
      if (hashIsCollab) {
        setUi((u) => ({ ...u, view: "collaborating" }));
      }
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
  }, [handleApiError, buildProjectData, toast, refreshNotifications]);

  const switchSeqRef = useRef(0);
  const switchProject = useCallback(
    (projectId: string) => {
      const cur = dataRef.current;
      if (projectId === cur.currentProjectId || !cur.projects.some((p) => p.id === projectId)) return;
      const seq = ++switchSeqRef.current;
      setBootStatus("loading");
      void (async () => {
        try {
          const next = await buildProjectData(projectId, cur.currentUserId, cur.projects, cur.departments, cur.collaborations);
          if (seq !== switchSeqRef.current) return; // пришёл более поздний клик
          setData(next);
          writeLastProject(projectId);
          setUi((u) => ({ ...u, selectedIssueId: null }));
          setBootStatus("ready");
        } catch (err) {
          if (seq !== switchSeqRef.current) return;
          handleApiError(err, "Не удалось открыть проект");
          setBootStatus("ready");
        }
      })();
    },
    [buildProjectData, handleApiError],
  );

  const refreshAssignedToMe = useCallback(async () => {
    try {
      const items = await issuesApi.assignedToMe();
      setData((prev) => ({ ...prev, assignedToMe: items as AssignedIssue[] }));
    } catch {
      /* тихо — блок «Мои задачи» просто не обновится */
    }
  }, []);

  /** Вернуться на главный экран из проекта (UI_RESTRUCTURE.md D4). Проект не
   *  выгружаем — `<HomeView>` показывается поверх; данные «Моих задач» освежаем. */
  const goHome = useCallback(() => {
    setUi((u) => ({ ...u, selectedIssueId: null, createOpen: false }));
    setBootStatus("home");
    void refreshAssignedToMe();
    void refreshNotifications();
  }, [refreshAssignedToMe, refreshNotifications]);

  /** Войти в проект с главного экрана. Тот же проект (уже загружен) — просто
   *  уходим с `<HomeView>`; другой — полноценное переключение. */
  const enterProject = useCallback(
    (projectId: string) => {
      const cur = dataRef.current;
      if (!cur.projects.some((p) => p.id === projectId)) return;
      if (projectId === cur.currentProjectId) {
        setBootStatus("ready");
      } else {
        switchProject(projectId);
      }
    },
    [switchProject],
  );

  const logout = useCallback(() => {
    clearToken();
    setData(emptyData());
    setSolo(null);
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

  /** Перечитать «Мои подключения» (приглашения к задачам чужих проектов). */
  const refreshCollaborations = useCallback(async () => {
    try {
      const items = await issuesApi.collaborating();
      setData((prev) => ({ ...prev, collaborations: items }));
    } catch {
      /* тихо — раздел просто не обновится */
    }
  }, []);

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

  /** Прямая ссылка #/issue/<projectId>/<issueId> в обычном интерфейсе: если задача
   *  в видимом проекте — открыть её (при необходимости переключив проект). Ссылки
   *  на приглашённые задачи ведёт CollaboratingView/SoloView (taskira-review §1.5). */
  useEffect(() => {
    if (bootStatus !== "ready") return;
    const h = readIssueHash();
    if (!h) return;
    const cur = dataRef.current;
    if (cur.collaborations.some((c) => c.issueId === h.issueId)) return; // раздел «Мои подключения»
    const clearHash = () => history.replaceState(null, "", location.pathname + location.search);
    if (h.projectId === cur.currentProjectId) {
      if (cur.issues.some((i) => i.id === h.issueId)) openIssue(h.issueId);
      clearHash();
    } else if (cur.projects.some((p) => p.id === h.projectId)) {
      switchProject(h.projectId); // после переключения эффект повторится и откроет задачу
    } else {
      clearHash(); // проект недоступен — молча снимаем хэш
    }
  }, [bootStatus, openIssue, switchProject]);

  /* Polling счётчика непрочитанных: раз в 30 c + при возврате фокуса на вкладку.
   *  Полная лента подтягивается при открытии колокола (Bell). */
  useEffect(() => {
    if (bootStatus !== "ready") return;
    const tick = () => {
      if (document.visibilityState === "visible") void refreshUnreadCount();
    };
    const id = window.setInterval(tick, 30_000);
    window.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [bootStatus, refreshUnreadCount]);

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

  /* -------- приглашённые участники задачи (issue collaborators) -------- */

  const patchIssueCollaborators = (issueId: string, fn: (list: Collaborator[]) => Collaborator[]) =>
    setData((prev) => ({
      ...prev,
      issues: prev.issues.map((i) => (i.id === issueId ? { ...i, collaborators: fn(i.collaborators) } : i)),
    }));

  const addCollaborator = useCallback(
    (issueId: string, userId: string) => {
      const issue = dataRef.current.issues.find((i) => i.id === issueId);
      if (!requirePerm("manageCollaborators", issue)) return;
      void (async () => {
        try {
          const c = await collaboratorsApi.add(pid(), issueId, userId);
          patchIssueCollaborators(issueId, (list) => [
            ...list.filter((x) => x.userId !== c.userId),
            { userId: c.userId, name: c.name, initials: c.initials, color: c.color, jobRole: c.jobRole },
          ]);
          toast("success", `${c.name} — приглашён(а) к задаче`);
        } catch (err) {
          handleApiError(err, "Не удалось пригласить участника");
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const removeCollaborator = useCallback(
    (issueId: string, userId: string) => {
      const issue = dataRef.current.issues.find((i) => i.id === issueId);
      if (!requirePerm("manageCollaborators", issue)) return;
      void (async () => {
        try {
          await collaboratorsApi.remove(pid(), issueId, userId);
          patchIssueCollaborators(issueId, (list) => list.filter((x) => x.userId !== userId));
          toast("info", "Участник отключён от задачи");
        } catch (err) {
          handleApiError(err, "Не удалось отключить участника");
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  /* -------- вложения (attachments, миграция 010) -------- */

  const patchIssueAttachments = (issueId: string, fn: (list: Attachment[]) => Attachment[]) =>
    setData((prev) => ({
      ...prev,
      issues: prev.issues.map((i) => (i.id === issueId ? { ...i, attachments: fn(i.attachments) } : i)),
    }));

  const uploadAttachment = useCallback(
    (issueId: string, file: File) => {
      const issue = dataRef.current.issues.find((i) => i.id === issueId);
      if (!requirePerm("comment", issue)) return; // сервер перепроверит
      // UX-подсказки, чтобы не гонять заведомо плохой файл на сервер. Сервер —
      // источник правды (config.blockExt + magic-байты); этот список НЕ
      // исчерпывающий, держим примерно в ногу с DEFAULT_BLOCK_EXT.
      if (file.size > LIMITS.attachment.maxBytes) {
        return toast("error", `Файл больше ${Math.round(LIMITS.attachment.maxBytes / 1024 / 1024)} МБ`);
      }
      if (
        /\.(exe|dll|scr|com|pif|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|cpl|reg|lnk|sh|bash|zsh|ksh|run|bin|jar|apk|app|dmg|pkg|deb|rpm|elf|so|dylib|gadget|inf)$/i.test(
          file.name,
        )
      ) {
        return toast("error", "Такой тип файла загружать нельзя (исполняемый/скрипт)");
      }
      void (async () => {
        try {
          const a = await attachmentsApi.upload(pid(), issueId, file);
          patchIssueAttachments(issueId, (list) => [...list.filter((x) => x.id !== a.id), mapAttachment(a)]);
          toast("success", `${a.filename} — прикреплён`);
        } catch (err) {
          handleApiError(err, "Не удалось загрузить файл");
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const removeAttachment = useCallback(
    (issueId: string, attId: string) => {
      // Правило D2 (свой файл всегда / чужой — по delete) проверяет сервер;
      // компонент прячет «×», когда нельзя.
      void (async () => {
        try {
          await attachmentsApi.remove(pid(), issueId, attId);
          patchIssueAttachments(issueId, (list) => list.filter((a) => a.id !== attId));
          toast("info", "Вложение удалено");
        } catch (err) {
          handleApiError(err, "Не удалось удалить вложение");
        }
      })();
    },
    [toast, handleApiError],
  );

  const downloadAttachment = useCallback(
    (issueId: string, att: { id: string; filename: string }) => {
      void attachmentsApi
        .download(pid(), issueId, att.id, att.filename)
        .catch((err) => handleApiError(err, "Не удалось скачать файл"));
    },
    [handleApiError],
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
            statuses: boot.workflow.statuses.map((s) => ({ id: s.id, sid: s.sid, name: s.name, category: s.category })),
            transitions: boot.workflow.transitions.map((t) => ({ id: t.id, from: t.from, to: t.to })),
          },
        }));
        toast("info", "Схема восстановлена");
      } catch (err) {
        handleApiError(err);
      }
    })();
  }, [requirePerm, toast, handleApiError]);

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

  /** Пересобрать состав + профили ОТКРЫТОГО проекта из bootstrap. Оптимистичного
   *  патча data.members мало: только что добавленный участник отсутствует в
   *  data.users (bootstrap-состав = «участники ∪ глоб. админы»), из-за чего в
   *  PermissionsView он рендерится сырым UUID, а в пикере исполнителя его нет. */
  const syncCurrentMembers = useCallback(async (projectId: string) => {
    const boot = await projectsApi.get(projectId);
    const members: Record<string, ProjectRole> = {};
    for (const m of boot.members) members[m.userId] = m.role;
    setData((prev) =>
      prev.currentProjectId === projectId
        ? { ...prev, members, users: boot.users.map((u) => mapUser(u, members)) }
        : prev,
    );
  }, []);

  /** Изменить/добавить участника ЛЮБОГО проекта (не только текущего) — из AdminView.
   *  Сервер разрешает это глобальному admin для любого проекта. Если правится
   *  открытый проект — ресинк data.members + data.users, чтобы me/PermissionsView/
   *  пикер исполнителя не отстали. */
  const setProjectMember = useCallback(
    async (projectId: string, userId: string, role: ProjectRole): Promise<void> => {
      if (!requirePerm("manageAccess")) return;
      try {
        await membersApi.set(projectId, userId, role);
        if (projectId === dataRef.current.currentProjectId) await syncCurrentMembers(projectId);
        toast("success", "Роль участника обновлена");
      } catch (err) {
        handleApiError(err, "Не удалось изменить участника проекта");
        throw err;
      }
    },
    [requirePerm, toast, handleApiError, syncCurrentMembers],
  );

  const removeProjectMember = useCallback(
    async (projectId: string, userId: string): Promise<void> => {
      if (!requirePerm("manageAccess")) return;
      try {
        await membersApi.remove(projectId, userId);
        if (projectId === dataRef.current.currentProjectId) await syncCurrentMembers(projectId);
        toast("info", "Участник удалён из проекта");
      } catch (err) {
        handleApiError(err, "Не удалось удалить участника проекта");
        throw err;
      }
    },
    [requirePerm, toast, handleApiError, syncCurrentMembers],
  );

  /* -------- админ: департаменты и проекты (manageAccess = глобальный admin) -------- */

  /** Перезагрузка списков проектов и департаментов после мутаций оргструктуры. */
  const refreshOrg = useCallback(async () => {
    const [list, deps] = await Promise.all([projectsApi.list(), departmentsApi.list().catch(() => [])]);
    setData((prev) => ({
      ...prev,
      projects: list.map((p) => ({ id: p.id, key: p.key, name: p.name, departmentId: p.departmentId, isShared: p.isShared })),
      departments: deps,
    }));
  }, []);

  const createDepartment = useCallback(
    (name: string) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          await departmentsApi.create(name);
          await refreshOrg();
          toast("success", `Отдел «${name}» создан`);
        } catch (err) {
          handleApiError(err, "Не удалось создать отдел");
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshOrg],
  );

  const renameDepartment = useCallback(
    (id: string, name: string) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          await departmentsApi.patch(id, { name });
          await refreshOrg();
        } catch (err) {
          handleApiError(err, "Не удалось переименовать отдел");
        }
      })();
    },
    [requirePerm, handleApiError, refreshOrg],
  );

  /** Привязать/очистить LDAP-группу отдела (только AUTH_MODE=ldap). */
  const setDepartmentLdapGroup = useCallback(
    (id: string, ldapGroupDn: string | null) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          await departmentsApi.patch(id, { ldapGroupDn });
          await refreshOrg();
          toast("success", ldapGroupDn ? "LDAP-группа привязана" : "Привязка LDAP-группы снята");
        } catch (err) {
          handleApiError(err, "Не удалось сохранить LDAP-группу");
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshOrg],
  );

  /** Ручной ресинк членства в департаментах из LDAP (до фонового воркера). */
  const resyncLdap = useCallback(() => {
    if (!requirePerm("manageAccess")) return;
    void (async () => {
      try {
        const r = await ldapApi.resync();
        const tail =
          (r.notFound.length ? ` · не найдено в LDAP: ${r.notFound.length}` : "") +
          (r.errors.length ? ` · ошибок: ${r.errors.length}` : "");
        toast(r.errors.length ? "error" : "success", `Ресинк: ${r.synced}/${r.total}${tail}`);
      } catch (err) {
        handleApiError(err, "Ресинк LDAP не удался");
      }
    })();
  }, [requirePerm, toast, handleApiError]);

  const deleteDepartment = useCallback(
    (id: string) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          await departmentsApi.remove(id);
          await refreshOrg();
          toast("info", "Отдел удалён");
        } catch (err) {
          handleApiError(err, "Не удалось удалить отдел");
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshOrg],
  );

  const createProject = useCallback(
    (input: { key: string; name: string; departmentId: string; isShared?: boolean }) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          const p = await projectsApi.create(input);
          await refreshOrg();
          toast("success", `Проект ${p.key} создан`);
        } catch (err) {
          handleApiError(err, "Не удалось создать проект");
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshOrg],
  );

  const patchProject = useCallback(
    (id: string, patch: { name?: string; description?: string; departmentId?: string; isShared?: boolean }) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          await projectsApi.patch(id, patch);
          await refreshOrg();
          // открытый проект: патчим все переданные поля (name/description/isShared/…),
          // иначе шапка/бейдж покажут устаревшее до следующего switchProject/bootstrap
          if (id === dataRef.current.currentProjectId) {
            setData((prev) => ({ ...prev, project: { ...prev.project, ...patch } }));
          }
        } catch (err) {
          handleApiError(err, "Не удалось изменить проект");
        }
      })();
    },
    [requirePerm, handleApiError, refreshOrg],
  );

  const deleteProject = useCallback(
    (id: string) => {
      if (!requirePerm("manageAccess")) return;
      const wasCurrent = id === dataRef.current.currentProjectId;
      void (async () => {
        try {
          await projectsApi.remove(id);
          toast("info", "Проект удалён");
          if (wasCurrent) {
            if (readLastProject() === id) writeLastProject("");
            await bootstrap();
          } else {
            await refreshOrg();
          }
        } catch (err) {
          handleApiError(err, "Не удалось удалить проект");
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshOrg, bootstrap],
  );


  const api: Api = {
    data,
    me,
    ui,
    toasts,
    bootStatus,
    solo,
    can: canFn,
    bootstrap,
    switchProject,
    goHome,
    enterProject,
    refreshCollaborations,
    refreshNotifications,
    markNotificationsRead,
    setNotifyPrefs,
    logout,
    setView: (v) => setUi((u) => ({ ...u, view: v })),
    openIssue,
    setCreateOpen: (v) => setUi((u) => ({ ...u, createOpen: v })),
    toast,
    createIssue,
    updateIssue,
    moveStatus,
    addComment,
    addCollaborator,
    removeCollaborator,
    uploadAttachment,
    removeAttachment,
    downloadAttachment,
    deleteIssue,
    addTransition,
    removeTransition,
    resetWorkflow,
    setMemberRole,
    removeMember,
    setProjectMember,
    removeProjectMember,
    createDepartment,
    renameDepartment,
    authMode,
    setDepartmentLdapGroup,
    resyncLdap,
    deleteDepartment,
    createProject,
    patchProject,
    deleteProject,
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStore(): Api {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore вне StoreProvider");
  return ctx;
}
