import { api } from "./api";
import type { ProjectFilesQuery, ProjectFilesResult } from "../server/src/projectFilesContract";

export const FILE_PAGE_SIZE = 50;
export const FILE_TYPES = ["all", "images", "documents", "archives", "other"] as const;
export const FILE_SORTS = ["newest", "oldest", "name", "size"] as const;

export function readFileQuery(search: string): ProjectFilesQuery {
  const params = new URLSearchParams(search);
  const type = params.get("fileType"), sort = params.get("fileSort"), page = Number(params.get("filePage") ?? "1");
  return {
    q: (params.get("fileQ") ?? "").trim().slice(0, 250),
    type: FILE_TYPES.find(value => value === type) ?? "all",
    sort: FILE_SORTS.find(value => value === sort) ?? "newest",
    offset: Number.isInteger(page) && page >= 1 && page <= 20_001 ? (page - 1) * FILE_PAGE_SIZE : 0,
    limit: FILE_PAGE_SIZE,
  };
}

/** Keep other URL parameters intact, including an open task panel. */
export function fileQuerySearch(search: string, patch: Partial<ProjectFilesQuery>): string {
  const next = { ...readFileQuery(search), ...patch }, params = new URLSearchParams(search);
  const values: Record<string, string | null> = {
    fileQ: next.q || null,
    fileType: next.type === "all" ? null : next.type,
    fileSort: next.sort === "newest" ? null : next.sort,
    filePage: next.offset ? String(Math.floor(next.offset / FILE_PAGE_SIZE) + 1) : null,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === null) params.delete(key); else params.set(key, value);
  }
  return params.toString();
}

export const projectFilesApi = {
  list: (projectId: string, query: ProjectFilesQuery, signal?: AbortSignal) =>
    api<ProjectFilesResult>(`/api/projects/${encodeURIComponent(projectId)}/files`, { query, signal }),
};
