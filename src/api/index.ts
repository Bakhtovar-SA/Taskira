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

export type ProjectBootstrap = {
  project: { id: string; key: string; name: string; description?: string };
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

export const authApi = {
  login: (username: string, password: string) =>
    api<{ token: string; user: SafeUser }>("/api/auth/login", {
      method: "POST",
      body: { username, password },
      auth: false,
    }),
  me: () => api<SafeUser>("/api/auth/me"),
};

export const projectApi = {
  bootstrap: () => api<ProjectBootstrap>("/api/project"),
};

export const membersApi = {
  /** Добавить участника / сменить его проектную роль (PUT — upsert на сервере). */
  set: (userId: string, role: ProjectRole) =>
    api<{ userId: string; role: ProjectRole }>(`/api/project/members/${userId}`, {
      method: "PUT",
      body: { role },
    }),
  remove: (userId: string) => api<void>(`/api/project/members/${userId}`, { method: "DELETE" }),
};

export const issuesApi = {
  list: (query?: Record<string, string | number | undefined>) =>
    api<{ items: ServerIssue[]; total: number }>("/api/issues", { query }),
  get: (id: string) => api<ServerIssue>(`/api/issues/${id}`),
  create: (body: Record<string, unknown>) => api<ServerIssue>("/api/issues", { method: "POST", body }),
  patch: (id: string, body: Record<string, unknown>) =>
    api<ServerIssue>(`/api/issues/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<void>(`/api/issues/${id}`, { method: "DELETE" }),
  transition: (id: string, to: string, beforeId?: string | null) =>
    api<ServerIssue>(`/api/issues/${id}/transition`, {
      method: "POST",
      body: { to, beforeId: beforeId ?? null },
    }),
  setSprint: (id: string, sprintId: string | null) =>
    api<ServerIssue>(`/api/issues/${id}/sprint`, { method: "PATCH", body: { sprintId } }),
};

export const commentsApi = {
  list: (issueId: string) => api<ServerComment[]>(`/api/issues/${issueId}/comments`),
  create: (issueId: string, body: string) =>
    api<ServerComment>(`/api/issues/${issueId}/comments`, { method: "POST", body: { body } }),
};

export const sprintsApi = {
  start: () => api<unknown>("/api/sprints/start", { method: "POST" }),
  complete: (id: string) => api<unknown>(`/api/sprints/${id}/complete`, { method: "POST" }),
};

export const workflowApi = {
  addTransition: (from: string, to: string) =>
    api<{ id: string; from: string; to: string }>("/api/workflow/transitions", {
      method: "POST",
      body: { from, to },
    }),
  removeTransition: (id: string) => api<void>(`/api/workflow/transitions/${id}`, { method: "DELETE" }),
  reset: () => api<unknown>("/api/workflow/reset", { method: "POST" }),
};
