import type { ApplicationId } from "../../server/src/applicationContract";
import type { ViewId } from "../types";
import { applicationForView, projectViewsForApplication } from "../applications/navigation";

export type ApplicationPreferences = {
  lastApplication?: ApplicationId;
  projects: Partial<Record<ApplicationId, { projectId: string; view: ViewId }>>;
};
export const isApplication = (value: unknown): value is ApplicationId =>
  value === "work" || value === "knowledge" || value === "objects";
const key = (user: string) => `taskira.applications.${user}`;

/** Only navigation preferences, scoped to the signed-in account. No material data. */
export function readApplicationPreferences(user: string): ApplicationPreferences {
  const empty: ApplicationPreferences = { projects: {} };
  if (!user) return empty;
  try {
    const parsed = JSON.parse(localStorage.getItem(key(user)) ?? "null");
    if (!parsed || typeof parsed !== "object") return empty;
    if (isApplication(parsed.lastApplication)) empty.lastApplication = parsed.lastApplication;
    for (const app of ["work", "knowledge", "objects"] as const) {
      const saved = parsed.projects?.[app];
      if (saved && typeof saved.projectId === "string" && typeof saved.view === "string" && projectViewsForApplication(app).includes(saved.view as ViewId) && applicationForView(saved.view as ViewId) === app)
        empty.projects[app] = { projectId: saved.projectId, view: saved.view as ViewId };
    }
  } catch { /* Unavailable or old preferences use the normal Work entry. */ }
  return empty;
}
export function rememberApplication(user: string, app: ApplicationId, projectId?: string, view?: ViewId) {
  if (!user) return;
  const prefs = readApplicationPreferences(user);
  prefs.lastApplication = app;
  if (projectId && view && projectViewsForApplication(app).includes(view) && applicationForView(view) === app) prefs.projects[app] = { projectId, view };
  try { localStorage.setItem(key(user), JSON.stringify(prefs)); } catch { /* Preferences are optional. */ }
}
