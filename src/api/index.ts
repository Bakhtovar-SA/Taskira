/** HTTP-клиент Taskira API. Браузерная сессия живёт в HttpOnly-cookie;
 *  переменная ниже — только обратная совместимость для тестов/CLI-обвязки. */
import type {
  ActivityDto,
  AttachmentDto,
  ChecklistItemDto,
  CollaboratorDto,
  CommentDto,
  CustomFieldValueDto,
  IssueDetailDto,
  IssueDto,
  IssueLinkDto,
  CustomFieldDto,
  DepartmentDto,
  DepartmentMemberDto,
  GLOBAL_ROLES,
  IssueListPageMeta,
  IssueTemplateDto,
  MeDto,
  NotifyPrefs as NotifyPrefsDto,
  ParticipantDto,
  PROJECT_ROLES,
  ProjectBootstrapDto,
  ProjectDto,
  SafeUser as SafeUserDto,
  SprintDto,
  AssignedIssueDto,
  AssignedToMeDto,
  CollaboratingItemDto,
  IssueAssigneesDto,
  IssueCountsDto,
  IssueEpicDto,
  IssueEpicsDto,
  IssueResolveDto,
  NotificationDto,
  NotificationPageDto,
  NotifyPrefsResponse,
  PickableUserDto,
  REPORT_GROUPS,
  ReportRow as ReportRowDto,
  ReportSummaryDto,
  ReportTotals as ReportTotalsDto,
  BulkIssueAction,
  BulkIssueResultDto,
  SavedViewDto,
  SearchResultDto,
  SearchResultItemDto,
  UnreadCountDto,
} from "../../server/src/contract";

let legacyBearerToken: string | null = null;

/** В production API обычно доступен на том же origin через nginx /api proxy.
 *  Явный VITE_API_URL остаётся для раздельного dev/legacy-деплоя. */
export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ||
  (typeof window !== "undefined" ? window.location.origin : "");

export type ApiErrorBody = { error: { code: string; reason: string } };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    reason: string,
  ) {
    super(reason);
    this.name = "ApiError";
  }
}

export function getToken(): string | null {
  return legacyBearerToken;
}

export function setToken(token: string): void {
  legacyBearerToken = token;
}

export function clearToken(): void {
  legacyBearerToken = null;
}

type ApiOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  auth?: boolean;
};

function buildUrl(path: string, query?: ApiOptions["query"]): string {
  const url = new URL(path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, query, auth = true } = opts;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: "include",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Нет связи с сервером — проверьте, что API запущен");
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const err = data as ApiErrorBody | null;
    const code = err?.error?.code ?? (res.status === 401 ? "UNAUTHORIZED" : "HTTP");
    const reason = err?.error?.reason ?? `Ошибка сервера (${res.status})`;
    if (res.status === 401) clearToken();
    throw new ApiError(res.status, code, reason);
  }

  return data as T;
}

/** Загрузка файла: multipart/form-data, НЕ через api() (тот всегда JSON).
 *  Content-Type не ставим — браузер сам добавит boundary. */
export async function apiUpload<T = unknown>(path: string, file: File, fieldName = "file"): Promise<T> {
  const fd = new FormData();
  fd.append(fieldName, file, file.name);
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path), { method: "POST", headers, credentials: "include", body: fd });
  } catch {
    throw new ApiError(0, "NETWORK", "Нет связи с сервером — проверьте, что API запущен");
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = data as ApiErrorBody | null;
    const code = err?.error?.code ?? (res.status === 401 ? "UNAUTHORIZED" : "HTTP");
    const reason = err?.error?.reason ?? `Ошибка загрузки файла (${res.status})`;
    if (res.status === 401) clearToken();
    throw new ApiError(res.status, code, reason);
  }
  return data as T;
}

