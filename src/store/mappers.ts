/* Чистые функции, мапперы и типы стора (ТЗ 2.3, шаг 1): без React-состояния и хуков, ничего не читает из контекста.
 * Вынесено из store.tsx без изменений поведения; store.tsx реэкспортирует публичные имена (фасад), поэтому импорты
 * в компонентах не менялись. */
import type { Attachment, ChecklistItem, ComplexityId, Data, Issue, IssueLink, IssueTemplate, NotificationT, IssueTypeId, PriorityId, ProjectRole, Sprint, Status, User, ViewId, Workflow } from "../types";
import { resolveRole } from "../permissions";
import { validateDescription, validateLabels, validateTitle } from "../validation";
import { issuesApi, type CollaboratingItem, type ServerAttachment, type ServerChecklistItem, type ServerIssueLink, type ServerIssueTemplate, type ServerNotification, type ServerIssue, type ServerSprint, type SafeUser } from "../api";
import { parsePath } from "../router";

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
export const HOME_INTRO_KEY = "taskira.homeIntro";
export const takeHomeIntro = (): boolean => {
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
  /** Задача из прямой ссылки /p/:projectKey/issue/:issueKey (ТЗ 3.1), если была. */
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
  /** Задача, на которую вела прямая ссылка /p/:projectKey/issue/:issueKey (ТЗ 3.1), но
   *  которая оказалась приглашённой (issue collaborator), а не в открытом проекте —
   *  CollaboratingView подхватывает и сбрасывает это на маунте, чтобы выбрать именно
   *  её. Заменяет прежний точечный разбор location.hash внутри самого компонента. */
  collabOpenIssueId: string | null;
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

export type CreateIssuePayload = {
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
export function buildCreatePayload(input: CreateInput): { ok: true; body: CreateIssuePayload } | { ok: false; error: string } {
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
export const ISSUES_PAGE = 200;

/** Клиентские доска/бэклог/таймлайн фильтруют локально, поэтому им нужен весь
 * активный набор, а не молча первые 200 строк. Сервер всё равно ограничивает
 * один ответ; дочитываем страницы последовательно, не создавая всплеск запросов. */
export async function listAllIssues(projectId: string): Promise<{ items: ServerIssue[]; total: number }> {
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

export const PROJECT_KEY = "taskira.project";
export const readLastProject = (): string => {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? "";
  } catch {
    return "";
  }
};
export const writeLastProject = (id: string): void => {
  try {
    localStorage.setItem(PROJECT_KEY, id);
  } catch {
    /* noop */
  }
};

/** Итог разбора URL при загрузке/переходе (ТЗ 3.1) — заменяет прежний синхронный
 *  `readIssueHash()` (UUID-пара прямо в `#/issue/<projectId>/<issueId>`). Асинхронность —
 *  единственное структурное отличие: человекочитаемый ключ задачи в пути
 *  (`/p/:projectKey/issue/:issueKey`) требует одного обращения к серверу
 *  (`issuesApi.resolve`, см. server/src/routes/search.ts — ключ глобально уникален,
 *  поэтому проект для резолва указывать не нужно); ключ вида (`/p/:projectKey/board`)
 *  резолвится локально — `projectKey` ищется в уже загруженном списке видимых проектов,
 *  сети не требует. Ключ не найден / недоступен / путь не совпал ни с одной схемой →
 *  `null`, с тем же молчаливым фолбэком, что раньше был у «хэш есть, но не наш формат».
 *
 *  `path` передаётся явно (а не читается из `location.pathname` внутри) — резолв
 *  ключа задачи асинхронный (сетевой запрос), а useRouterSync.ts параллельно может
 *  переписать URL по другой причине, пока этот запрос летит; без явного параметра
 *  функция досчитала бы уже НЕ ту ссылку, на которую её вызвали (гонка, поймана
 *  тестом App.routerSync.test.tsx до того, как попасть в реальный деплой). */
export type BootPathTarget =
  | { kind: "issue"; projectId: string; issueId: string }
  | { kind: "view"; projectId: string; view: ViewId };

export const resolveBootPathTarget = async (
  path: string,
  projects: { id: string; key: string }[],
): Promise<BootPathTarget | null> => {
  const parsed = parsePath(path);
  if (parsed.kind === "issue") {
    try {
      const res = await issuesApi.resolve(parsed.issueKey);
      return { kind: "issue", projectId: res.projectId, issueId: res.id };
    } catch {
      return null;
    }
  }
  if (parsed.kind === "view") {
    const p = projects.find((pr) => pr.key === parsed.projectKey);
    return p ? { kind: "view", projectId: p.id, view: parsed.view } : null;
  }
  return null; // reports / root — bootstrap() сам выбирает вид по обычным правилам
};

export const emptyData = (): Data => ({
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
  issuesComplete: false,
  collaborations: [],
  notifications: [],
  unreadCount: 0,
  notifyPrefs: {},
});

export function mapNotification(dto: ServerNotification): NotificationT {
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

export function mapUser(u: SafeUser, members: Record<string, ProjectRole>): User {
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

export function normalizeType(t: string): IssueTypeId {
  if (t === "bug" || t === "request" || t === "task") return t;
  return "task";
}

export const mapIssueTemplate = (t: ServerIssueTemplate): IssueTemplate => ({
  id: t.id,
  name: t.name,
  typeId: normalizeType(t.typeId),
  priorityId: (t.priorityId as PriorityId) || "medium",
  title: t.title,
  description: t.description,
  statusId: t.statusId,
  position: t.position,
});

export const mapSprint = (s: ServerSprint): Sprint => ({
  id: s.id,
  name: s.name,
  goal: s.goal,
  status: s.status,
  startDate: s.startDate,
  endDate: s.endDate,
});

export const mapAttachment = (a: ServerAttachment): Attachment => ({
  id: a.id,
  filename: a.filename,
  contentType: a.contentType,
  byteSize: a.byteSize,
  uploadedById: a.uploadedById,
  createdAt: Date.parse(a.createdAt) || Date.now(),
});

export const mapChecklistItem = (c: ServerChecklistItem): ChecklistItem => ({
  id: c.id,
  text: c.text,
  done: c.done,
  position: c.position,
  createdAt: Date.parse(c.createdAt) || Date.now(),
});

export const mapIssueLink = (l: ServerIssueLink): IssueLink => ({
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

/** Экспортируется для постраничных наборов (`issuePages.ts`): они мапят DTO страницы так же, как стор. */
export function mapIssue(dto: ServerIssue, prev?: Issue): Issue {
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
    epicChildrenCount: dto.epicChildrenCount ?? prev?.epicChildrenCount ?? null,
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
export function upsertIssue(list: Issue[], issue: Issue): Issue[] {
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
export function patchParentSubtasksSummary(
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
