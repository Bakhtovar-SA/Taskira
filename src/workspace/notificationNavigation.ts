import type { NotificationT, ProjectSummary } from "../types";
export function openWorkspaceNotification(
  n: NotificationT,
  projects: ProjectSummary[],
): boolean {
  if (
    n.type !== "workspace" ||
    !n.projectId ||
    !n.payload.entityId ||
    !n.payload.entityKind
  )
    return false;
  const project = projects.find((p) => p.id === n.projectId);
  if (!project) return false;
  const kind = n.payload.entityKind,
    id = encodeURIComponent(n.payload.entityId);
  const suffix =
    kind === "document"
      ? `documents?document=${id}`
      : kind === "object"
        ? `objects?object=${id}`
        : kind === "process"
          ? `processes?run=${id}`
          : null;
  if (!suffix) return false;
  window.location.assign(`/p/${encodeURIComponent(project.key)}/${suffix}`);
  return true;
}