/** Скачивание вложения: авторизованный fetch -> blob -> клик по скрытой ссылке. */
export async function downloadBlob(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path), { headers, credentials: "include" });
  } catch {
    throw new ApiError(0, "NETWORK", "Нет связи с сервером");
  }
  if (!res.ok) {
    if (res.status === 401) clearToken();
    throw new ApiError(res.status, "HTTP", `Не удалось скачать файл (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* -------- типизированные вызовы -------- */

/* -------- пользователи, проекты, bootstrap: из zod-контракта сервера (ТЗ 2.1, PR 2) -------- */
export type GlobalRole = (typeof GLOBAL_ROLES)[number];
export type ProjectRole = (typeof PROJECT_ROLES)[number];
export type NotifyPrefs = NotifyPrefsDto;

/** Профиль пользователя. `notifyPrefs`/`favoriteProjectIds` приходят только в GET /api/auth/me (`MeDto`), поэтому
 *  у клиента необязательны: общий список пользователей отдаёт `SafeUser` без них. */
export type SafeUser = SafeUserDto & Partial<Pick<MeDto, "notifyPrefs" | "favoriteProjectIds">>;

export type Project = ProjectDto;
export type Department = DepartmentDto;
export type DepartmentMember = DepartmentMemberDto;
export type ServerSprint = SprintDto;
export type ServerIssueTemplate = IssueTemplateDto;
export type ServerCustomField = CustomFieldDto;
export type ServerSavedView = SavedViewDto;
export type BulkAction = BulkIssueAction;
export type BulkResult = BulkIssueResultDto;
/** Ответ `GET /api/projects/:projectId`; `users` клиент читает как `SafeUser` (см. выше). */
export type ProjectBootstrap = Omit<ProjectBootstrapDto, "users"> & { users: SafeUser[] };

/* -------- уведомления, главный экран, поиск, счётчики, отчёты: из zod-контракта сервера (ТЗ 2.1, PR 3) -------- */
export type ServerNotification = NotificationDto;
export type CollaboratingItem = CollaboratingItemDto;
export type AssignedIssue = AssignedIssueDto;
export type SearchResultItem = SearchResultItemDto;
export type PickableUser = PickableUserDto;
export type IssueEpic = IssueEpicDto;
export type IssueCounts = IssueCountsDto;
export type ReportTotals = ReportTotalsDto;
export type ReportRow = ReportRowDto;
export type ReportSummary = ReportSummaryDto;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

/* -------- типы ответов задачи: из zod-контракта сервера (server/src/contract.ts, ТЗ 2.1) --------
 * Форма ответов больше не описывается здесь руками: это те же типы, которыми аннотированы мапперы сервера. */
export type ServerCollaborator = CollaboratorDto;
export type ServerParticipant = ParticipantDto;
export type ServerAttachment = AttachmentDto;
export type ServerIssueLink = IssueLinkDto;
export type ServerChecklistItem = ChecklistItemDto;
export type ServerComment = CommentDto;
export type ServerActivity = ActivityDto;
export type ServerCustomFieldValue = CustomFieldValueDto;

/** Одна клиентская форма для списка и карточки: список отдаёт `IssueDto`, GET /issues/:id — `IssueDetailDto`
 *  (те же поля + участники/вложения/связи/чеклист/подзадачи). Поля детального ответа у клиента необязательны —
 *  в списочной задаче их нет. Это клиентская вьюмодель поверх двух серверных типов, а не третье описание. */
export type ServerIssue = IssueDto & Partial<Omit<IssueDetailDto, keyof IssueDto>>;

/** Префикс ресурсов проекта. */
const P = (projectId: string) => `/api/projects/${projectId}`;

export const authApi = {
  /** Завершить сессию на сервере: все ранее выданные токены становятся
   *  недействительными. Без этого «Выйти» стирало токен только в браузере,
   *  а сам JWT продолжал работать до истечения срока. */
  logout: () => api<void>("/api/auth/logout", { method: "POST" }),
  login: (username: string, password: string) =>
    api<{ token: string; user: SafeUser }>("/api/auth/login", {
      method: "POST",
      body: { username, password },
      auth: false,
    }),
  me: () => api<SafeUser>("/api/auth/me"),
  /** Режим аутентификации ресурса (local | ldap). */
  config: () => api<{ authMode: "local" | "ldap" }>("/api/auth/config"),
};

/** Уведомления (миграция 011). Доставка in-app — polling. */
export const notificationsApi = {
  list: (cursor?: string) =>
    api<NotificationPageDto>("/api/notifications", {
      query: { cursor, limit: 20 },
    }),
  unreadCount: () => api<UnreadCountDto>("/api/notifications/unread-count"),
  markRead: (ids?: string[]) =>
    api<void>("/api/notifications/read", { method: "POST", body: ids && ids.length ? { ids } : {} }),
  dismiss: (ids?: string[]) =>
    api<void>("/api/notifications/dismiss", { method: "POST", body: ids && ids.length ? { ids } : {} }),
  setPrefs: (prefs: NotifyPrefs) =>
    api<NotifyPrefsResponse>("/api/notifications/prefs", { method: "PATCH", body: prefs }),
};

/** LDAP: диагностика и ручной ресинк членства (глобальный admin). */
export const ldapApi = {
  ping: () =>
    api<{ authMode: string; url?: string; bind?: string; ok: boolean; baseDn?: string; error?: string }>("/api/ldap/ping", {
      method: "POST",
    }),
  resync: () =>
    api<{ total: number; synced: number; notFound: string[]; errors: string[] }>("/api/ldap/resync", { method: "POST" }),
};

export const projectsApi = {
  /** Проекты, видимые пользователю (member ∪ is_shared ∪ глоб. admin). */
  list: () => api<Project[]>("/api/projects"),
  /** Данные одного проекта (bootstrap: users/members/workflow). */
  get: (projectId: string) => api<ProjectBootstrap>(P(projectId)),
  create: (body: {
    key: string;
    name: string;
    description?: string;
    departmentId: string;
    isShared?: boolean;
    sprintsEnabled?: boolean;
  }) => api<Project>("/api/projects", { method: "POST", body }),
  patch: (
    projectId: string,
    body: Partial<{ name: string; description: string; departmentId: string; isShared: boolean; sprintsEnabled: boolean }>,
  ) => api<Project>(P(projectId), { method: "PATCH", body }),
  remove: (projectId: string) => api<void>(P(projectId), { method: "DELETE" }),
  /** Избранное (миграция 024) — идемпотентно в обе стороны на сервере. */
  favorite: (projectId: string) => api<void>(`${P(projectId)}/favorite`, { method: "PUT" }),
  unfavorite: (projectId: string) => api<void>(`${P(projectId)}/favorite`, { method: "DELETE" }),
};

export const departmentsApi = {
  list: () => api<Department[]>("/api/departments"),
  create: (name: string) => api<Department>("/api/departments", { method: "POST", body: { name } }),
  patch: (id: string, body: Partial<{ name: string; ldapGroupDn: string | null }>) =>
    api<Department>(`/api/departments/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<void>(`/api/departments/${id}`, { method: "DELETE" }),
  listMembers: (id: string) => api<DepartmentMember[]>(`/api/departments/${id}/members`),
  /** Ручное добавление (source='manual') — для отделов без LDAP-группы или
   *  пока человек не попал ни в одну группу директории. */
  addMember: (id: string, userId: string) =>
    api<DepartmentMember>(`/api/departments/${id}/members/${userId}`, { method: "PUT" }),
  /** 409, если строка source='ldap' — её не убрать отсюда, только из группы AD. */
  removeMember: (id: string, userId: string) =>
    api<void>(`/api/departments/${id}/members/${userId}`, { method: "DELETE" }),
};

/** Пользователи ресурса — `list`/`create` только для глобального admin;
 *  `pickable` — любой аутентифицированный (см. COLLAB_MIGRATION.md D7). */
export const usersApi = {
  list: () => api<SafeUser[]>("/api/users"),
  /** Поиск сотрудников для пикеров. Сервер требует минимум 2 символа и отдаёт
   *  до 20 совпадений — справочник больше не выгружается целиком. */
  pickable: (search: string) => api<PickableUser[]>("/api/users/pickable", { query: { q: search } }),
  create: (body: {
    username: string;
    password: string;
    name: string;
    initials: string;
    color: string;
    jobRole: string;
    phone?: string;
    globalRole?: GlobalRole;
  }) => api<SafeUser>("/api/admin/users", { method: "POST", body }),
};

/** Аватарки — самообслуживание (миграция 027): только свой профиль. */
export const avatarApi = {
  upload: (file: File) => apiUpload<{ avatarUpdatedAt: number }>("/api/me/avatar", file),
  remove: () => api<void>("/api/me/avatar", { method: "DELETE" }),
  /** URL картинки для <img src>; ?v= — cache-buster при повторной загрузке.
   *  Не авторизован по себе — фактическая отдача идёт через getAvatarBlobUrl
   *  ниже (авторизованный fetch, у <img> заголовок не выставить). */
  url: (userId: string, avatarUpdatedAt: number) => buildUrl(`/api/users/${userId}/avatar`, { v: String(avatarUpdatedAt) }),
};

/** Кэш blob-URL аватарок — по userId+avatarUpdatedAt, на время жизни вкладки.
 *  <img src> не может нести Authorization-заголовок, поэтому вместо прямой
 *  ссылки грузим авторизованным fetch и кэшируем object URL (тот же приём,
 *  что downloadBlob, но с кэшем — аватарки показываются массово: доска,
 *  сайдбар, всплывающие карточки). null в кэше — "проверяли, аватарки нет". */
const avatarBlobCache = new Map<string, Promise<string | null>>();
const AVATAR_CACHE_MAX = 256;

function evictAvatarCacheEntry(key: string): void {
  const pending = avatarBlobCache.get(key);
  avatarBlobCache.delete(key);
  void pending?.then((url) => {
    if (url) URL.revokeObjectURL(url);
  });
}

export function getAvatarBlobUrl(userId: string, avatarUpdatedAt: number | null | undefined): Promise<string | null> {
  if (!avatarUpdatedAt) return Promise.resolve(null);
  const cacheKey = `${userId}:${avatarUpdatedAt}`;
  const cached = avatarBlobCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetch(avatarApi.url(userId, avatarUpdatedAt), { headers, credentials: "include" });
      if (!res.ok) return null;
      return URL.createObjectURL(await res.blob());
    } catch {
      return null;
    }
  })();
  avatarBlobCache.set(cacheKey, promise);
  while (avatarBlobCache.size > AVATAR_CACHE_MAX) {
    const oldest = avatarBlobCache.keys().next().value as string | undefined;
    if (!oldest) break;
    evictAvatarCacheEntry(oldest);
  }
  return promise;
}

