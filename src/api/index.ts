/** HTTP-клиент Taskira API. Токен в localStorage; сервер — источник правды. */

const TOKEN_KEY = "taskira.token";

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8080";

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
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
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
    res = await fetch(buildUrl(path), { method: "POST", headers, body: fd });
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
    res = await fetch(buildUrl(path), { headers });
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

export type GlobalRole = "admin" | "member";
export type ProjectRole = "manager" | "employee" | "viewer";

export type SafeUser = {
  id: string;
  username: string;
  name: string;
  initials: string;
  color: string;
  jobRole: string;
  /** Глобальная роль ресурса (users.global_role) — источник прав.
   *  Проектная роль приходит в ProjectBootstrap.members. */
  globalRole: GlobalRole;
  isActive: boolean;
  /** local | ldap — у ldap-юзеров роль/профиль приходят из директории. */
  authSource: "local" | "ldap";
  /** Настройки уведомлений — приходят только в GET /api/auth/me (не в общем списке). */
  notifyPrefs?: NotifyPrefs;
};

export type NotifyPrefs = { email?: "instant" | "daily" | "off"; selfWatch?: boolean };

export type ServerNotification = {
  id: string;
  type: string;
  actorId: string | null;
  actor: { id: string; name: string; initials: string; color: string } | null;
  projectId: string | null;
  issueId: string | null;
  payload: Record<string, string | boolean | undefined>;
  createdAt: string;
  read: boolean;
};

/** Приглашённый участник задачи (issue_collaborators). Приходит в детальном
 *  ответе GET /issues/:id (не в списке). */
export type ServerCollaborator = {
  userId: string;
  name: string;
  initials: string;
  color: string;
  jobRole: string;
  addedAt: string;
};

/** Мини-профиль участника (reporter/assignee/автор коммента/приглашённый) —
 *  для отрисовки карточки без bootstrap проекта. Детальный ответ GET /issues/:id. */
export type ServerParticipant = { id: string; name: string; initials: string; color: string; jobRole: string };

/** Вложение задачи (attachments, миграция 010). Детальный ответ GET /issues/:id. */
export type ServerAttachment = {
  id: string;
  issueId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  uploadedById: string | null;
  createdAt: string;
};

/** Элемент «Моих подключений» (GET /api/issues/collaborating). */
export type CollaboratingItem = {
  issueId: string;
  projectId: string;
  key: string;
  title: string;
  statusId: string;
  statusName: string;
  statusCategory: string;
  projectKey: string;
  projectName: string;
};

/** Задача, назначенная мне (GET /api/issues/assigned-to-me) — главный экран. */
export type AssignedIssue = {
  issueId: string;
  projectId: string;
  key: string;
  title: string;
  typeId: string;
  priorityId: string;
  statusId: string;
  statusName: string;
  statusCategory: string;
  dueDate: string | null;
  projectKey: string;
  projectName: string;
};

export type ServerIssue = {
  id: string;
  projectId: string;
  num: number;
  key: string;
  title: string;
  description: string;
  typeId: string;
  statusId: string;
  priorityId: string;
  assigneeId: string | null;
  reporterId: string;
  epicId: string | null;
  color: string | null;
  tStart: number | null;
  tSpan: number | null;
  points: number | null;
  labels: string[];
  dueDate: string | null;
  rank: number;
  /** Только в детальном ответе GET /issues/:id. */
  collaborators?: ServerCollaborator[];
  participants?: ServerParticipant[];
  attachments?: ServerAttachment[];
  links?: ServerIssueLink[];
  createdAt: string;
  updatedAt: string;
};

export type ServerIssueLink = {
  id: string;
  dir: "relates" | "blocks" | "blocked_by";
  issue: {
    id: string;
    key: string;
    title: string;
    typeId: string;
    statusId: string;
    statusCategory: string;
  };
  createdAt: string;
};

export type ServerComment = {
  id: string;
  issueId: string;
  authorId: string;
  body: string;
  createdAt: string;
};

export type ServerActivity = {
  id: string;
  issueId: string;
  actorId: string;
  text: string;
  createdAt: string;
};

