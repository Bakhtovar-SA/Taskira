import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  AccessRole,
  CustomFieldType,
  Data,
  Issue,
  NotifyPrefsT,
  ProjectRole,
  SearchResultItem,
  Toast,
  User,
  ViewId,
} from "./types";
import { can as canDo, denialReason, resolveRole, type PermId } from "./permissions";
import { useOptionalT } from "./i18n";
import { ApiError, API_BASE, clearToken, getToken, type IssueTemplateInput } from "./api";
import {
  applyNotificationAction,
  canTransition,
  emptyData,
  mapIssue,
  readIssueHash,
  statusById,
} from "./store/mappers";
import type { BootStatus, CreateInput, SoloState, StoreIndexes, UIState } from "./store/mappers";

import type { StoreCtx } from "./store/ctx";
import { useSprintActions } from "./store/sprints";
import { useMetaActions } from "./store/meta";
import { useOrgActions } from "./store/org";
import { useIssueSubActions } from "./store/issueSub";
import { useNotificationActions } from "./store/notifications";
import { useIssueCrudActions } from "./store/issueCrud";
import { useIssueLookup } from "./store/issueLookup";
import { useSessionActions } from "./store/session";
import { useFavoritesAndSearch } from "./store/favoritesSearch";

// Фасад: публичные имена по-прежнему берутся из "store" — компоненты и тесты не менялись (ТЗ 2.3).
export {
  canTransition,
  statusById,
  assignableUsers,
  relTime,
  fmtDate,
  applyNotificationAction,
  mapIssue,
} from "./store/mappers";
export type {
  BootStatus,
  SoloState,
  UIState,
  CreateInput,
  StoreIndexes,
} from "./store/mappers";

interface Api {
  data: Data;
  idx: StoreIndexes;
  me: User;
  ui: UIState;
  toasts: Toast[];
  bootStatus: BootStatus;
  /** Заполнено только при bootStatus === "solo" (одиночный просмотр приглашённого). */
  solo: SoloState | null;
  can: (perm: PermId, issue?: Issue) => boolean;
  bootstrap: () => Promise<void>;
  switchProject: (projectId: string, openIssueId?: string) => void;
  /** Показать главный экран (`<HomeView>`), не выгружая текущий проект. */
  goHome: () => void;
  /** Войти в проект с главного экрана (переключить, если это другой проект). */
  enterProject: (projectId: string) => void;
  refreshCollaborations: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markNotificationsRead: (ids?: string[]) => void;
  dismissNotifications: (ids?: string[]) => void;
  setNotifyPrefs: (patch: NotifyPrefsT) => void;
  /** Своя аватарка (миграция 027) — самообслуживание, без параметра userId. */
  uploadAvatar: (file: File) => Promise<void>;
  removeAvatar: () => Promise<void>;
  logout: () => void;
  setView: (v: ViewId) => void;
  openIssue: (id: string | null) => void;
  setCreateOpen: (v: boolean) => void;
  openCreateSubtask: (parentId: string) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  createIssue: (input: CreateInput) => void;
  importIssues: (
    inputs: CreateInput[],
    onProgress?: (done: number, total: number) => void,
    isCancelled?: () => boolean,
  ) => Promise<{ ok: number; failed: number; cancelled: boolean }>;
  updateIssue: (id: string, patch: Partial<Issue>) => void;
  moveStatus: (issueId: string, toStatus: string, beforeId?: string | null) => void;
  /** Растёт при изменениях, способных поменять состав или порядок наборов задач
   *  (создание, импорт, удаление, правка полей, смена статуса): по ней Список и
   *  Доска перечитываются. Не пересчитывается по массиву задач. */
  /** Загрузить все задачи проекта (только для экранов, которым нужен полный набор, — Sprints). */
  ensureAllIssues: () => Promise<void>;
  issuesRevision: number;
  /** Растёт при изменениях, влияющих на справочник направлений (заголовок, цвет, привязка, удаление). */
  epicsRevision: number;
  /** Задача по id: из известных стору, иначе точечный `GET …/issues/:id` (без тостов при ошибке). */
  lookupIssue: (id: string) => Promise<Issue | null>;
  addComment: (issueId: string, body: string) => void;
  addCollaborator: (issueId: string, userId: string) => void;
  removeCollaborator: (issueId: string, userId: string) => void;
  addIssueLink: (issueId: string, linkedIssueId: string, type: "relates" | "blocks" | "blocked_by") => void;
  removeIssueLink: (issueId: string, linkId: string) => void;
  addChecklistItem: (issueId: string, text: string) => void;
  toggleChecklistItem: (issueId: string, itemId: string, done: boolean) => void;
  removeChecklistItem: (issueId: string, itemId: string) => void;
  setCustomFieldValue: (issueId: string, fieldId: string, value: string | null) => void;
  uploadAttachment: (issueId: string, file: File) => void;
  removeAttachment: (issueId: string, attId: string) => void;
  downloadAttachment: (issueId: string, att: { id: string; filename: string }) => void;
  deleteIssue: (issueId: string) => void;
  addTransition: (from: string, to: string) => string | null;
  removeTransition: (id: string) => void;
  resetWorkflow: () => void;
  addIssueTemplate: (input: IssueTemplateInput) => void;
  updateIssueTemplateAction: (templateId: string, input: IssueTemplateInput) => void;
  removeIssueTemplate: (templateId: string) => void;
  addCustomField: (name: string, fieldType: CustomFieldType, options: string[]) => void;
  renameCustomField: (fieldId: string, name: string) => void;
  removeCustomField: (fieldId: string) => void;
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
  createProject: (input: { key: string; name: string; departmentId: string; isShared?: boolean; sprintsEnabled?: boolean }) => void;
  patchProject: (
    id: string,
    patch: { name?: string; description?: string; departmentId?: string; isShared?: boolean; sprintsEnabled?: boolean },
  ) => void;
  deleteProject: (id: string) => void;
  addSprint: (input: { name: string; goal: string; startDate?: string | null; endDate?: string | null }) => void;
  startSprint: (sprintId: string) => void;
  completeSprint: (sprintId: string) => void;
  /** sprintId=null возвращает задачу в бэклог. */
  setIssueSprint: (issueId: string, sprintId: string | null) => void;
  /** Избранные проекты (миграция 024) — toggle, а не add/remove по отдельности:
   *  вызывающему (звёздочка в переключателе) не нужно знать текущее состояние. */
  toggleFavoriteProject: (projectId: string) => void;
  /** Кросс-проектный поиск (миграция 024) — по всем видимым проектам, не
   *  только текущему. Результат не хранится в data (эфемерный, только для
   *  открытого выпадающего списка результатов), поэтому возвращается вызывающему,
   *  а не кладётся в стор, как обычные мутации. */
  searchAllProjects: (q: string) => Promise<{ items: SearchResultItem[]; truncated: boolean }>;
}

