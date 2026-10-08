/** HTTP-клиент Taskira API. Браузерная сессия живёт в HttpOnly-cookie;
 *  переменная ниже — только обратная совместимость для тестов/CLI-обвязки. */
import type {
  SystemStatusDto, OpsRunDto, OpsKind,
  RecurringConfigDto, RecurringRuleBody, RecurringRulePatchBody, RecurringRuleDto, RecurringRunDto, RecurringPreviewBody,
  ApiTokenCreateBody, ApiTokenDto, ApiTokenCreatedDto, ApiTokenAdminDto, ApiTokenAdminQuery,
  ServiceAccountCreateBody, ServiceAccountPatchBody, ServiceAccountDto,
  WebhookCreateBody, WebhookPatchBody, WebhookDeliveryQuery, WebhookDto, WebhookDeliveryDetailDto,
  WebhookCreatedDto, WebhookSecretRotatedDto, WebhookDeliveryPageDto, WebhookQueuedDto,
  WebhookRedeliveredDto, IntegrationsConfigDto,
  OnboardingDto,
  SetupStatusDto,
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
  LoginResultDto,
  PasswordResetResultDto,
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
  ProjectTemplateDto,
  BrandDto,
  MilestoneDto,
  RoadmapDto,
  DashboardDto,
  DashboardDataDto,
  DashboardWidget,
  ProjectOverviewDto,
  WidgetDataDto,
} from "../../server/src/contract";
import type { z } from "zod";

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
  signal?: AbortSignal;
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
      ...(opts.signal ? { signal: opts.signal } : {}),
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
  return apiUploadForm<T>(path, fd);
}

