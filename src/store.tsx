import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  AccessRole,
  AssignedIssue,
  Attachment,
  ChecklistItem,
  Collaboration,
  Collaborator,
  ComplexityId,
  CustomFieldType,
  Data,
  Department,
  Issue,
  IssueLink,
  IssueTemplate,
  NotificationT,
  NotifyPrefsT,
  IssueTypeId,
  PriorityId,
  ProjectRole,
  ProjectSummary,
  SearchResultItem,
  Sprint,
  Status,
  Toast,
  User,
  ViewId,
  Workflow,
} from "./types";
import { can as canDo, denialReason, resolveRole, type PermId } from "./permissions";
import { useOptionalT } from "./i18n";
import {
  LIMITS,
  sanitizeText,
  validateChecklistItemText,
  localizeValidationError,
  validateComment,
  validateDescription,
  validateLabels,
  validateTitle,
} from "./validation";
import {
  ApiError,
  API_BASE,
  attachmentsApi,
  authApi,
  avatarApi,
  clearToken,
  collaboratorsApi,
  issueTemplatesApi,
  customFieldsApi,
  ldapApi,
  commentsApi,
  departmentsApi,
  getToken,
  invalidateAvatarBlobUrl,
  issuesApi,
  membersApi,
  notificationsApi,
  projectsApi,
  sprintsApi,
  type CollaboratingItem,
  type IssueTemplateInput,
  type NotifyPrefs,
  type ServerAttachment,
  type ServerChecklistItem,
  type ServerIssueLink,
  type ServerIssueTemplate,
  type ServerNotification,
  type ServerIssue,
  type ServerSprint,
  type SafeUser,
  workflowApi,
} from "./api";

export const canTransition = (wf: Workflow, from: string, to: string) =>
  from === to || wf.transitions.some((t) => t.from === from && t.to === to);

export const statusById = (wf: Workflow, id: string) => wf.statuses.find((s) => s.id === id);

/** Кого можно назначить исполнителем: участники проекта, плюс — для уже
 *  созданной задачи — уже назначенные исполнители, даже если их с тех пор
 *  вывели из проекта (иначе они пропали бы из списка молча). Сервер применяет
 *  то же правило членства при создании/патче issue. */
export const assignableUsers = (data: Pick<Data, "users" | "members">, currentAssigneeIds: string[] = []) =>
  data.users.filter((u) => u.id in data.members || currentAssigneeIds.includes(u.id));