const Ctx = createContext<Api | null>(null);

let toastSeq = 1;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const lang = useOptionalT()?.lang ?? "ru";
  const langRef = useRef(lang);
  // SEC-01: эпоха сессии — растёт при logout и при сбросе сессии по 401; запросы, начатые в прошлой эпохе, не применяются.
  const sessionEpochRef = useRef(0);
  langRef.current = lang;
  const local = useCallback((ru: string, en: string) => (langRef.current === "ru" ? ru : en), []);
  const [data, setData] = useState<Data>(emptyData);
  const [bootStatus, setBootStatus] = useState<BootStatus>("idle");
  const [solo, setSolo] = useState<SoloState | null>(null);
  const [authMode, setAuthMode] = useState<"local" | "ldap">("local");
  const [ui, setUi] = useState<UIState>({
    view: "board",
    selectedIssueId: null,
    createOpen: false,
    createParentId: null,
    lastEvent: null,
  });
  const [toasts, setToasts] = useState<Toast[]>([]);

  /* Подсветка только что перемещённой карточки гаснет ПО ТАЙМЕРУ.
     Раньше Board сравнивал Date.now() прямо в рендере, но ререндер сам собой не
     случается — анимация висела до следующего постороннего обновления
     (аудит BUG-05). */
  useEffect(() => {
    if (!ui.lastEvent) return;
    const t = window.setTimeout(() => setUi((u) => (u.lastEvent ? { ...u, lastEvent: null } : u)), 1500);
    return () => window.clearTimeout(t);
  }, [ui.lastEvent]);

  const dataRef = useRef(data);
  dataRef.current = data;

  /** id текущего проекта — для вызовов /api/projects/:projectId/... */
  // Ревизия задач (PERF-06): растёт при изменениях, которые могут поменять СОСТАВ
  // или порядок наборов (создание, импорт, удаление, правка полей, смена статуса).
  // Наборы Списка и Доски перечитываются по ней. Правки, не влияющие на состав
  // (комментарий, чек-лист, вложение), её не трогают, а заполнение кэша задачами
  // (открытие карточки, resolveIssue) — тем более: иначе загрузка страницы
  // запускала бы перечитывание, а оно — новую загрузку.
  const [issuesRevision, setIssuesRevision] = useState(0);
  const bumpIssues = useCallback(() => setIssuesRevision((n) => n + 1), []);
  // Отдельный сигнал для справочника направлений: заголовок, цвет и привязка задач к
  // направлению меняются редко, а запрос `epics` дорожает с числом детей (EPIC-01), поэтому
  // перемещение карточки или правка приоритета его не перезапрашивает.
  const [epicsRevision, setEpicsRevision] = useState(0);
  const bumpEpics = useCallback(() => setEpicsRevision((n) => n + 1), []);

  const pid = () => dataRef.current.currentProjectId;

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const handleApiError = useCallback(
    (err: unknown, fallback = local("Ошибка запроса", "Request failed")) => {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          sessionEpochRef.current++;
          clearToken();
          setBootStatus("unauthenticated");
          setData(emptyData());
        }
        const englishByCode: Record<string, string> = {
          NETWORK: "Can't connect to the server",
          RATE_LIMITED: "Too many requests — try again shortly",
          INTERNAL: "Internal server error",
          UNAUTHORIZED: "Your session has expired — sign in again",
          FORBIDDEN: "You don't have permission for this action",
          NOT_FOUND: "The requested item was not found",
        };
        toast("error", langRef.current === "ru" ? err.message || fallback : englishByCode[err.code] ?? fallback);
        return;
      }
      toast("error", fallback);
    },
    [toast, local],
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

  /**
   * Задача по id для проверки прав и мутаций. Сначала — из известных стору
   * (кэш «id → задача»: то, что пользователь открыл, увидел в списке/доске или
   * создал); при промахе — точечный GET, а не молчаливый отказ. Если задача не
   * нашлась или нет доступа (удалена параллельно, права сняты) — явная ошибка
   * пользователю: правило «сотрудник правит только свои» читает assigneeIds и
   * reporterId именно из этого объекта, и тихий return выглядел бы как баг.
   */
  const requirePerm = useCallback(
    (perm: PermId, issue?: Issue): boolean => {
      if (canDo(me, perm, issue)) return true;
      toast("error", denialReason(me, perm, issue, lang));
      return false;
    },
    [me, toast, lang],
  );

  // Общий контекст доменных хуков (ТЗ 2.3): собирается один раз, после requirePerm/withIssue.
  const storeCtx: StoreCtx = { setData, dataRef, pid, toast, handleApiError, requirePerm, local, sessionEpochRef };
  const { resolveIssue, lookupIssue, withIssue } = useIssueLookup(storeCtx);
  const { refreshNotifications, refreshUnreadCount, markNotificationsRead, dismissNotifications, setNotifyPrefs, uploadAvatar,
    removeAvatar } = useNotificationActions(storeCtx);

  const { bootstrap, switchProject, goHome, enterProject, logout, refreshIssues, ensureAllIssues, refreshCollaborations,
    openIssue, pendingOpenIssueRef } = useSessionActions(storeCtx, {
    setBootStatus, setSolo, setAuthMode, setUi, bumpIssues, refreshNotifications, sessionEpochRef,
  });

  // Завершение кросс-проектного "открыть задачу из другого проекта" (см.
  // pendingOpenIssueRef выше): срабатывает, когда data.currentProjectId догоняет
  // проект задачи — то есть после того, как switchProject() выше отработал.
  useEffect(() => {
    const pending = pendingOpenIssueRef.current;
    if (pending && pending.projectId === data.currentProjectId) {
      pendingOpenIssueRef.current = null;
      openIssue(pending.issueId);
    }
  }, [data.currentProjectId, openIssue]);

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
      openIssue(h.issueId);
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

  /* WS push уведомлений (Этап 3c) — ДОПОЛНЕНИЕ к polling выше, не замена: если
   * сокет недоступен (корпоративный прокси режет upgrade, временный сбой сети),
   * 30-секундный опрос остаётся страховкой и без него всё продолжит работать.
   * Аутентификация — не через Authorization (браузерный WebSocket не умеет
   * слать свои заголовки при хендшейке): токен первым сообщением после
   * открытия, см. server/src/routes/ws.ts. */
  useEffect(() => {
    if (bootStatus !== "ready") return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let retryDelay = 1000;
    let retryTimer: number | undefined;

    const connect = () => {
      const token = getToken();
      if (stopped) return;
      const wsUrl = `${API_BASE.replace(/^http/, "ws")}/api/ws`;
      socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        // НЕ сбрасывать retryDelay здесь: открытие TCP/WS ничего не говорит о
        // том, примет ли сервер токен — auth ещё впереди. Сброс — только по
        // ответному auth_ok ниже, иначе с истёкшим/отозванным токеном бэкофф
        // никогда бы не накапливался (сервер закрывает сокет почти сразу же
        // после того же onopen, который его якобы сбросил) и свёрнутая вкладка
        // долбила бы /api/ws примерно раз в секунду бесконечно.
        // Новые браузерные сессии аутентифицируются HttpOnly-cookie прямо на
        // WS-handshake. Bearer-сообщение оставлено для старых клиентов/тестов.
        if (token) socket?.send(JSON.stringify({ type: "auth", token }));
      };
      socket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          if (msg?.type === "auth_ok") retryDelay = 1000;
          else if (msg?.type === "notify") void refreshUnreadCount();
        } catch {
          /* не наш формат сообщения — игнор */
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000); // экспоненциальный бэкофф, потолок 30 с
      };
    };
    connect();

    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [bootStatus, refreshUnreadCount]);

  const { createIssue, importIssues, updateIssue, moveStatus, deleteIssue } = useIssueCrudActions(storeCtx, {
    withIssue, resolveIssue, refreshIssues, setUi, bumpIssues, bumpEpics, langRef,
  });

  const {
    addComment, addCollaborator, removeCollaborator, addIssueLink, removeIssueLink, addChecklistItem, toggleChecklistItem,
    removeChecklistItem, setCustomFieldValue, uploadAttachment, removeAttachment, downloadAttachment,
  } = useIssueSubActions(storeCtx, { withIssue, langRef });

  // Домены, вынесенные из провайдера (ТЗ 2.3): общий контекст — в ./store/ctx.
  const { addSprint, startSprint, completeSprint, setIssueSprint } = useSprintActions(storeCtx);
  const { toggleFavoriteProject, searchAllProjects } = useFavoritesAndSearch(storeCtx);
  const { addTransition, removeTransition, resetWorkflow, addIssueTemplate, updateIssueTemplateAction, removeIssueTemplate,
    addCustomField, renameCustomField, removeCustomField } = useMetaActions(storeCtx);
  const { setMemberRole, removeMember, setProjectMember, removeProjectMember, createDepartment, renameDepartment,
    setDepartmentLdapGroup, resyncLdap, deleteDepartment, createProject, patchProject, deleteProject } =
    useOrgActions(storeCtx, { bootstrap });

  const idx = useMemo<StoreIndexes>(
    () => ({
      users: new Map(data.users.map((u) => [u.id, u])),
      issues: new Map(data.issues.map((i) => [i.id, i])),
      statuses: new Map(data.workflow.statuses.map((st) => [st.id, st])),
      doneStatusIds: new Set(data.workflow.statuses.filter((st) => st.category === "done").map((st) => st.id)),
    }),
    [data.users, data.issues, data.workflow.statuses],
  );

  const api: Api = {
    data,
    idx,
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
    dismissNotifications,
    setNotifyPrefs,
    uploadAvatar,
    removeAvatar,
    logout,
    setView: (v) => setUi((u) => ({ ...u, view: v })),
    openIssue,
    setCreateOpen: (v) => setUi((u) => ({ ...u, createOpen: v, createParentId: null })),
    openCreateSubtask: (parentId: string) => setUi((u) => ({ ...u, createOpen: true, createParentId: parentId })),
    toast,
    createIssue,
    importIssues,
    updateIssue,
    moveStatus,
    issuesRevision,
    ensureAllIssues,
    epicsRevision,
    lookupIssue,
    addComment,
    addCollaborator,
    removeCollaborator,
    addIssueLink,
    removeIssueLink,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
    setCustomFieldValue,
    uploadAttachment,
    removeAttachment,
    downloadAttachment,
    deleteIssue,
    addTransition,
    removeTransition,
    resetWorkflow,
    addIssueTemplate,
    updateIssueTemplateAction,
    removeIssueTemplate,
    addCustomField,
    renameCustomField,
    removeCustomField,
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
    addSprint,
    startSprint,
    completeSprint,
    setIssueSprint,
    toggleFavoriteProject,
    searchAllProjects,
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStore(): Api {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore вне StoreProvider");
  return ctx;
}
