import { expect, test } from "vitest";
import { CATALOG, DEFAULT_ORG_OVERVIEW, DASHBOARD_TEMPLATES, catalogFor, projectOverview } from "./catalog";
test("organisation overview and portfolio template show projects first", () => {
  expect(DEFAULT_ORG_OVERVIEW.map(w => w.type)).toEqual(["projectHealth", "milestones", "projects", "progress", "breakdown", "trend"]);
  expect(DASHBOARD_TEMPLATES.find(t => t.id === "portfolio")!.widgets()).toEqual(DEFAULT_ORG_OVERVIEW);
  expect(DEFAULT_ORG_OVERVIEW.find(w => w.type === "projects")!.w).toBe(12);
});
test("project catalogue hides portfolio-only entries; saved data catalogue remains compatible", () => {
  expect(catalogFor(true).map(c => c.key)).not.toEqual(expect.arrayContaining(["projects", "projectHealth", "by-project", "progress"]));
  for (const key of ["projects", "projectHealth", "by-project", "progress"]) expect(catalogFor(true).some(c => c.key === key)).toBe(false);
  expect(CATALOG.find(c => c.key === "progress")).toBeTruthy();
  expect(projectOverview(false).some(w => w.type === "milestones")).toBe(false);
  expect(projectOverview(true).some(w => w.type === "milestones")).toBe(true);
});