/** multipart с несколькими полями (фото фона проекта: два размера + светлота). */
export async function apiUploadForm<T = unknown>(path: string, fd: FormData): Promise<T> {
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
/** GET /api/auth/me: mustChangePassword (SEC-PWD-01) — сессия годится только для смены пароля. */
export type MeUser = SafeUser & Pick<MeDto, "mustChangePassword">;

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

export const recurringApi = {
  config: () => api<RecurringConfigDto>("/api/recurring/config"),
  list: (pid: string) => api<RecurringRuleDto[]>(`${P(pid)}/recurring`),
  create: (pid: string, body: RecurringRuleBody) => api<RecurringRuleDto>(`${P(pid)}/recurring`, { method: "POST", body }),
  update: (pid: string, id: string, body: RecurringRulePatchBody) => api<RecurringRuleDto>(`${P(pid)}/recurring/${id}`, { method: "PATCH", body }),
  remove: (pid: string, id: string) => api<void>(`${P(pid)}/recurring/${id}`, { method: "DELETE" }),
  pause: (pid: string, id: string) => api<RecurringRuleDto>(`${P(pid)}/recurring/${id}/pause`, { method: "POST" }),
  resume: (pid: string, id: string) => api<RecurringRuleDto>(`${P(pid)}/recurring/${id}/resume`, { method: "POST" }),
  runNow: (pid: string, id: string) => api<RecurringRunDto>(`${P(pid)}/recurring/${id}/run-now`, { method: "POST" }),
  preview: (pid: string, body: RecurringPreviewBody, signal?: AbortSignal) => api<{ next: string[] }>(`${P(pid)}/recurring/preview`, { method: "POST", body, signal }),
  runs: (pid: string, id: string, limit = 100) => api<RecurringRunDto[]>(`${P(pid)}/recurring/${id}/runs`, { query: { limit: String(limit) } }),
};
const H = (projectId: string, id: string) => `${P(projectId)}/webhooks/${encodeURIComponent(id)}`;
export const integrationsApi = { config: () => api<IntegrationsConfigDto>("/api/integrations/config") };
export const webhooksApi = {
  list: (projectId: string) => api<WebhookDto[]>(`${P(projectId)}/webhooks`),
  create: (projectId: string,body: z.infer<typeof WebhookCreateBody>) => api<WebhookCreatedDto>(`${P(projectId)}/webhooks`,{ method: "POST",body }),
  update: (projectId: string,id: string,body: z.infer<typeof WebhookPatchBody>) => api<WebhookDto>(H(projectId,id),{ method: "PATCH",body }),
  remove: (projectId: string,id: string) => api<void>(H(projectId,id),{ method: "DELETE" }),
  rotateSecret: (projectId: string,id: string) => api<WebhookSecretRotatedDto>(H(projectId,id)+"/rotate-secret",{ method: "POST" }),
  ping: (projectId: string,id: string,signal?: AbortSignal) => api<WebhookQueuedDto>(H(projectId,id)+"/ping",{ method: "POST",signal }),
  deliveries: (projectId: string,id: string,query: Partial<z.infer<typeof WebhookDeliveryQuery>> = {}) => {
    const search = new URLSearchParams(Object.entries(query).filter(([,value]) => value !== undefined).map(([key,value]) => [key,String(value)]));
    return api<WebhookDeliveryPageDto>(H(projectId,id)+"/deliveries?"+search);
  },
  delivery: (projectId: string,id: string,deliveryId: string,signal?: AbortSignal) => api<WebhookDeliveryDetailDto>(H(projectId,id)+"/deliveries/"+encodeURIComponent(deliveryId),{ signal }),
  redeliver: (projectId: string,id: string,deliveryId: string) => api<WebhookQueuedDto>(H(projectId,id)+"/deliveries/"+encodeURIComponent(deliveryId)+"/redeliver",{ method: "POST" }),
  redeliverFailed: (projectId: string,id: string,since?: string) => api<WebhookRedeliveredDto>(H(projectId,id)+"/redeliver-failed",{ method: "POST",body: { since } }),
};

export const tokensApi = {
  list: () => api<ApiTokenDto[]>("/api/me/tokens"),
  create: (body: z.input<typeof ApiTokenCreateBody>) => api<ApiTokenCreatedDto>("/api/me/tokens",{ method: "POST",body }),
  revoke: (id: string) => api<void>("/api/me/tokens/"+encodeURIComponent(id),{ method: "DELETE" }),
};
const serviceAccountPath = (id: string) => "/api/admin/service-accounts/"+encodeURIComponent(id);
export const serviceAccountsApi = {
  list: () => api<ServiceAccountDto[]>("/api/admin/service-accounts"),
  create: (body: z.input<typeof ServiceAccountCreateBody>) => api<ServiceAccountDto>("/api/admin/service-accounts",{ method: "POST",body }),
  update: (id: string,body: z.input<typeof ServiceAccountPatchBody>) => api<ServiceAccountDto>(serviceAccountPath(id),{ method: "PATCH",body }),
  tokens: (id: string) => api<ApiTokenDto[]>(serviceAccountPath(id)+"/tokens"),
  createToken: (id: string,body: z.input<typeof ApiTokenCreateBody>) => api<ApiTokenCreatedDto>(serviceAccountPath(id)+"/tokens",{ method: "POST",body }),
  revokeToken: (id: string,tokenId: string) => api<void>(serviceAccountPath(id)+"/tokens/"+encodeURIComponent(tokenId),{ method: "DELETE" }),
};
export const adminTokensApi = {
  list: (query: z.input<typeof ApiTokenAdminQuery> = {}) => api<ApiTokenAdminDto[]>("/api/admin/tokens",{ query }),
  revoke: (id: string) => api<void>("/api/admin/tokens/"+encodeURIComponent(id),{ method: "DELETE" }),
};

export const authApi = {
  /** Завершить сессию на сервере: все ранее выданные токены становятся
   *  недействительными. Без этого «Выйти» стирало токен только в браузере,
   *  а сам JWT продолжал работать до истечения срока. */
  logout: () => api<void>("/api/auth/logout", { method: "POST" }),
  login: (username: string, password: string) =>
    api<LoginResultDto>("/api/auth/login", {
      method: "POST",
      body: { username, password },
      auth: false,
    }),
  me: () => api<MeUser>("/api/auth/me"),
  /** SEC-PWD-01: смена своего пароля. Сервер завершает остальные сеансы и выдаёт этой вкладке новую cookie. */
  changePassword: (currentPassword: string, newPassword: string) =>
    api<LoginResultDto>("/api/me/password", { method: "POST", body: { currentPassword, newPassword } }),
  /** Язык писем и сводок (трек E): интерфейс живёт в браузере, серверу язык нужен только почте. */
  setLang: (lang: "ru" | "en") => api<void>("/api/me/lang", { method: "PUT", body: { lang } }),
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

/** Онбординг (ТЗ 5.11): прогресс «Начала работы» и закрытые подсказки текущего пользователя. */
export const onboardingApi = {
  get: () => api<OnboardingDto>("/api/me/onboarding"),
  /** Шаг, который сервер не видит сам: тема живёт только в браузере. */
  markTheme: () => api<OnboardingDto>("/api/me/onboarding/steps", { method: "POST", body: { step: "theme" } }),
  hide: () => api<void>("/api/me/onboarding/hide", { method: "POST" }),
  dismissHint: (hintId: string) => api<void>(`/api/me/hints/${encodeURIComponent(hintId)}/dismiss`, { method: "POST" }),
};

/** Первичная настройка инсталляции и демо-проект (ТЗ 5.11, глобальный admin). */
export const setupApi = {
  get: () => api<SetupStatusDto>("/api/admin/setup"),
  rename: (instanceName: string) => api<SetupStatusDto>("/api/admin/setup", { method: "PATCH", body: { instanceName } }),
  complete: () => api<SetupStatusDto>("/api/admin/setup/complete", { method: "POST" }),
  createDemo: () => api<{ id: string }>("/api/admin/demo-project", { method: "POST" }),
  removeDemo: () => api<void>("/api/admin/demo-project", { method: "DELETE" }),
};

/** Брендирование (ТЗ 5.14 п.5): чтение публичное (нужно экрану входа), запись — глобальный admin. */
export const brandApi = {
  get: () => api<BrandDto>("/api/instance/brand", { auth: false }),
  patch: (body: { name?: string | null; hue?: number | null; transparencyDefault?: BrandDto["transparencyDefault"] }) => api<BrandDto>("/api/admin/brand", { method: "PATCH", body }),
  uploadLogo: (file: File) => apiUpload<BrandDto>("/api/admin/brand/logo", file),
  removeLogo: () => api<BrandDto>("/api/admin/brand/logo", { method: "DELETE" }),
  /** blob: URL знака — img-src CSP разрешает blob:, а API в dev живёт на другом origin; null — нет или ошибка. */
  logoBlobUrl: async (v: number): Promise<string | null> => {
    try {
      const res = await fetch(buildUrl("/api/instance/brand/logo", { v: String(v) }), { credentials: "include" });
      return res.ok ? URL.createObjectURL(await res.blob()) : null;
    } catch {
      return null;
    }
  },
};

/** Роадмап проектов (ТЗ 5.15): чтение — все видимые проекты; правка — право editRoadmap в проекте. */
export const roadmapApi = {
  get: () => api<RoadmapDto>("/api/roadmap"),
  setDates: (projectId: string, body: { startDate?: string | null; targetDate?: string | null }) =>
    api<void>(`${P(projectId)}/roadmap`, { method: "PATCH", body }),
  addMilestone: (projectId: string, body: { name: string; date: string }) => api<MilestoneDto>(`${P(projectId)}/milestones`, { method: "POST", body }),
  patchMilestone: (projectId: string, id: string, body: { name?: string; date?: string }) =>
    api<MilestoneDto>(`${P(projectId)}/milestones/${id}`, { method: "PATCH", body }),
  removeMilestone: (projectId: string, id: string) => api<void>(`${P(projectId)}/milestones/${id}`, { method: "DELETE" }),
  addDependency: (projectId: string, sourceProjectId: string) =>
    api<{ sourceId: string; dependentId: string }>(`${P(projectId)}/dependencies`, { method: "POST", body: { sourceProjectId } }),
  removeDependency: (projectId: string, sourceProjectId: string) => api<void>(`${P(projectId)}/dependencies/${sourceProjectId}`, { method: "DELETE" }),
};

/** Дашборды (ADR-0022). Данные виджетов — одним запросом для набора (в том числе ещё не сохранённого). */
export type { DashboardDto, DashboardWidget, WidgetDataDto, ProjectOverviewDto };
export const dashboardsApi = {
  list: () => api<DashboardDto[]>("/api/dashboards"),
  get: (id: string) => api<DashboardDto>(`/api/dashboards/${id}`),
  create: (body: { name: string; shared?: boolean; widgets?: DashboardWidget[] }) => api<DashboardDto>("/api/dashboards", { method: "POST", body }),
  patch: (id: string, body: { name?: string; shared?: boolean; widgets?: DashboardWidget[] }) =>
    api<DashboardDto>(`/api/dashboards/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<void>(`/api/dashboards/${id}`, { method: "DELETE" }),
  data: (widgets: DashboardWidget[], projectId?: string) => api<DashboardDataDto>("/api/dashboards/data", { method: "POST", body: { widgets, projectId } }),
  overview: (projectId: string) => api<ProjectOverviewDto>(`${P(projectId)}/overview`),
  saveOverview: (projectId: string, widgets: DashboardWidget[]) => api<DashboardDto>(`${P(projectId)}/overview`, { method: "PUT", body: { widgets } }),
  resetOverview: (projectId: string) => api<void>(`${P(projectId)}/overview`, { method: "DELETE" }),
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

/** Тело POST /api/projects (ТЗ 5.10: `templateId` — `builtin:<id>` или uuid шаблона организации, `members` — в той же транзакции). */
/** Внешний вид проекта (иконка, цвет, фон) — null: как было до настройки. */
export type ProjectLookInput = Partial<Pick<Project, "icon" | "color" | "background">>;
export type CreateProjectInput = { key: string; name: string; description?: string; departmentId: string; isShared?: boolean; sprintsEnabled?: boolean; templateId?: string; members?: { userId: string; role: ProjectRole }[] } & ProjectLookInput;
export type ProjectPatchInput = Partial<{ name: string; description: string; departmentId: string; isShared: boolean; sprintsEnabled: boolean }> & ProjectLookInput;

/** Шаблоны проектов (ТЗ 5.10): встроенные + организации; сохранение из проекта; удаление. */
export const projectTemplatesApi = {
  list: () => api<ProjectTemplateDto[]>("/api/project-templates"),
  saveFromProject: (projectId: string, body: { name: string; description: string }) =>
    api<ProjectTemplateDto>(`${P(projectId)}/save-as-template`, { method: "POST", body }),
  remove: (templateId: string) => api<void>(`/api/project-templates/${templateId}`, { method: "DELETE" }),
};

export const projectsApi = {
  /** Проекты, видимые пользователю (member ∪ is_shared ∪ глоб. admin). */
  list: () => api<Project[]>("/api/projects"),
  /** Данные одного проекта (bootstrap: users/members/workflow). */
  get: (projectId: string) => api<ProjectBootstrap>(P(projectId)),
  create: (body: CreateProjectInput) => api<Project>("/api/projects", { method: "POST", body }),
  patch: (projectId: string, body: ProjectPatchInput) => api<Project>(P(projectId), { method: "PATCH", body }),
  /** Своё фото фона (ТЗ 5.14 п.2): два WebP + средняя светлота; право editAppearance. */
  uploadPhoto: (projectId: string, p: { full: Blob; small: Blob; luma: number }) => {
    const fd = new FormData();
    fd.append("luma", String(p.luma));
    fd.append("full", p.full, "full.webp");
    fd.append("small", p.small, "small.webp");
    return apiUploadForm<Project>(`${P(projectId)}/background-photo`, fd);
  },
  removePhoto: (projectId: string) => api<Project>(`${P(projectId)}/background-photo`, { method: "DELETE" }),
  /** blob: URL фото — авторизованный fetch (у CSS url() заголовка не выставить); null — нет или ошибка. */
  photoBlobUrl: async (projectId: string, size: "full" | "small", v: number): Promise<string | null> => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetch(buildUrl(`${P(projectId)}/background-photo/${size}`, { v: String(v) }), { headers, credentials: "include" });
      return res.ok ? URL.createObjectURL(await res.blob()) : null;
    } catch {
      return null;
    }
  },
  /** Иконка, цвет, фон — право проекта editAppearance (ТЗ 5.14 п.7), не только глобальный администратор. */
  appearance: (projectId: string, body: ProjectLookInput) => api<Project>(`${P(projectId)}/appearance`, { method: "PATCH", body }),
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
  pickable: (search: string,includeService = false) => api<PickableUser[]>("/api/users/pickable", { query: { q: search,...(includeService ? { includeService: "1" } : {}) } }),
  create: (body: {
    username: string;
    password: string;
    name: string;
    initials: string;
    color: string;
    jobRole: string;
    phone?: string;
    globalRole?: GlobalRole;
    /** SEC-PWD-01: начальный пароль знает администратор — потребовать смену при первом входе. */
    mustChangePassword?: boolean;
  }) => api<SafeUser>("/api/admin/users", { method: "POST", body }),
  /** SEC-PWD-01: временный пароль локальной учётки — показывается один раз; сеансы пользователя завершаются. */
  resetPassword: (id: string) => api<PasswordResetResultDto>(`/api/admin/users/${id}/password-reset`, { method: "POST" }),
  /** Глобальная роль и активность (PATCH /api/users/:id); последнего активного админа сервер не отпустит — 409. */
  patch: (id: string, body: { globalRole: GlobalRole; isActive?: boolean }) => api<SafeUser>(`/api/users/${id}`, { method: "PATCH", body }),
};

/** Организация → Лицензия / Обслуживание / Состояние системы (ТЗ 5.9). Типы — зеркало ответов сервера
 *  (`services/license.ts`, `routes/maintenance.ts`, `/api/health` в `app.ts`); только чтение, кроме запуска обслуживания. */
export type LicenseStatusDto =
  | { state: "unset" }
  | { state: "invalid"; reason: string }
  | { state: "active" | "expired"; claims: { plan: string; maxSeats: number; features: string[]; activeWindowDays: number; issuedTo?: string; iat: number; exp: number }; seatsUsed: number; seatsOverLimit: boolean; daysUntilExpiry?: number; daysSinceExpiry?: number };
export type MaintenanceJob = { name: string; intervalMs: number; running: boolean; lastRunAt: string | null; lastResult: "success" | "error" | "skipped" | null; lastDurationMs: number | null; lastError: string | null; nextRunAt: string | null };
export type MaintenanceStatusDto = {
  enabled: boolean;
  jobs: MaintenanceJob[];
  settings: { intervalMs: number; startDelayMs: number; batchSize: number; batchPauseMs: number; maxPerRun: number; archiveAfterDays: number; auditRetentionDays: number };
};
export type HealthDto = { ok: boolean; db: boolean; checks: Record<string, boolean>; pendingMigrations?: string[]; warnings?: { code: string; reason: string }[]; postgres?: { major: number; status: "supported" | "newer_than_tested"; minMajor: number; maxTestedMajor: number }; version: string; ts: string };
export const adminApi = {
  license: () => api<LicenseStatusDto>("/api/admin/license"),
  maintenance: () => api<MaintenanceStatusDto>("/api/maintenance"),
  runMaintenance: (dryRun: boolean) => api<{ archived: number; auditPurged: number; opsRunsPurged: number; capped: boolean; dryRun: boolean }>("/api/maintenance/run", { method: "POST", query: { dryRun: String(dryRun) } }),
  status: () => api<SystemStatusDto>("/api/admin/status"),
  opsRuns: (kind: OpsKind) => api<OpsRunDto[]>("/api/admin/ops-runs", { query: { kind, limit: "5" } }),
  /** Прямые ссылки для скачивания (сессия — HttpOnly-cookie, браузер приложит её сам; см. AdminView). */
  exportUrl: () => `${API_BASE}/api/admin/export`,
  auditExportUrl: (format: "csv" | "jsonl", from?: string, to?: string) => {
    const q = new URLSearchParams({ format });
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return `${API_BASE}/api/admin/audit-log/export?${q}`;
  },
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
  /** Срок в диапазоне, ГГГГ-ММ-ДД включительно. */
  dueFrom?: string;
  dueTo?: string;
  dueEmpty?: "1";
  /** Своё поле проекта (ROUTE-02): значение / диапазон / «не задано» — смысл по типу поля. */
  cf?: string;
  cfValue?: string;
  cfFrom?: string;
  cfTo?: string;
  cfEmpty?: "1";
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
  /** Подписка на задачу: уведомления о всех её изменениях, не только когда ты исполнитель или автор. */
  watch: (projectId: string, issueId: string, on: boolean) =>
    api<{ watching: boolean; watchers: number }>(`${P(projectId)}/issues/${issueId}/watchers/me`, { method: on ? "POST" : "DELETE" }),
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
  /** Wire format: up to 150 comma-separated UUIDs; absence means all visible projects. */
  projectIds?: string;
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