export const relTime = (ts: number, lang: "ru" | "en" = "ru") => {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 6e4);
  if (m < 1) return lang === "ru" ? "только что" : "just now";
  if (m < 60) return lang === "ru" ? `${m} мин назад` : `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return lang === "ru" ? `${h} ч назад` : `${h} hr ago`;
  const dN = Math.floor(h / 24);
  if (dN === 1) return lang === "ru" ? "вчера" : "yesterday";
  if (dN < 7) return lang === "ru" ? `${dN} дн назад` : `${dN} days ago`;
  return new Date(ts).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "short" });
};

export const fmtDate = (iso: string, lang: "ru" | "en" = "ru") =>
  new Date(iso + "T00:00:00").toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "short" });

/** Общая логика markNotificationsRead/dismissNotifications: без `ids` действие
 *  применяется ко ВСЕМ уведомлениям пользователя на сервере (не только к
 *  загруженной странице, лента не пагинирует дальше limit=20) — поэтому
 *  непрочитанных в этом случае считаем как prev.unreadCount целиком, а не по
 *  (неполному) списку в памяти. С `ids` — считаем реально непрочитанные среди
 *  них, устойчиво к вызову с уже прочитанными id (review PR #19, PR #30). */
export const applyNotificationAction = (prev: Data, ids: string[] | undefined, mode: "read" | "dismiss"): Data => {
  const set = ids && ids.length ? new Set(ids) : null;
  let cleared = 0;
  const notifications = prev.notifications.reduce<NotificationT[]>((acc, n) => {
    if (set && !set.has(n.id)) { acc.push(n); return acc; }
    if (!n.read) cleared++;
    if (mode === "read") acc.push({ ...n, read: true });
    return acc;
  }, []);
  const unreadCount = Math.max(0, prev.unreadCount - (set ? cleared : prev.unreadCount));
  return { ...prev, notifications, unreadCount };
};

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
  /** Родитель для «+ добавить подзадачу» (миграция 021) — CreateIssueModal
   *  предзаполняет им поле и делает его нередактируемым. null — обычное
   *  создание. Сбрасывается setCreateOpen(true); ставится только
   *  openCreateSubtask(). */
  createParentId: string | null;
  lastEvent: { issueId: string; ts: number } | null;
}

export interface CreateInput {
  title: string;
  description: string;
  typeId: IssueTypeId;
  priorityId: PriorityId;
  assigneeIds: string[];
  epicId: string | null;
  /** Родитель-подзадачи (миграция 021) — задаётся кнопкой «+ подзадача». */
  parentId?: string | null;
  labels: string[];
  complexity: ComplexityId | null;
  statusId?: string;
  dueDate?: string | null;
  checklistItems?: string[];
}

type CreateIssuePayload = {
  title: string;
  description: string;
  typeId: IssueTypeId;
  priorityId: PriorityId;
  assigneeIds: string[];
  epicId: string | null;
  parentId: string | null;
  labels: string[];
  complexity: ComplexityId | null;
  statusId?: string;
  dueDate: string | null;
  checklistItems: string[];
};

/** Общие для createIssue() и importIssues() валидация + сборка тела
 *  POST /issues — раньше были независимо продублированы в обеих функциях, и
 *  уже успели разойтись (importIssues объединил три проверки в один
 *  if(t.ok && d.ok && l.ok) без пер-полевого тоста createIssue). Будущее
 *  изменение формы запроса теперь применяется один раз, а не в двух местах
 *  (тот же класс риска, что CLAUDE.md описывает для зеркала
 *  permissions.ts/validation.ts — здесь просто в рамках одного файла;
 *  ревью PR #48). */
function buildCreatePayload(input: CreateInput): { ok: true; body: CreateIssuePayload } | { ok: false; error: string } {
  const t = validateTitle(input.title);
  if (!t.ok) return { ok: false, error: t.error };
  const d = validateDescription(input.description);
  if (!d.ok) return { ok: false, error: d.error };
  const l = validateLabels(input.labels);
  if (!l.ok) return { ok: false, error: l.error };
  return {
    ok: true,
    body: {
      title: t.value,
      description: d.value,
      typeId: input.typeId,
      priorityId: input.priorityId,
      assigneeIds: input.assigneeIds,
      epicId: input.epicId,
      parentId: input.parentId ?? null,
      labels: l.value,
      complexity: input.complexity,
      statusId: input.statusId,
      dueDate: input.dueDate ?? null,
      checklistItems: input.checklistItems ?? [],
    },
  };
}

/** Сколько задач клиент тянет за раз. Серверный потолок — 200; держим их
 *  в одной константе, чтобы «сколько загружено» и «сколько всего» не разъезжались. */
const ISSUES_PAGE = 200;

/** Клиентские доска/бэклог/таймлайн фильтруют локально, поэтому им нужен весь
 * активный набор, а не молча первые 200 строк. Сервер всё равно ограничивает
 * один ответ; дочитываем страницы последовательно, не создавая всплеск запросов. */
async function listAllIssues(projectId: string): Promise<{ items: ServerIssue[]; total: number }> {
  let page = await issuesApi.list(projectId, { limit: ISSUES_PAGE });
  const items = [...page.items];
  while (page.nextCursor) {
    // Курсор — эфемерное состояние обхода. В URL/localStorage он намеренно не
    // попадает: сохранённая ссылка описывает фильтр, а не позицию в выдаче.
    page = await issuesApi.list(projectId, { limit: ISSUES_PAGE, cursor: page.nextCursor });
    if (page.items.length === 0) break;
    items.push(...page.items);
  }
  return { items, total: items.length };
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
  favoriteProjectIds: [],
  departments: [],
  currentProjectId: "",
  users: [],
  members: {},
  currentUserId: "",
  issues: [],
  workflow: { statuses: [], transitions: [] },
  issueTemplates: [],
  customFields: [],
  sprints: [],
  assignedToMe: [],
  assignedTruncated: false,
  issuesTruncated: false,
  issuesTotal: 0,
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
    phone: u.phone,
    globalRole: u.globalRole,
    // Реальная эффективная роль в текущем проекте (globalRole + членство).
    // Не-участник и не admin ресурса → роли нет: фолбэк 'viewer' (минимум прав).
    // Для `me` store дополнительно пересчитывает её в memo при изменении data.members.
    accessRole: resolveRole(u.globalRole, members[u.id]) ?? "viewer",
    username: u.username,
    avatarUpdatedAt: u.avatarUpdatedAt,
  };
}

function normalizeType(t: string): IssueTypeId {
  if (t === "bug" || t === "request" || t === "task") return t;
  return "task";
}

const mapIssueTemplate = (t: ServerIssueTemplate): IssueTemplate => ({
  id: t.id,
  name: t.name,
  typeId: normalizeType(t.typeId),
  priorityId: (t.priorityId as PriorityId) || "medium",
  title: t.title,
  description: t.description,
  statusId: t.statusId,
  position: t.position,
});

const mapSprint = (s: ServerSprint): Sprint => ({
  id: s.id,
  name: s.name,
  goal: s.goal,
  status: s.status,
  startDate: s.startDate,
  endDate: s.endDate,
});

const mapAttachment = (a: ServerAttachment): Attachment => ({
  id: a.id,
  filename: a.filename,
  contentType: a.contentType,
  byteSize: a.byteSize,
  uploadedById: a.uploadedById,
  createdAt: Date.parse(a.createdAt) || Date.now(),
});

const mapChecklistItem = (c: ServerChecklistItem): ChecklistItem => ({
  id: c.id,
  text: c.text,
  done: c.done,
  position: c.position,
  createdAt: Date.parse(c.createdAt) || Date.now(),
});

const mapIssueLink = (l: ServerIssueLink): IssueLink => ({
  id: l.id,
  dir: l.dir,
  issue: {
    id: l.issue.id,
    key: l.issue.key,
    title: l.issue.title,
    typeId: normalizeType(l.issue.typeId),
    statusId: l.issue.statusId,
    statusCategory: (l.issue.statusCategory as "todo" | "inprogress" | "done") || "todo",
  },
  createdAt: Date.parse(l.createdAt) || Date.now(),
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
    assigneeIds: dto.assigneeIds ?? [],
    reporterId: dto.reporterId,
    epicId: dto.epicId,
    parentId: dto.parentId,
    sprintId: dto.sprintId,
    labels: dto.labels ?? [],
    complexity: (dto.complexity as ComplexityId | null) ?? null,
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
    // links (связанные задачи) — только в детальном ответе GET /issues/:id.
    links: dto.links?.map(mapIssueLink) ?? prev?.links ?? [],
    // checklist — тоже только в детальном ответе GET /issues/:id.
    checklist: dto.checklist?.map(mapChecklistItem) ?? prev?.checklist ?? [],
    // customFieldValues — тоже только в детальном ответе GET /issues/:id.
    customFieldValues: dto.customFieldValues ?? prev?.customFieldValues ?? [],
    // subtasksSummary — тоже только в детальном ответе; null, пока не загружено.
    subtasksSummary: dto.subtasksSummary ?? prev?.subtasksSummary ?? null,
    createdAt: Date.parse(dto.createdAt) || Date.now(),
    updatedAt: Date.parse(dto.updatedAt) || Date.now(),
    doneAt: dto.doneAt ? Date.parse(dto.doneAt) || null : null,
    archivedAt: dto.archivedAt ? Date.parse(dto.archivedAt) || null : null,
  };
}

// Единственный вызывающий — openIssue() ниже, который уже сам подставляет
// свежие comments/activity в mapped ПОСЛЕ mapIssue() (та по умолчанию несёт
// prev?.comments/activity — верно для любого другого будущего вызывающего).
// Раньше эта функция принудительно возвращала их обратно к list[i] «для
// безопасности» и тем самым гасила именно то обновление, ради которого
// openIssue() их туда положил — вкладки «Комментарии»/«История» при
// открытии карточки всегда показывали то, что было загружено раньше (обычно
// пусто), а не то, что только что пришло с сервера. Найдено вручную при
// smoke-тесте множественных исполнителей — к самой этой задаче отношения
// не имеет, попался по пути.
function upsertIssue(list: Issue[], issue: Issue): Issue[] {
  const i = list.findIndex((x) => x.id === issue.id);
  if (i < 0) return [...list, issue];
  const next = list.slice();
  next[i] = issue;
  return next;
}

/** Точечно поправить subtasksSummary родителя в локальном кэше сразу при
 *  создании/удалении подзадачи или смене её статуса — иначе бейдж "N/M" в
 *  открытой карточке родителя виснет на значении, загруженном её последним
 *  openIssue(), пока карточку не закрыть и не переоткрыть (ревью PR #46).
 *  Нет-оп, если parentId не задан или карточка родителя ещё не загружалась
 *  (subtasksSummary===null) — тогда нечего поправлять, badge и так пересчитает
 *  себя из children при следующем openIssue(). */
function patchParentSubtasksSummary(
  issues: Issue[],
  parentId: string | null | undefined,
  delta: { total?: number; done?: number },
): Issue[] {
  if (!parentId) return issues;
  return issues.map((i) => {
    if (i.id !== parentId || !i.subtasksSummary) return i;
    return {
      ...i,
      subtasksSummary: {
        total: i.subtasksSummary.total + (delta.total ?? 0),
        done: i.subtasksSummary.done + (delta.done ?? 0),
      },
    };
  });
}

/** Индексы по id — строятся один раз на изменение данных и раздаются через
 *  контекст. Без них каждая карточка доски и строка списка линейно проходила
 *  data.users / data.issues / workflow.statuses, давая квадратичную сложность
 *  на весь экран (аудит PERF-02). */
export interface StoreIndexes {
  users: Map<string, User>;
  issues: Map<string, Issue>;
  statuses: Map<string, Status>;
  /** id статусов категории done — самый частый вопрос во всех вью. */
  doneStatusIds: Set<string>;
}

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

  const requirePerm = useCallback(
    (perm: PermId, issue?: Issue): boolean => {
      if (canDo(me, perm, issue)) return true;
      toast("error", denialReason(me, perm, issue, lang));
      return false;
    },
    [me, toast, lang],
  );

  /** Грузит данные одного проекта (bootstrap + задачи) в объект Data. */
  const buildProjectData = useCallback(
    async (
      projectId: string,
      currentUserId: string,
      projects: ProjectSummary[],
      departments: Department[],
      collaborations: Collaboration[],
      favoriteProjectIds: string[],
    ): Promise<Data> => {
      const boot = await projectsApi.get(projectId);
      const issuesRes = await listAllIssues(projectId);
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
          sprintsEnabled: boot.project.sprintsEnabled,
        },
        projects,
        favoriteProjectIds,
        departments,
        currentProjectId: projectId,
        users,
        members,
        currentUserId,
        issues: issuesRes.items.map((i) => mapIssue(i)).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
        // Сервер уже вернул честный total — сравниваем и запоминаем, что список
        // урезан. Раньше total уходил в неиспользуемое поле seq, и клиент молча
        // показывал первые N задач как будто это всё (аудит BLOCK-01).
        issuesTruncated: false,
        issuesTotal: issuesRes.total,
        assignedToMe: [],
        assignedTruncated: false,
        collaborations,
        notifications: [],
        unreadCount: 0,
        notifyPrefs: {},
        workflow: {
          statuses: boot.workflow.statuses.map((s) => ({ id: s.id, sid: s.sid, name: s.name, category: s.category })),
          transitions: boot.workflow.transitions.map((t) => ({ id: t.id, from: t.from, to: t.to })),
        },
        issueTemplates: boot.issueTemplates.map(mapIssueTemplate),
        customFields: boot.customFields,
        sprints: boot.sprints.map(mapSprint),
        seq: issuesRes.total + 1,
      };
    },
    [],
  );

  /* -------- уведомления (миграция 011) -------- */

  const refreshNotifications = useCallback(async () => {
    try {
      const [res, unread] = await Promise.all([notificationsApi.list(), notificationsApi.unreadCount()]);
      setData((prev) => ({ ...prev, notifications: res.items.map(mapNotification), unreadCount: unread.count }));
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
        setData((prev) => applyNotificationAction(prev, ids, "read"));
      } catch (err) {
        handleApiError(err);
      }
    })();
  }, [handleApiError]);

  /** Скрыть уведомления из СВОЕЙ ленты (мягко, dismissed_at на сервере) — не
   *  затрагивает чужие уведомления и аудит-след. Без ids — скрыть все свои. */
  const dismissNotifications = useCallback((ids?: string[]) => {
    void (async () => {
      try {
        await notificationsApi.dismiss(ids);
        setData((prev) => applyNotificationAction(prev, ids, "dismiss"));
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
          toast("success", local("Настройки уведомлений сохранены", "Notification settings saved"));
        } catch (err) {
          handleApiError(err, local("Не удалось сохранить настройки", "Couldn't save settings"));
        }
      })();
    },
    [toast, handleApiError],
  );

  /** Патчит avatarUpdatedAt текущего пользователя в data.users — тот же приём,
   *  что setNotifyPrefs выше, только точечно по одному полю одного User. */
  const patchMyAvatar = useCallback((avatarUpdatedAt: number | null) => {
    invalidateAvatarBlobUrl(dataRef.current.currentUserId);
    setData((prev) => ({
      ...prev,
      users: prev.users.map((u) => (u.id === prev.currentUserId ? { ...u, avatarUpdatedAt } : u)),
    }));
  }, []);

  const uploadAvatar = useCallback(
    async (file: File) => {
      try {
        const { avatarUpdatedAt } = await avatarApi.upload(file);
        patchMyAvatar(avatarUpdatedAt);
        toast("success", local("Аватарка обновлена", "Profile photo updated"));
      } catch (err) {
        handleApiError(err, local("Не удалось загрузить аватарку", "Couldn't upload the profile photo"));
      }
    },
    [toast, handleApiError, patchMyAvatar],
  );

  const removeAvatar = useCallback(async () => {
    try {
      await avatarApi.remove();
      patchMyAvatar(null);
      toast("success", local("Аватарка удалена", "Profile photo removed"));
    } catch (err) {
      handleApiError(err, local("Не удалось удалить аватарку", "Couldn't remove the profile photo"));
    }
  }, [toast, handleApiError, patchMyAvatar]);

  const bootstrap = useCallback(async () => {
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
        sprintsEnabled: p.sprintsEnabled,
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
          toast("info", local("Проектов пока нет — создайте первый в разделе «Департаменты»", "There are no projects yet — create the first one in Departments"));
        } else {
          toast("info", local("Вам пока не открыт ни один проект — обратитесь к администратору", "You don't have access to any projects yet — contact an administrator"));
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
        const assigned = await issuesApi
          .assignedToMe()
          .catch(() => ({ items: [] as AssignedIssue[], truncated: false, limit: 0 }));
        setData({
          ...emptyData(),
          currentUserId: user.id,
          users: [mapUser(user, {})],
          departments: deps,
          projects,
          favoriteProjectIds: user.favoriteProjectIds ?? [],
          collaborations: collabs,
          assignedToMe: assigned.items as AssignedIssue[],
          assignedTruncated: assigned.truncated,
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
      const next = await buildProjectData(chosen, user.id, projects, deps, collabs, user.favoriteProjectIds ?? []);
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
      handleApiError(err, local("Не удалось загрузить данные", "Couldn't load data"));
      setBootStatus("error");
    }
  }, [handleApiError, buildProjectData, toast, refreshNotifications]);

  const switchSeqRef = useRef(0);
  // Кросс-проектный переход "найти задачу → открыть её" (SearchBox): switchProject
  // ставит bootStatus в "loading", а App.tsx на это время подменяет весь Sidebar/Topbar
  // на <BootSkeleton/> — компонент поиска со своим локальным ref размонтируется и
  // отслеживание "какую задачу открыть после переключения" терялось бы вместе с ним.
  // Держим его здесь, в StoreProvider, которого этот размонт не касается.
  const pendingOpenIssueRef = useRef<{ projectId: string; issueId: string } | null>(null);
  const switchProject = useCallback(
    (projectId: string, openIssueId?: string) => {
      // Любой вызов без openIssueId — обычная навигация (ProjectSwitcher, HomeView, …),
      // которая отменяет ранее поставленное намерение "открыть задачу после переключения".
      // Без этого сброса задача из давно отменённого/перебитого поиска могла бы
      // неожиданно открыться при обычном возврате в тот же проект позже.
      pendingOpenIssueRef.current = openIssueId ? { projectId, issueId: openIssueId } : null;
      const cur = dataRef.current;
      if (projectId === cur.currentProjectId || !cur.projects.some((p) => p.id === projectId)) return;
      const seq = ++switchSeqRef.current;
      setBootStatus("loading");
      void (async () => {
        try {
          const next = await buildProjectData(
            projectId,
            cur.currentUserId,
            cur.projects,
            cur.departments,
            cur.collaborations,
            cur.favoriteProjectIds,
          );
          if (seq !== switchSeqRef.current) return; // пришёл более поздний клик
          setData(next);
          writeLastProject(projectId);
          setUi((u) => ({ ...u, selectedIssueId: null }));
          setBootStatus("ready");
        } catch (err) {
          if (seq !== switchSeqRef.current) return;
          handleApiError(err, local("Не удалось открыть проект", "Couldn't open the project"));
          setBootStatus("ready");
        }
      })();
    },
    [buildProjectData, handleApiError],
  );

  const refreshAssignedToMe = useCallback(async () => {
    try {
      const res = await issuesApi.assignedToMe();
      // Серверный DTO отдаёт typeId/priorityId строками — сужаем к юнионам клиента,
      // как это делалось и раньше для голого массива.
      setData((prev) => ({
        ...prev,
        assignedToMe: res.items as AssignedIssue[],
        assignedTruncated: res.truncated,
      }));
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
    // Сначала сообщаем серверу — он пометит выданные токены недействительными.
    // Ответа не ждём: локальный выход должен произойти в любом случае, даже
    // если сеть отвалилась. Ошибку глушим — токен всё равно уже стёрт.
    void authApi.logout().catch(() => undefined);
    clearToken();
    setData(emptyData());
    setSolo(null);
    setUi({ view: "board", selectedIssueId: null, createOpen: false, createParentId: null, lastEvent: null });
    setBootStatus("unauthenticated");
  }, []);

  const refreshIssues = useCallback(async () => {
    const requestProjectId = pid();
    try {
      const issuesRes = await listAllIssues(requestProjectId);
      setData((prev) => {
        if (prev.currentProjectId !== requestProjectId) return prev;
        const byId = new Map(prev.issues.map((i) => [i.id, i]));
        return {
          ...prev,
          issues: issuesRes.items.map((dto) => mapIssue(dto, byId.get(dto.id))),
          issuesTruncated: false,
          issuesTotal: issuesRes.total,
        };
      });
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
      const requestProjectId = pid();
      void (async () => {
        try {
          // История задачи грузится вместе с карточкой: до этого таблица activity
          // писалась, но клиент её ниоткуда не получал, и вкладка «История»
          // всегда была пуста (аудит).
          const [dto, comments, activity] = await Promise.all([
            issuesApi.get(requestProjectId, id),
            commentsApi.list(requestProjectId, id).catch(() => []),
            issuesApi.activity(requestProjectId, id).catch(() => []),
          ]);
          setData((prev) => {
            if (prev.currentProjectId !== requestProjectId) return prev;
            const mapped = mapIssue(dto, prev.issues.find((x) => x.id === id));
            mapped.comments = (comments as { id: string; authorId: string; body: string; createdAt: string }[]).map(
              (c) => ({
                id: c.id,
                authorId: c.authorId,
                body: c.body,
                ts: Date.parse(c.createdAt) || Date.now(),
              }),
            );
            mapped.activity = activity.map((a) => ({
              id: a.id,
              authorId: a.actorId,
              author: a.actor,
              text: a.text,
              ts: Date.parse(a.createdAt) || Date.now(),
            }));
            return { ...prev, issues: upsertIssue(prev.issues, mapped) };
          });
        } catch (err) {
          handleApiError(err, local("Не удалось открыть задачу", "Couldn't open the issue"));
        }
      })();
    },
    [handleApiError],
  );

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

  const createIssue = useCallback(
    (input: CreateInput) => {
      if (!requirePerm("create")) return;
      const payload = buildCreatePayload(input);
      if (!payload.ok) return toast("error", localizeValidationError(payload.error, langRef.current));
      const requestProjectId = pid();
      const requestWorkflow = dataRef.current.workflow;

      void (async () => {
        try {
          const dto = await issuesApi.create(requestProjectId, payload.body);
          const issue = mapIssue(dto);
          const isDone = statusById(requestWorkflow, issue.statusId)?.category === "done";
          setData((prev) => {
            if (prev.currentProjectId !== requestProjectId) return prev;
            return {
              ...prev,
              issues: patchParentSubtasksSummary([...prev.issues, issue], issue.parentId, {
              total: 1,
              done: isDone ? 1 : 0,
              }),
            };
          });
          // Закрывать (или нет) модалку — решение вызывающего компонента, не
          // этого коллбэка: CreateIssueModal сам решает это синхронно, ДО
          // резолва этого промиса, по чекбоксу «создать ещё одну следом».
          // Раньше createOpen:false здесь стирал это решение уже ПОСЛЕ
          // ответа сервера, так что чекбокс не мог удержать модалку открытой
          // ни при каких обстоятельствах (ревью PR #46).
          if (dataRef.current.currentProjectId === requestProjectId) {
            setUi((u) => ({ ...u, lastEvent: { issueId: issue.id, ts: Date.now() } }));
          }
          toast("success", local(`${issue.key} создана`, `${issue.key} created`));
        } catch (err) {
          handleApiError(err, local("Не удалось создать задачу", "Couldn't create the issue"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  /** Массовое создание (импорт из Trello и т.п.) — тем же POST /issues, что
   *  и обычное создание, по одному запросу на карточку: переиспользует все
   *  права/валидацию сервера как есть, без отдельного bulk-эндпоинта и его
   *  риска (untested parsing чужого формата на сервере). Один итоговый тост
   *  вместо одного на карточку — иначе импорт полусотни карточек тонет в
   *  собственных уведомлений об успехе. onProgress — необязательный колбэк
   *  для UI-прогресса импорта (например, «12 / 47»); isCancelled — необязательный
   *  колбэк, проверяемый перед каждой карточкой: закрытие/отмена модалки на
   *  клиенте не тянет за собой этот цикл автоматически (он живёт в сторе, не
   *  в компоненте), поэтому без явной проверки импорт продолжал бы тихо слать
   *  запросы в фоне после того, как пользователь решил, что отменил его
   *  (ревью PR #48). setData вызывается один раз после цикла, а не на каждую
   *  успешную карточку — иначе N карточек дают N ре-рендеров стора с O(N)
   *  копированием списка задач на каждом, то есть O(N²) суммарно (тоже
   *  ревью PR #48). */
  const importIssues = useCallback(
    async (
      inputs: CreateInput[],
      onProgress?: (done: number, total: number) => void,
      isCancelled?: () => boolean,
    ): Promise<{ ok: number; failed: number; cancelled: boolean }> => {
      if (!requirePerm("create")) return { ok: 0, failed: inputs.length, cancelled: false };
      const requestProjectId = pid();
      let ok = 0;
      let failed = 0;
      let stoppedByAuth = false;
      let stoppedByPermission = false;
      let cancelled = false;
      const created: Issue[] = [];
      // Дедуп по тексту причины — иначе один и тот же отказ на 40 карточках
      // дал бы 40 одинаковых тостов подряд; при этом каждая причина попадает
      // в консоль, а не молча тонет в агрегате "не удалось: N" — включая
      // локальные отказы валидации (buildCreatePayload), не только серверные
      // (ревью PR #48, третий раунд — раньше это правило держалось только для
      // карточек, дошедших до issuesApi.create()).
      const toastedErrors = new Set<string>();
      const reportLocalFailure = (reason: string) => {
        console.error("importIssues: карточка не прошла локальную проверку", reason);
        if (!toastedErrors.has(reason)) {
          toastedErrors.add(reason);
          toast("error", reason);
        }
      };

      for (const input of inputs) {
        if (dataRef.current.currentProjectId !== requestProjectId) {
          cancelled = true;
          break;
        }
        if (isCancelled?.()) {
          cancelled = true;
          break;
        }
        const payload = buildCreatePayload(input);
        if (payload.ok) {
          try {
            const dto = await issuesApi.create(requestProjectId, payload.body);
            created.push(mapIssue(dto));
            ok++;
          } catch (err) {
            failed++;
            console.error("importIssues: не удалось создать карточку", err);
            const isAuth = err instanceof ApiError && err.status === 401;
            // 403 — та же логика остановки, что 401: если права отозвали/сменили
            // посреди импорта (роль понижена, вывели из проекта), все оставшиеся
            // карточки упадут тем же кодом — это отказ сессии в целом, а не
            // "эта одна карточка плохая" (ревью PR #48).
            const isPerm = err instanceof ApiError && err.status === 403;
            if (isAuth) {
              handleApiError(err);
            } else if (err instanceof ApiError) {
              const errorKey = `${err.code}:${err.message}`;
              if (!toastedErrors.has(errorKey)) {
                toastedErrors.add(errorKey);
                handleApiError(err, local("Не удалось импортировать задачу", "Couldn't import the issue"));
              }
            }
            if (isAuth || isPerm) {
              stoppedByAuth = isAuth;
              stoppedByPermission = isPerm;
              failed += inputs.length - ok - failed;
              onProgress?.(inputs.length, inputs.length);
              break;
            }
          }
        } else {
          failed++;
          reportLocalFailure(localizeValidationError(payload.error, langRef.current));
        }
        onProgress?.(ok + failed, inputs.length);
      }

      // При 401 handleApiError() уже синхронно сбросил data в emptyData()
      // (сессия истекла, экран уходит на LoginForm) — сливать created поверх
      // этого сброса нельзя: итог был бы {...emptyData(), issues:[...created]},
      // форма, которую больше никто не производит и никто не читает после
      // разлогина. При 403 сессия остаётся рабочей, created применяем как
      // обычно (ревью PR #48, третий раунд).
      if (created.length > 0 && !stoppedByAuth) {
        setData((prev) =>
          prev.currentProjectId === requestProjectId ? { ...prev, issues: [...prev.issues, ...created] } : prev,
        );
      }
      if (cancelled) {
        toast("info", local(`Импорт остановлен: ${ok} из ${inputs.length} успели создаться`, `Import stopped: ${ok} of ${inputs.length} were created`));
      } else if (stoppedByPermission) {
        // Причина отказа уже показана выше (дедуп по err.message) — здесь
        // только итог по количеству, симметрично ветке cancelled: без этого
        // пользователь не видел, сколько карточек успело создаться до потери
        // доступа (ревью PR #48, третий раунд).
        toast("info", local(`Импорт остановлен: ${ok} из ${inputs.length} успели создаться — доступ отозван`, `Import stopped: ${ok} of ${inputs.length} were created — access was revoked`));
      } else if (!stoppedByAuth) {
        toast(failed === 0 ? "success" : "info", local(`Импортировано ${ok} из ${inputs.length}${failed ? `, не удалось: ${failed}` : ""}`, `Imported ${ok} of ${inputs.length}${failed ? `, failed: ${failed}` : ""}`));
      }
      return { ok, failed, cancelled };
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
        if (!r.ok) return toast("error", localizeValidationError(r.error, langRef.current));
        body.title = r.value;
      }
      if (patch.description !== undefined) body.description = sanitizeText(patch.description, LIMITS.description.max);
      if (patch.labels !== undefined) {
        const r = validateLabels(patch.labels);
        if (!r.ok) return toast("error", localizeValidationError(r.error, langRef.current));
        body.labels = r.value;
      }
      if (patch.complexity !== undefined) body.complexity = patch.complexity;
      if (patch.priorityId !== undefined) body.priorityId = patch.priorityId;
      if (patch.assigneeIds !== undefined) body.assigneeIds = patch.assigneeIds;
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
          handleApiError(err, local("Не удалось сохранить задачу", "Couldn't save the issue"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const moveStatus = useCallback(
    (issueId: string, toStatus: string, beforeId?: string | null) => {
      const iss = dataRef.current.issues.find((i) => i.id === issueId);
      if (!iss) return;
      if (!requirePerm("transition", iss)) return;
      const wf = dataRef.current.workflow;
      const requestProjectId = pid();
      if (iss.statusId !== toStatus && !canTransition(wf, iss.statusId, toStatus)) {
        const fromN = statusById(wf, iss.statusId)?.name ?? iss.statusId;
        const toN = statusById(wf, toStatus)?.name ?? toStatus;
        toast("error", local(`Переход «${fromN} → ${toN}» запрещён рабочим процессом`, `The “${fromN} → ${toN}” transition is not allowed by the workflow`));
        return;
      }
      void (async () => {
        try {
          const dto = await issuesApi.transition(requestProjectId, issueId, toStatus, beforeId);
          const wasDone = iss.doneAt != null;
          const nowDone = dto.doneAt != null;
          setData((prev) => {
            if (prev.currentProjectId !== requestProjectId) return prev;
            return {
              ...prev,
              issues: patchParentSubtasksSummary(
                prev.issues.map((i) => (i.id === issueId ? mapIssue(dto, i) : i)),
                iss.parentId,
                wasDone === nowDone ? {} : { done: nowDone ? 1 : -1 },
              ),
            };
          });
          if (dataRef.current.currentProjectId === requestProjectId) {
            setUi((u) => ({ ...u, lastEvent: { issueId, ts: Date.now() } }));
          }
        } catch (err) {
          handleApiError(err, local("Не удалось сменить статус", "Couldn't change the status"));
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
      if (!r.ok) return toast("error", localizeValidationError(r.error, langRef.current));
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
          toast("success", local("Комментарий добавлен", "Comment added"));
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
          toast("success", local(`${c.name} — приглашён(а) к задаче`, `${c.name} was invited to the issue`));
        } catch (err) {
          handleApiError(err, local("Не удалось пригласить участника", "Couldn't invite the person"));
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
          toast("info", local("Участник отключён от задачи", "Guest removed from the issue"));
        } catch (err) {
          handleApiError(err, local("Не удалось отключить участника", "Couldn't remove the guest"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  /* -------- связанные задачи (issue_links, миграция 014, §3.2) -------- */

  const setIssueLinks = (issueId: string, links: ServerIssueLink[]) =>
    setData((prev) => ({
      ...prev,
      issues: prev.issues.map((i) => (i.id === issueId ? { ...i, links: links.map(mapIssueLink) } : i)),
    }));

  const addIssueLink = useCallback(
    (issueId: string, linkedIssueId: string, type: "relates" | "blocks" | "blocked_by") => {
      const issue = dataRef.current.issues.find((i) => i.id === issueId);
      if (!requirePerm("edit", issue)) return;
      void (async () => {
        try {
          // Запрос всегда на issueId (открытая карточка); 'blocked_by' сервер
          // разворачивает сам и возвращает связи именно issueId.
          const res = await issuesApi.addLink(pid(), issueId, linkedIssueId, type);
          setIssueLinks(issueId, res.links);
          toast("success", local("Связь добавлена", "Link added"));
        } catch (err) {
          handleApiError(err, local("Не удалось связать задачи", "Couldn't link the issues"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const removeIssueLink = useCallback(
    (issueId: string, linkId: string) => {
      const issue = dataRef.current.issues.find((i) => i.id === issueId);
      if (!requirePerm("edit", issue)) return;
      void (async () => {
        try {
          const res = await issuesApi.removeLink(pid(), issueId, linkId);
          setIssueLinks(issueId, res.links);
          toast("info", local("Связь удалена", "Link removed"));
        } catch (err) {
          handleApiError(err, local("Не удалось удалить связь", "Couldn't remove the link"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  /* -------- чек-лист (checklist_items, миграция 019) -------- */

  const setChecklist = (issueId: string, checklist: ServerChecklistItem[]) =>
    setData((prev) => ({
      ...prev,
      issues: prev.issues.map((i) => (i.id === issueId ? { ...i, checklist: checklist.map(mapChecklistItem) } : i)),
    }));

  const addChecklistItem = useCallback(
    (issueId: string, text: string) => {
      const issue = dataRef.current.issues.find((i) => i.id === issueId);
      if (!requirePerm("edit", issue)) return;
      const r = validateChecklistItemText(text);
      if (!r.ok) return toast("error", localizeValidationError(r.error, langRef.current));
      void (async () => {
        try {
          const res = await issuesApi.addChecklistItem(pid(), issueId, r.value);
          setChecklist(issueId, res.checklist);
        } catch (err) {
          handleApiError(err, local("Не удалось добавить пункт чек-листа", "Couldn't add the checklist item"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const toggleChecklistItem = useCallback(
    (issueId: string, itemId: string, done: boolean) => {
      const issue = dataRef.current.issues.find((i) => i.id === issueId);
      if (!requirePerm("edit", issue)) return;
      void (async () => {
        try {
          const res = await issuesApi.patchChecklistItem(pid(), issueId, itemId, { done });
          setChecklist(issueId, res.checklist);
        } catch (err) {
          handleApiError(err, local("Не удалось обновить пункт чек-листа", "Couldn't update the checklist item"));
        }
      })();
    },
    [requirePerm, handleApiError],
  );

  const removeChecklistItem = useCallback(
    (issueId: string, itemId: string) => {
      const issue = dataRef.current.issues.find((i) => i.id === issueId);
      if (!requirePerm("edit", issue)) return;
      void (async () => {
        try {
          const res = await issuesApi.removeChecklistItem(pid(), issueId, itemId);
          setChecklist(issueId, res.checklist);
        } catch (err) {
          handleApiError(err, local("Не удалось удалить пункт чек-листа", "Couldn't delete the checklist item"));
        }
      })();
    },
    [requirePerm, handleApiError],
  );

  /* -------- значения пользовательских полей (custom_field_values, миграция 020).
     Определения полей (add/rename/remove) — ниже, у остальных editWorkflow-действий. */

  const setCustomFieldValue = useCallback(
    (issueId: string, fieldId: string, value: string | null) => {
      const issue = dataRef.current.issues.find((i) => i.id === issueId);
      if (!requirePerm("edit", issue)) return;
      void (async () => {
        try {
          const res = await issuesApi.setCustomFieldValue(pid(), issueId, fieldId, value);
          setData((prev) => ({
            ...prev,
            issues: prev.issues.map((i) => (i.id === issueId ? { ...i, customFieldValues: res.values } : i)),
          }));
        } catch (err) {
          handleApiError(err, local("Не удалось сохранить значение поля", "Couldn't save the field value"));
        }
      })();
    },
    [requirePerm, handleApiError],
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
        return toast("error", local(`Файл больше ${Math.round(LIMITS.attachment.maxBytes / 1024 / 1024)} МБ`, `The file is larger than ${Math.round(LIMITS.attachment.maxBytes / 1024 / 1024)} MB`));
      }
      if (
        /\.(exe|dll|scr|com|pif|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|cpl|reg|lnk|sh|bash|zsh|ksh|run|bin|jar|apk|app|dmg|pkg|deb|rpm|elf|so|dylib|gadget|inf)$/i.test(
          file.name,
        )
      ) {
        return toast("error", local("Такой тип файла загружать нельзя (исполняемый/скрипт)", "This file type is not allowed (executable or script)"));
      }
      void (async () => {
        try {
          const a = await attachmentsApi.upload(pid(), issueId, file);
          patchIssueAttachments(issueId, (list) => [...list.filter((x) => x.id !== a.id), mapAttachment(a)]);
          toast("success", local(`${a.filename} — прикреплён`, `${a.filename} attached`));
        } catch (err) {
          handleApiError(err, local("Не удалось загрузить файл", "Couldn't upload the file"));
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
          toast("info", local("Вложение удалено", "Attachment deleted"));
        } catch (err) {
          handleApiError(err, local("Не удалось удалить вложение", "Couldn't delete the attachment"));
        }
      })();
    },
    [toast, handleApiError],
  );

  const downloadAttachment = useCallback(
    (issueId: string, att: { id: string; filename: string }) => {
      void attachmentsApi
        .download(pid(), issueId, att.id, att.filename)
        .catch((err) => handleApiError(err, local("Не удалось скачать файл", "Couldn't download the file")));
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
            // parent_id — тот же ON DELETE SET NULL, что epic_id (миграция 021);
            // без зеркального обнуления здесь бывшие подзадачи держат в памяти
            // parentId, указывающий на только что удалённую (отфильтрованную
            // строкой выше) задачу — до перезагрузки карточки badge рендерит
            // "подзадача ?" и «+ добавить подзадачу» остаётся скрытой, хотя
            // подзадача уже стала обычной задачей (ревью PR #46).
            issues: patchParentSubtasksSummary(
              prev.issues
                .filter((i) => i.id !== issueId)
                .map((i) => (i.epicId === issueId ? { ...i, epicId: null } : i))
                .map((i) => (i.parentId === issueId ? { ...i, parentId: null } : i)),
              iss?.parentId,
              { total: -1, done: iss?.doneAt ? -1 : 0 },
            ),
          }));
          setUi((u) => ({ ...u, selectedIssueId: u.selectedIssueId === issueId ? null : u.selectedIssueId }));
          if (iss) toast("info", local(`${iss.key} удалена`, `${iss.key} deleted`));
        } catch (err) {
          handleApiError(err);
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const addTransition = useCallback(
    (from: string, to: string): string | null => {
      if (!requirePerm("editWorkflow")) return local("Нет прав", "Permission denied");
      if (from === to) return local("Статусы «из» и «в» совпадают", "The source and destination statuses are the same");
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
          toast("success", local("Переход добавлен", "Transition added"));
        } catch (err) {
          handleApiError(err);
        }
      })();
      return null;
    },
    [requirePerm, toast, handleApiError, local],
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
          toast("info", local("Переход удалён", "Transition removed"));
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
        toast("info", local("Схема восстановлена", "Workflow reset"));
      } catch (err) {
        handleApiError(err);
      }
    })();
  }, [requirePerm, toast, handleApiError]);

  /* -------- шаблоны задач (issue_templates, миграция 022). Тем же правом
     editWorkflow, что и схема workflow/custom-fields — не заводили отдельный
     PermId под ещё одну «структурную схему проекта». -------- */

  const addIssueTemplate = useCallback(
    (input: IssueTemplateInput) => {
      if (!requirePerm("editWorkflow")) return;
      void (async () => {
        try {
          const t = await issueTemplatesApi.create(pid(), input);
          setData((prev) => ({ ...prev, issueTemplates: [...prev.issueTemplates, mapIssueTemplate(t)] }));
          toast("success", local("Шаблон добавлен", "Template added"));
        } catch (err) {
          handleApiError(err, local("Не удалось добавить шаблон", "Couldn't add the template"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const updateIssueTemplateAction = useCallback(
    (templateId: string, input: IssueTemplateInput) => {
      if (!requirePerm("editWorkflow")) return;
      void (async () => {
        try {
          const t = await issueTemplatesApi.update(pid(), templateId, input);
          setData((prev) => ({
            ...prev,
            issueTemplates: prev.issueTemplates.map((x) => (x.id === templateId ? mapIssueTemplate(t) : x)),
          }));
          toast("success", local("Шаблон обновлён", "Template updated"));
        } catch (err) {
          handleApiError(err, local("Не удалось обновить шаблон", "Couldn't update the template"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const removeIssueTemplate = useCallback(
    (templateId: string) => {
      if (!requirePerm("editWorkflow")) return;
      void (async () => {
        try {
          await issueTemplatesApi.remove(pid(), templateId);
          setData((prev) => ({ ...prev, issueTemplates: prev.issueTemplates.filter((x) => x.id !== templateId) }));
          toast("info", local("Шаблон удалён", "Template deleted"));
        } catch (err) {
          handleApiError(err, local("Не удалось удалить шаблон", "Couldn't delete the template"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  /* -------- определения пользовательских полей (custom_fields, миграция 020).
     Тем же правом editWorkflow, что и схема workflow (см. миграцию/комментарий
     в customFields.ts на сервере) — отдельного PermId под них не заводили. */

  const addCustomField = useCallback(
    (name: string, fieldType: CustomFieldType, options: string[]) => {
      if (!requirePerm("editWorkflow")) return;
      const trimmed = name.trim();
      if (!trimmed) return toast("error", local("Название поля не может быть пустым", "Field name cannot be empty"));
      void (async () => {
        try {
          const field = await customFieldsApi.create(pid(), { name: trimmed, fieldType, options });
          setData((prev) => ({ ...prev, customFields: [...prev.customFields, field] }));
          toast("success", local("Поле добавлено", "Field added"));
        } catch (err) {
          handleApiError(err, local("Не удалось добавить поле", "Couldn't add the field"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const renameCustomField = useCallback(
    (fieldId: string, name: string) => {
      if (!requirePerm("editWorkflow")) return;
      const trimmed = name.trim();
      if (!trimmed) return toast("error", local("Название поля не может быть пустым", "Field name cannot be empty"));
      void (async () => {
        try {
          const field = await customFieldsApi.rename(pid(), fieldId, trimmed);
          setData((prev) => ({
            ...prev,
            customFields: prev.customFields.map((f) => (f.id === fieldId ? field : f)),
          }));
        } catch (err) {
          handleApiError(err, local("Не удалось переименовать поле", "Couldn't rename the field"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const removeCustomField = useCallback(
    (fieldId: string) => {
      if (!requirePerm("editWorkflow")) return;
      void (async () => {
        try {
          await customFieldsApi.remove(pid(), fieldId);
          setData((prev) => ({
            ...prev,
            customFields: prev.customFields.filter((f) => f.id !== fieldId),
            issues: prev.issues.map((i) => ({
              ...i,
              customFieldValues: i.customFieldValues.filter((v) => v.fieldId !== fieldId),
            })),
          }));
          toast("info", local("Поле удалено", "Field deleted"));
        } catch (err) {
          handleApiError(err, local("Не удалось удалить поле", "Couldn't delete the field"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const setMemberRole = useCallback(
    (userId: string, role: ProjectRole) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          const res = await membersApi.set(pid(), userId, role);
          setData((prev) => ({ ...prev, members: { ...prev.members, [res.userId]: res.role } }));
          toast("success", local("Роль участника обновлена", "Member role updated"));
        } catch (err) {
          handleApiError(err, local("Не удалось изменить роль участника", "Couldn't update the member role"));
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
          toast("info", local("Участник удалён из проекта", "Member removed from the project"));
        } catch (err) {
          handleApiError(err, local("Не удалось удалить участника", "Couldn't remove the member"));
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
        toast("success", local("Роль участника обновлена", "Member role updated"));
      } catch (err) {
        handleApiError(err, local("Не удалось изменить участника проекта", "Couldn't update the project member"));
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
        toast("info", local("Участник удалён из проекта", "Member removed from the project"));
      } catch (err) {
        handleApiError(err, local("Не удалось удалить участника проекта", "Couldn't remove the project member"));
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
      projects: list.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        departmentId: p.departmentId,
        isShared: p.isShared,
        sprintsEnabled: p.sprintsEnabled,
      })),
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
          toast("success", local(`Отдел «${name}» создан`, `Department “${name}” created`));
        } catch (err) {
          handleApiError(err, local("Не удалось создать отдел", "Couldn't create the department"));
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
          handleApiError(err, local("Не удалось переименовать отдел", "Couldn't rename the department"));
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
          toast("success", ldapGroupDn ? local("LDAP-группа привязана", "LDAP group linked") : local("Привязка LDAP-группы снята", "LDAP group unlinked"));
        } catch (err) {
          handleApiError(err, local("Не удалось сохранить LDAP-группу", "Couldn't save the LDAP group"));
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
        const ruTail =
          (r.notFound.length ? ` · не найдено в LDAP: ${r.notFound.length}` : "") +
          (r.errors.length ? ` · ошибок: ${r.errors.length}` : "");
        const enTail =
          (r.notFound.length ? ` · not found in LDAP: ${r.notFound.length}` : "") +
          (r.errors.length ? ` · errors: ${r.errors.length}` : "");
        toast(r.errors.length ? "error" : "success", local(`Ресинк: ${r.synced}/${r.total}${ruTail}`, `Resync: ${r.synced}/${r.total}${enTail}`));
      } catch (err) {
        handleApiError(err, local("Ресинк LDAP не удался", "LDAP resync failed"));
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
          toast("info", local("Отдел удалён", "Department deleted"));
        } catch (err) {
          handleApiError(err, local("Не удалось удалить отдел", "Couldn't delete the department"));
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshOrg],
  );

  const createProject = useCallback(
    (input: { key: string; name: string; departmentId: string; isShared?: boolean; sprintsEnabled?: boolean }) => {
      if (!requirePerm("manageAccess")) return;
      void (async () => {
        try {
          const p = await projectsApi.create(input);
          await refreshOrg();
          toast("success", local(`Проект ${p.key} создан`, `Project ${p.key} created`));
        } catch (err) {
          handleApiError(err, local("Не удалось создать проект", "Couldn't create the project"));
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshOrg],
  );

  const patchProject = useCallback(
    (
      id: string,
      patch: { name?: string; description?: string; departmentId?: string; isShared?: boolean; sprintsEnabled?: boolean },
    ) => {
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
          handleApiError(err, local("Не удалось изменить проект", "Couldn't update the project"));
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
          toast("info", local("Проект удалён", "Project deleted"));
          if (wasCurrent) {
            if (readLastProject() === id) writeLastProject("");
            await bootstrap();
          } else {
            await refreshOrg();
          }
        } catch (err) {
          handleApiError(err, local("Не удалось удалить проект", "Couldn't delete the project"));
        }
      })();
    },
    [requirePerm, toast, handleApiError, refreshOrg, bootstrap],
  );

  /* -------- спринты (миграция 023, опциональный модуль — SPRINTS_MIGRATION.md) --------
     Права manageSprints — тем же проверяет и сервер; requirePerm здесь только
     ради мгновенной UX-реакции (скрытые кнопки и т.п.), источник истины — 403. */
  const addSprint = useCallback(
    (input: { name: string; goal: string; startDate?: string | null; endDate?: string | null }) => {
      if (!requirePerm("manageSprints")) return;
      void (async () => {
        try {
          const s = await sprintsApi.create(pid(), input);
          setData((prev) => ({ ...prev, sprints: [...prev.sprints, mapSprint(s)] }));
          toast("success", local(`Спринт «${s.name}» создан`, `Sprint “${s.name}” created`));
        } catch (err) {
          handleApiError(err, local("Не удалось создать спринт", "Couldn't create the sprint"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const startSprint = useCallback(
    (sprintId: string) => {
      if (!requirePerm("manageSprints")) return;
      void (async () => {
        try {
          const s = await sprintsApi.start(pid(), sprintId);
          setData((prev) => ({ ...prev, sprints: prev.sprints.map((x) => (x.id === sprintId ? mapSprint(s) : x)) }));
          toast("success", local(`Спринт «${s.name}» начат`, `Sprint “${s.name}” started`));
        } catch (err) {
          handleApiError(err, local("Не удалось начать спринт", "Couldn't start the sprint"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const completeSprint = useCallback(
    (sprintId: string) => {
      if (!requirePerm("manageSprints")) return;
      void (async () => {
        try {
          const { sprint, movedToBacklog } = await sprintsApi.complete(pid(), sprintId);
          setData((prev) => ({
            ...prev,
            sprints: prev.sprints.map((x) => (x.id === sprintId ? mapSprint(sprint) : x)),
            // Зеркалим перенос незакрытых задач в бэклог локально (сервер уже
            // сделал это одной транзакцией в completeSprint()) — без этого
            // карточки повисли бы в UI на завершённом спринте до следующего
            // bootstrap()/openIssue(). Закрытые (doneAt≠null) сервер не трогает.
            issues: prev.issues.map((i) => (i.sprintId === sprintId && i.doneAt == null ? { ...i, sprintId: null } : i)),
          }));
          toast(
            movedToBacklog > 0 ? "info" : "success",
            local(
              `Спринт «${sprint.name}» завершён${movedToBacklog > 0 ? `, в бэклог перенесено: ${movedToBacklog}` : ""}`,
              `Sprint “${sprint.name}” completed${movedToBacklog > 0 ? `; moved to backlog: ${movedToBacklog}` : ""}`,
            ),
          );
        } catch (err) {
          handleApiError(err, local("Не удалось завершить спринт", "Couldn't complete the sprint"));
        }
      })();
    },
    [requirePerm, toast, handleApiError],
  );

  const setIssueSprint = useCallback(
    (issueId: string, sprintId: string | null) => {
      if (!requirePerm("manageSprints")) return;
      void (async () => {
        try {
          const dto = await issuesApi.setSprint(pid(), issueId, sprintId);
          setData((prev) => ({ ...prev, issues: prev.issues.map((i) => (i.id === issueId ? mapIssue(dto, i) : i)) }));
        } catch (err) {
          handleApiError(err, local("Не удалось изменить спринт задачи", "Couldn't change the issue sprint"));
        }
      })();
    },
    [requirePerm, handleApiError],
  );

  /* -------- избранные проекты (миграция 024) -------- */
  const toggleFavoriteProject = useCallback(
    (projectId: string) => {
      const isFav = dataRef.current.favoriteProjectIds.includes(projectId);
      // Оптимистично: проект уже виден в переключателе (иначе звёздочки бы не
      // было) — round-trip на toggle не должен ощущаться заметной задержкой,
      // в отличие от мутаций, где сервер реально может отказать по бизнес-правилу.
      // 403 здесь реалистичен только при потере доступа между рендером списка
      // и кликом — откатываем как обычную ошибку.
      setData((prev) => ({
        ...prev,
        favoriteProjectIds: isFav
          ? prev.favoriteProjectIds.filter((id) => id !== projectId)
          : [...prev.favoriteProjectIds, projectId],
      }));
      void (async () => {
        try {
          if (isFav) await projectsApi.unfavorite(projectId);
          else await projectsApi.favorite(projectId);
        } catch (err) {
          setData((prev) => ({
            ...prev,
            favoriteProjectIds: isFav
              ? [...prev.favoriteProjectIds, projectId]
              : prev.favoriteProjectIds.filter((id) => id !== projectId),
          }));
          handleApiError(err, local("Не удалось изменить избранное", "Couldn't update favorites"));
        }
      })();
    },
    [handleApiError],
  );

  /* -------- кросс-проектный поиск (миграция 024) -------- */
  const searchAllProjects = useCallback(
    async (q: string): Promise<{ items: SearchResultItem[]; truncated: boolean }> => {
      try {
        const res = await issuesApi.search(q);
        return { items: res.items as SearchResultItem[], truncated: res.truncated };
      } catch (err) {
        handleApiError(err, local("Не удалось выполнить поиск", "Search failed"));
        return { items: [], truncated: false };
      }
    },
    [handleApiError],
  );

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