export function invalidateAvatarBlobUrl(userId: string): void {
  for (const key of avatarBlobCache.keys()) {
    if (key.startsWith(`${userId}:`)) evictAvatarCacheEntry(key);
  }
}

export const membersApi = {
  /** Добавить участника / сменить его проектную роль (PUT — upsert на сервере). */
  set: (projectId: string, userId: string, role: ProjectRole) =>
    api<{ userId: string; role: ProjectRole }>(`${P(projectId)}/members/${userId}`, {
      method: "PUT",
      body: { role },
    }),
  remove: (projectId: string, userId: string) =>
    api<void>(`${P(projectId)}/members/${userId}`, { method: "DELETE" }),
};

/** Фильтры набора задач — зеркало `IssueFilterQuery` сервера (server/src/contract.ts).
 *  Курсор сюда не входит: это состояние обхода, а не свойство набора. */
export interface IssueFilterParams {
  status?: string;
  /** id исполнителя или "none" — задачи без исполнителей. */
  assignee?: string;
  type?: string;
  /** ТЗ 3.2: то же подмножество, что SavedViewFilter на сервере. */
  priority?: string;
  label?: string;
  sprintId?: string;
  /** Дети одной задачи: подзадачи и задачи «направления». */
  parentId?: string;
  epicId?: string;
  q?: string;
  overdue?: "1";
  /** "hide" — без закрытых; "recent" — закрытые не старше closedDays; "older" — только старше. */
  closed?: "hide" | "recent" | "older";
  closedDays?: number;
}
export type IssueSortKey = "rank" | "priority" | "due" | "updated" | "key";
export interface IssuePageParams extends IssueFilterParams {
  sort?: IssueSortKey;
  dir?: "asc" | "desc";
  cursor?: string;
  limit?: number;
}
export const issuesApi = {
  list: (projectId: string, query?: Record<string, string | number | undefined>) =>
    api<IssueListPageMeta & { items: ServerIssue[] }>(`${P(projectId)}/issues`, { query }),
  /** Одна страница набора: фильтры/сортировка серверные, продолжение — по `cursor`. */
  page: (projectId: string, params: IssuePageParams) =>
    api<IssueListPageMeta & { items: ServerIssue[] }>(`${P(projectId)}/issues`, {
      query: params as Record<string, string | number | undefined>,
    }),
  /** Общее число и разбивка по статусам для набора — один запрос на набор, не на страницу. */
  counts: (projectId: string, params: IssueFilterParams) =>
    api<IssueCounts>(`${P(projectId)}/issues/counts`, { query: params as Record<string, string | number | undefined> }),
  /** Направления проекта с агрегатом по детям: справочник для бейджей и Timeline. */
  epics: (projectId: string, limit?: number) =>
    api<IssueEpicsDto>(`${P(projectId)}/issues/epics`, { query: { limit } }),
  /** Исполнители активных задач проекта по убыванию нагрузки (полоска фильтров доски). */
  assignees: (projectId: string, limit?: number) =>
    api<IssueAssigneesDto>(`${P(projectId)}/issues/assignees`, { query: { limit } }),
  get: (projectId: string, id: string) => api<ServerIssue>(`${P(projectId)}/issues/${id}`),
  /** Задачи, к которым текущий пользователь приглашён (через все проекты). */
  collaborating: () => api<CollaboratingItem[]>("/api/issues/collaborating"),
  /** Открытые задачи, назначенные мне, по всем видимым проектам (главный экран).
   *  Ответ — объект: сервер ограничивает выдачу и честно сообщает об усечении. */
  assignedToMe: () => api<AssignedToMeDto>("/api/issues/assigned-to-me"),
  /** Кросс-проектный поиск (миграция 024) — по всем видимым проектам, не
   *  только текущему. */
  search: (q: string) => api<SearchResultDto>("/api/issues/search", { query: { q } }),
  /** Ключ задачи (CORP-123, человекочитаемый — из URL роутера, ТЗ 3.1) → id/projectId.
   *  404, если ключа нет ИЛИ проект не виден вызывающему — не различаются намеренно
   *  (см. server/src/routes/search.ts). */
  resolve: (key: string) => api<IssueResolveDto>("/api/issues/resolve", { query: { key } }),
  /** История задачи («кто, что, когда»). */
  activity: (projectId: string, id: string) => api<ServerActivity[]>(`${P(projectId)}/issues/${id}/activity`),
  create: (projectId: string, body: Record<string, unknown>) =>
    api<ServerIssue>(`${P(projectId)}/issues`, { method: "POST", body }),
  patch: (projectId: string, id: string, body: Record<string, unknown>) =>
    api<ServerIssue>(`${P(projectId)}/issues/${id}`, { method: "PATCH", body }),
  remove: (projectId: string, id: string) => api<void>(`${P(projectId)}/issues/${id}`, { method: "DELETE" }),
  /** Массовые операции (ТЗ 3.3, план v2 Трек 3) — ровно одно действие на весь
   *  выделенный набор; частичный успех (see BulkResult) — не общий success/fail. */
  bulk: (projectId: string, body: BulkAction) => api<BulkResult>(`${P(projectId)}/issues/bulk`, { method: "PATCH", body }),
  /** Назначение/снятие спринта (миграция 023) — отдельным роутом, право
   *  manageSprints, не edit. sprintId=null возвращает задачу в бэклог. */
  setSprint: (projectId: string, id: string, sprintId: string | null) =>
    api<ServerIssue>(`${P(projectId)}/issues/${id}/sprint`, { method: "PATCH", body: { sprintId } }),
  transition: (projectId: string, id: string, to: string, beforeId?: string | null) =>
    api<ServerIssue>(`${P(projectId)}/issues/${id}/transition`, {
      method: "POST",
      body: { to, beforeId: beforeId ?? null },
    }),
  addLink: (projectId: string, id: string, linkedIssueId: string, type: "relates" | "blocks" | "blocked_by") =>
    api<{ id: string; links: ServerIssueLink[] }>(`${P(projectId)}/issues/${id}/links`, {
      method: "POST",
      body: { linkedIssueId, type },
    }),
  removeLink: (projectId: string, id: string, linkId: string) =>
    api<{ links: ServerIssueLink[] }>(`${P(projectId)}/issues/${id}/links/${linkId}`, { method: "DELETE" }),
  addChecklistItem: (projectId: string, id: string, text: string) =>
    api<{ item: ServerChecklistItem; checklist: ServerChecklistItem[] }>(`${P(projectId)}/issues/${id}/checklist`, {
      method: "POST",
      body: { text },
    }),
  patchChecklistItem: (projectId: string, id: string, itemId: string, patch: { text?: string; done?: boolean }) =>
    api<{ item: ServerChecklistItem; checklist: ServerChecklistItem[] }>(
      `${P(projectId)}/issues/${id}/checklist/${itemId}`,
      { method: "PATCH", body: patch },
    ),
  removeChecklistItem: (projectId: string, id: string, itemId: string) =>
    api<{ checklist: ServerChecklistItem[] }>(`${P(projectId)}/issues/${id}/checklist/${itemId}`, { method: "DELETE" }),
  setCustomFieldValue: (projectId: string, id: string, fieldId: string, value: string | null) =>
    api<{ values: ServerCustomFieldValue[] }>(`${P(projectId)}/issues/${id}/custom-fields/${fieldId}`, {
      method: "PUT",
      body: { value },
    }),
};

