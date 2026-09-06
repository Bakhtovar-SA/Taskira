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
  sprintId: string | null;
  labels: string[];
  dueDate: string | null;
  rank: number;
  createdAt: string;
  updatedAt: string;
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
    statuses: { id: string; name: string; category: "todo" | "inprogress" | "done"; position?: number }[];
    transitions: { id: string; from: string; to: string }[];
  };
  sprints: {
    id: string;
    name: string;
    goal: string;
    status: "active" | "future" | "completed";
    startDate: string | null;
    endDate: string | null;
  }[];
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
};

export const projectsApi = {
  /** Проекты, видимые пользователю (member ∪ is_shared ∪ глоб. admin). */
  list: () => api<Project[]>("/api/projects"),
  /** Данные одного проекта (bootstrap: users/members/workflow/sprints). */
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
  patch: (id: string, name: string) => api<Department>(`/api/departments/${id}`, { method: "PATCH", body: { name } }),
  remove: (id: string) => api<void>(`/api/departments/${id}`, { method: "DELETE" }),
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
  setSprint: (projectId: string, id: string, sprintId: string | null) =>
    api<ServerIssue>(`${P(projectId)}/issues/${id}/sprint`, { method: "PATCH", body: { sprintId } }),
};

export const commentsApi = {
  list: (projectId: string, issueId: string) =>
    api<ServerComment[]>(`${P(projectId)}/issues/${issueId}/comments`),
  create: (projectId: string, issueId: string, body: string) =>
    api<ServerComment>(`${P(projectId)}/issues/${issueId}/comments`, { method: "POST", body: { body } }),
};

export const sprintsApi = {
  start: (projectId: string) => api<unknown>(`${P(projectId)}/sprints/start`, { method: "POST" }),
  complete: (projectId: string, id: string) =>
    api<unknown>(`${P(projectId)}/sprints/${id}/complete`, { method: "POST" }),
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