/** Проект (список / карточка / ответ POST·PATCH). */
export type Project = {
  id: string;
  key: string;
  name: string;
  description: string;
  departmentId: string;
  isShared: boolean;
};

export type Department = {
  id: string;
  name: string;
  ldapGroupDn: string | null;
  projectCount: number;
};

/** Ответ GET /api/projects/:projectId — данные одного проекта. */
export type ProjectBootstrap = {
  project: Project;
  users: SafeUser[];
  /** Состав проекта: userId → проектная роль. Права me считаются из globalRole + этого. */
  members: { userId: string; role: ProjectRole }[];
  workflow: {
    statuses: { id: string; sid: string; name: string; category: "todo" | "inprogress" | "done"; position?: number }[];
    transitions: { id: string; from: string; to: string }[];
  };
};

/** Префикс ресурсов проекта. */
const P = (projectId: string) => `/api/projects/${projectId}`;

export const authApi = {
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
    api<{ items: ServerNotification[]; nextCursor: string | null; unread: number }>("/api/notifications", {
      query: { cursor, limit: 20 },
    }),
  unreadCount: () => api<{ count: number }>("/api/notifications/unread-count"),
  markRead: (ids?: string[]) =>
    api<void>("/api/notifications/read", { method: "POST", body: ids && ids.length ? { ids } : {} }),
  setPrefs: (prefs: NotifyPrefs) =>
    api<{ notifyPrefs: NotifyPrefs }>("/api/notifications/prefs", { method: "PATCH", body: prefs }),
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
  create: (body: { key: string; name: string; description?: string; departmentId: string; isShared?: boolean }) =>
    api<Project>("/api/projects", { method: "POST", body }),
  patch: (projectId: string, body: Partial<{ name: string; description: string; departmentId: string; isShared: boolean }>) =>
    api<Project>(P(projectId), { method: "PATCH", body }),
  remove: (projectId: string) => api<void>(P(projectId), { method: "DELETE" }),
};

export const departmentsApi = {
  list: () => api<Department[]>("/api/departments"),
  create: (name: string) => api<Department>("/api/departments", { method: "POST", body: { name } }),
  patch: (id: string, body: Partial<{ name: string; ldapGroupDn: string | null }>) =>
    api<Department>(`/api/departments/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<void>(`/api/departments/${id}`, { method: "DELETE" }),
};

/** Тонкий профиль для пикеров (подключение к задаче и т.п.). */
export type PickableUser = { id: string; name: string; initials: string; color: string; jobRole: string };

/** Пользователи ресурса — `list`/`create` только для глобального admin;
 *  `pickable` — любой аутентифицированный (см. COLLAB_MIGRATION.md D7). */
export const usersApi = {
  list: () => api<SafeUser[]>("/api/users"),
  pickable: () => api<PickableUser[]>("/api/users/pickable"),
  create: (body: {
    username: string;
    password: string;
    name: string;
    initials: string;
    color: string;
    jobRole: string;
    globalRole?: GlobalRole;
  }) => api<SafeUser>("/api/admin/users", { method: "POST", body }),
};

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

export const issuesApi = {
  list: (projectId: string, query?: Record<string, string | number | undefined>) =>
    api<{ items: ServerIssue[]; total: number }>(`${P(projectId)}/issues`, { query }),
  get: (projectId: string, id: string) => api<ServerIssue>(`${P(projectId)}/issues/${id}`),
  /** Задачи, к которым текущий пользователь приглашён (через все проекты). */
  collaborating: () => api<CollaboratingItem[]>("/api/issues/collaborating"),
  /** Открытые задачи, назначенные мне, по всем видимым проектам (главный экран). */
  assignedToMe: () => api<AssignedIssue[]>("/api/issues/assigned-to-me"),
  create: (projectId: string, body: Record<string, unknown>) =>
    api<ServerIssue>(`${P(projectId)}/issues`, { method: "POST", body }),
  patch: (projectId: string, id: string, body: Record<string, unknown>) =>
    api<ServerIssue>(`${P(projectId)}/issues/${id}`, { method: "PATCH", body }),
  remove: (projectId: string, id: string) => api<void>(`${P(projectId)}/issues/${id}`, { method: "DELETE" }),
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
};

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
