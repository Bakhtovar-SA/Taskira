import { api, apiUpload, downloadBlob, API_BASE } from "../api";
import type {
  ProjectFile,
  ProjectFilesResult,
  ProjectFilesQuery,
  WorkspaceModules,
  Document,
  DocumentVersion,
  DocumentComment,
  DocumentFile,
  EntityRef,
  EntityLink,
  ObjectType,
  ObjectRecord,
  ProcessTemplate,
  ProcessTemplateBody,
  ProcessRun,
  AutomationRule,
  AutomationRuleBody,
  PlanScenario,
  PlanBody,
  PlanItem,
  ForecastResult,
  LibraryItem,
  WorkspaceHistory,
} from "../../server/src/workspaceContract";
const root = (p: string) => `/api/projects/${encodeURIComponent(p)}`;
export const workspaceApi = {
  downloadProjectFile: (p: string, file: ProjectFile) =>
    downloadBlob(
      `${root(p)}/${file.source.kind === "issue" ? "issues" : "documents"}/${file.source.id}/attachments/${file.id}`,
      file.filename,
    ),
  projectFiles: (
    p: string,
    query: Partial<ProjectFilesQuery>,
    signal?: AbortSignal,
  ) => api<ProjectFilesResult>(`${root(p)}/files`, { query, signal }),
  modules: (p: string, signal?: AbortSignal) =>
    api<WorkspaceModules>(`${root(p)}/workspace/modules`, { signal }),
  setModules: (p: string, body: WorkspaceModules) =>
    api<WorkspaceModules>(`${root(p)}/workspace/modules`, {
      method: "PATCH",
      body,
    }),
  library: (
    q = "",
    signal?: AbortSignal,
    filter: { projectId?: string; kind?: EntityRef["kind"] } = {},
  ) =>
    api<{ items: LibraryItem[]; truncated: boolean }>("/api/library", {
      query: { q, ...filter },
      signal,
    }),
  documents: (p: string, signal?: AbortSignal) =>
    api<{ items: Document[] }>(`${root(p)}/documents`, { signal }),
  document: (p: string, id: string, signal?: AbortSignal) =>
    api<{ document: Document; content: unknown }>(
      `${root(p)}/documents/${id}`,
      { signal },
    ),
  createDocument: (p: string, body: unknown) =>
    api<Document>(`${root(p)}/documents`, { method: "POST", body }),
  patchDocument: (p: string, id: string, body: unknown) =>
    api<Document>(`${root(p)}/documents/${id}`, { method: "PATCH", body }),
  versions: (p: string, id: string, offset = 0, signal?: AbortSignal) =>
    api<{ items: DocumentVersion[] }>(`${root(p)}/documents/${id}/versions`, {
      query: { offset },
      signal,
    }),
  checkpoint: (p: string, id: string, name: string) =>
    api<DocumentVersion>(`${root(p)}/documents/${id}/versions`, {
      method: "POST",
      body: { name },
    }),
  restore: (p: string, id: string, versionId: string) =>
    api<Document>(`${root(p)}/documents/${id}/restore`, {
      method: "POST",
      body: { versionId },
    }),
  verify: (
    p: string,
    id: string,
    versionId: string,
    validUntil: string | null,
  ) =>
    api<Document>(`${root(p)}/documents/${id}/verify`, {
      method: "POST",
      body: { versionId, validUntil },
    }),
  comments: (p: string, id: string, signal?: AbortSignal) =>
    api<{ items: DocumentComment[] }>(`${root(p)}/documents/${id}/comments`, {
      signal,
    }),
  comment: (p: string, id: string, body: unknown) =>
    api<{ items: DocumentComment[] }>(`${root(p)}/documents/${id}/comments`, {
      method: "POST",
      body,
    }),
  resolve: (p: string, id: string, commentId: string, resolved: boolean) =>
    api<{ items: DocumentComment[] }>(
      `${root(p)}/documents/${id}/comments/${commentId}`,
      { method: "PATCH", body: { resolved } },
    ),
  files: (p: string, id: string, signal?: AbortSignal) =>
    api<{ items: DocumentFile[] }>(`${root(p)}/documents/${id}/attachments`, {
      signal,
    }),
  upload: (p: string, id: string, file: File) =>
    apiUpload<DocumentFile>(`${root(p)}/documents/${id}/attachments`, file),
  fileUrl: (p: string, id: string, fileId: string) =>
    `${API_BASE}${root(p)}/documents/${id}/attachments/${fileId}`,
  exportDocument: (p: string, id: string) =>
    downloadBlob(`${root(p)}/documents/${id}/export`, `document-${id}.json`),
  taskFromDocument: (p: string, id: string, body: unknown) =>
    api<{ id: string; key: string }>(`${root(p)}/documents/${id}/issues`, {
      method: "POST",
      body,
    }),
  links: (p: string, ref: EntityRef, signal?: AbortSignal) =>
    api<{ items: EntityLink[] }>(`${root(p)}/entity-links`, {
      query: ref,
      signal,
    }),
  link: (p: string, source: EntityRef, target: EntityRef) =>
    api(`${root(p)}/entity-links`, {
      method: "POST",
      body: { source, target },
    }),
  unlink: (p: string, id: string) =>
    api(`${root(p)}/entity-links/${id}`, { method: "DELETE" }),
  types: (p: string, signal?: AbortSignal) =>
    api<{ items: ObjectType[] }>(`${root(p)}/object-types`, { signal }),
  saveType: (p: string, id: string | null, body: unknown) =>
    api<ObjectType>(`${root(p)}/object-types${id ? `/${id}` : ""}`, {
      method: id ? "PATCH" : "POST",
      body,
    }),
  objects: (
    p: string,
    query: {
      q?: string;
      typeId?: string;
      offset?: number;
      owner?: string;
      archived?: string;
      field?: string;
      value?: string;
      before?: string;
      sort?: string;
      direction?: string;
    } = {},
    signal?: AbortSignal,
  ) =>
    api<{ items: ObjectRecord[]; total: number }>(`${root(p)}/objects`, {
      query,
      signal,
    }),
  object: (p: string, id: string, signal?: AbortSignal) =>
    api<{
      object: ObjectRecord;
      links: EntityLink[];
      history: WorkspaceHistory[];
    }>(`${root(p)}/objects/${id}`, { signal }),
  saveObject: (p: string, id: string | null, body: unknown) =>
    api<ObjectRecord>(`${root(p)}/objects${id ? `/${id}` : ""}`, {
      method: id ? "PATCH" : "POST",
      body,
    }),
  templates: (p: string, signal?: AbortSignal) =>
    api<{ items: ProcessTemplate[] }>(`${root(p)}/process-templates`, {
      signal,
    }),
  saveTemplate: (
    p: string,
    id: string | null,
    spec: ProcessTemplateBody,
    revision?: number,
    archived = false,
  ) =>
    api<ProcessTemplate>(`${root(p)}/process-templates${id ? `/${id}` : ""}`, {
      method: id ? "PATCH" : "POST",
      body: id ? { spec, revision, archived } : spec,
    }),
  publish: (p: string, id: string) =>
    api<{ id: string; version: number }>(
      `${root(p)}/process-templates/${id}/publish`,
      { method: "POST" },
    ),
  preview: (p: string, id: string) =>
    api<{
      steps: ProcessTemplate["draft"]["steps"];
      errors: string[];
      versionId: string | null;
    }>(`${root(p)}/process-templates/${id}/preview`, { method: "POST" }),
  runs: (p: string, signal?: AbortSignal) =>
    api<{
      items: Pick<
        ProcessRun,
        "id" | "title" | "state" | "error" | "createdAt"
      >[];
    }>(`${root(p)}/process-runs`, { signal }),
  run: (p: string, id: string, signal?: AbortSignal) =>
    api<ProcessRun>(`${root(p)}/process-runs/${id}`, { signal }),
  startRun: (p: string, body: unknown) =>
    api<ProcessRun>(`${root(p)}/process-runs`, { method: "POST", body }),
  controlRun: (p: string, id: string, action: "pause" | "resume" | "cancel") =>
    api<ProcessRun>(`${root(p)}/process-runs/${id}/control`, {
      method: "POST",
      body: { action },
    }),
  review: (
    p: string,
    id: string,
    stepId: string,
    action: "approve" | "return",
    reviewRevision: number,
    reason: string,
  ) =>
    api<ProcessRun>(`${root(p)}/process-runs/${id}/review`, {
      method: "POST",
      body: { stepId, action, reason, reviewRevision },
    }),
  rules: (p: string, signal?: AbortSignal) =>
    api<{ items: AutomationRule[] }>(`${root(p)}/automation-rules`, { signal }),
  saveRule: (p: string, id: string | null, body: AutomationRuleBody) =>
    api(`${root(p)}/automation-rules${id ? `/${id}` : ""}`, {
      method: id ? "PATCH" : "POST",
      body,
    }),
  executions: (p: string, id: string, signal?: AbortSignal) =>
    api<{
      items: import("../../server/src/workspaceContract").AutomationExecution[];
    }>(`${root(p)}/automation-rules/${id}/executions`, { signal }),
  retryExecution: (p: string, id: string, eventId: string) =>
    api(`${root(p)}/automation-rules/${id}/executions/${eventId}/retry`, {
      method: "POST",
    }),
  previewRule: (
    p: string,
    rule: AutomationRuleBody,
    values: Record<string, unknown>,
  ) =>
    api<{ matches: boolean; actions: unknown[] }>(
      `${root(p)}/automation-rules/preview`,
      { method: "POST", body: { rule, values } },
    ),
  plans: (p: string, signal?: AbortSignal) =>
    api<{ items: PlanScenario[] }>(`${root(p)}/plans`, { signal }),
  savePlan: (
    p: string,
    id: string | null,
    body: PlanBody & { revision?: number; planId?: string | null },
  ) =>
    api<PlanScenario>(`${root(p)}/plans${id ? `/${id}` : ""}`, {
      method: id ? "PATCH" : "POST",
      body,
    }),
  workItems: (p: string, signal?: AbortSignal) =>
    api<{
      items: (PlanItem & { assigneeIds: string[]; dueDate: string | null })[];
      truncated: boolean;
    }>(`${root(p)}/plans/work-items`, { signal }),
  forecast: (p: string, id: string, signal?: AbortSignal) =>
    api<ForecastResult>(`${root(p)}/plans/${id}/forecast`, { signal }),
};
