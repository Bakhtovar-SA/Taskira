import type { ApplicationId, ApplicationsDto } from "../../server/src/applicationContract";
import type { ViewId } from "../types";

const WORK_VIEWS: readonly ViewId[] = ["overview", "board", "backlog", "timeline", "calendar", "sprints", "processes", "planning", "files"];
const KNOWLEDGE_VIEWS: readonly ViewId[] = ["documents", "files"];
const OBJECT_VIEWS: readonly ViewId[] = ["objects", "files"];

/** Shared pages retain their current application. A material or task URL is explicit. */
export function applicationForView(view: ViewId): ApplicationId | null {
  if (view === "documents") return "knowledge";
  if (view === "objects") return "objects";
  if (["files", "library", "settings", "projectSettings", "orgSettings", "docs", "applicationHome"].includes(view)) return null;
  return "work";
}

export function defaultApplicationView(application: ApplicationId): ViewId {
  return application === "knowledge" ? "documents" : application === "objects" ? "objects" : "board";
}

export function projectViewsForApplication(application: ApplicationId): readonly ViewId[] {
  return application === "knowledge" ? KNOWLEDGE_VIEWS : application === "objects" ? OBJECT_VIEWS : WORK_VIEWS;
}

export function projectAvailable(application: ApplicationId, projectId: string, catalog: ApplicationsDto | null): boolean {
  if (!catalog) return application === "work";
  const app = catalog.applications.find((item) => item.id === application);
  return !!app?.enabled && app.projectIds.includes(projectId);
}