/* ---------------- Отчёты ---------------- */

export type ReportScope = "closed" | "created" | "open";

export type ReportFilter = {
  from: string;
  to: string;
  projectId?: string;
  departmentId?: string;
};

export const reportsApi = {
  summary: (f: ReportFilter & { groupBy: ReportGroup }) =>
    api<ReportSummary>("/api/reports/summary", { query: { ...f } }),
  /** URL выгрузки. Скачиваем через fetch с Authorization, а не ссылкой:
   *  токен в заголовке, а <a href> его передать не может. */
  exportUrl: (f: ReportFilter & { scope: ReportScope }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) qs.set(k, String(v));
    return `${API_BASE}/api/reports/issues.csv?${qs.toString()}`;
  },
};

/** Скачать CSV-выгрузку: тянем с токеном, отдаём пользователю как файл. */
export async function downloadReportCsv(f: ReportFilter & { scope: ReportScope }): Promise<void> {
  const token = getToken();
  const res = await fetch(reportsApi.exportUrl(f), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  });
  if (!res.ok) {
    let reason = "Не удалось сформировать выгрузку";
    try {
      const body = (await res.json()) as ApiErrorBody;
      reason = body?.error?.reason ?? reason;
    } catch {
      /* тело не json — оставляем общее сообщение */
    }
    throw new ApiError(res.status, "EXPORT", reason);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `taskira-${f.scope}-${f.from}_${f.to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const commentsApi = {
  list: (projectId: string, issueId: string) =>
    api<ServerComment[]>(`${P(projectId)}/issues/${issueId}/comments`),
  create: (projectId: string, issueId: string, body: string) =>
    api<ServerComment>(`${P(projectId)}/issues/${issueId}/comments`, { method: "POST", body: { body } }),
};

/** Приглашённые участники задачи. `add`/`remove` — manageCollaborators (admin/manager). */
export const collaboratorsApi = {
  list: (projectId: string, issueId: string) =>
    api<ServerCollaborator[]>(`${P(projectId)}/issues/${issueId}/collaborators`),
  add: (projectId: string, issueId: string, userId: string) =>
    api<ServerCollaborator>(`${P(projectId)}/issues/${issueId}/collaborators/${userId}`, { method: "PUT" }),
  remove: (projectId: string, issueId: string, userId: string) =>
    api<void>(`${P(projectId)}/issues/${issueId}/collaborators/${userId}`, { method: "DELETE" }),
};

export const attachmentsApi = {
  list: (projectId: string, issueId: string) =>
    api<ServerAttachment[]>(`${P(projectId)}/issues/${issueId}/attachments`),
  upload: (projectId: string, issueId: string, file: File) =>
    apiUpload<ServerAttachment>(`${P(projectId)}/issues/${issueId}/attachments`, file),
  remove: (projectId: string, issueId: string, attId: string) =>
    api<void>(`${P(projectId)}/issues/${issueId}/attachments/${attId}`, { method: "DELETE" }),
  download: (projectId: string, issueId: string, attId: string, filename: string) =>
    downloadBlob(`${P(projectId)}/issues/${issueId}/attachments/${attId}`, filename),
};

export const workflowApi = {
  addTransition: (projectId: string, from: string, to: string) =>
    api<{ id: string; from: string; to: string }>(`${P(projectId)}/workflow/transitions`, {
      method: "POST",
      body: { from, to },
    }),
  removeTransition: (projectId: string, id: string) =>
    api<void>(`${P(projectId)}/workflow/transitions/${id}`, { method: "DELETE" }),
  reset: (projectId: string) => api<unknown>(`${P(projectId)}/workflow/reset`, { method: "POST" }),
};

export type IssueTemplateInput = {
  name: string;
  typeId: string;
  priorityId: string;
  title: string;
  description: string;
  statusId: string | null;
};

export const issueTemplatesApi = {
  create: (projectId: string, body: IssueTemplateInput) =>
    api<ServerIssueTemplate>(`${P(projectId)}/issue-templates`, { method: "POST", body }),
  update: (projectId: string, templateId: string, body: IssueTemplateInput) =>
    api<ServerIssueTemplate>(`${P(projectId)}/issue-templates/${templateId}`, { method: "PATCH", body }),
  remove: (projectId: string, templateId: string) =>
    api<void>(`${P(projectId)}/issue-templates/${templateId}`, { method: "DELETE" }),
};

export const customFieldsApi = {
  create: (projectId: string, body: { name: string; fieldType: ServerCustomField["fieldType"]; options: string[] }) =>
    api<ServerCustomField>(`${P(projectId)}/custom-fields`, { method: "POST", body }),
  rename: (projectId: string, fieldId: string, name: string) =>
    api<ServerCustomField>(`${P(projectId)}/custom-fields/${fieldId}`, { method: "PATCH", body: { name } }),
  remove: (projectId: string, fieldId: string) =>
    api<void>(`${P(projectId)}/custom-fields/${fieldId}`, { method: "DELETE" }),
};

/** Сохранённые вьюхи (ТЗ 3.2, план v2 Трек 3) — личные: сервер сам скрывает чужие
 *  (не только 404 на прямой id), поэтому list() здесь возвращает только свои
 *  же, а не «список проекта» — в отличие от issueTemplatesApi её нет смысла
 *  тянуть через bootstrap проекта (общие для всех данные), она персональная. */
export interface SavedViewInput {
  name: string;
  filter: IssueFilterParams;
  isDefault: boolean;
}
export const savedViewsApi = {
  list: (projectId: string) => api<ServerSavedView[]>(`${P(projectId)}/saved-views`),
  create: (projectId: string, body: SavedViewInput) =>
    api<ServerSavedView>(`${P(projectId)}/saved-views`, { method: "POST", body }),
  update: (projectId: string, viewId: string, body: SavedViewInput) =>
    api<ServerSavedView>(`${P(projectId)}/saved-views/${viewId}`, { method: "PATCH", body }),
  remove: (projectId: string, viewId: string) =>
    api<void>(`${P(projectId)}/saved-views/${viewId}`, { method: "DELETE" }),
};

/** Спринты проекта (миграция 023, опциональный модуль) — 404, если у
 *  проекта не включён sprintsEnabled, независимо от роли. */
export const sprintsApi = {
  create: (projectId: string, body: { name: string; goal: string; startDate?: string | null; endDate?: string | null }) =>
    api<ServerSprint>(`${P(projectId)}/sprints`, { method: "POST", body }),
  start: (projectId: string, sprintId: string) =>
    api<ServerSprint>(`${P(projectId)}/sprints/${sprintId}/start`, { method: "POST" }),
  complete: (projectId: string, sprintId: string) =>
    api<{ sprint: ServerSprint; movedToBacklog: number }>(`${P(projectId)}/sprints/${sprintId}/complete`, { method: "POST" }),
};
