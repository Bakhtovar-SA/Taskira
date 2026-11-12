import { describe, expect, test } from "vitest";
import type { ApplicationsDto } from "../../server/src/applicationContract";
import { applicationForView, defaultApplicationView, projectAvailable, projectViewsForApplication } from "./navigation";
import { parsePath } from "../router";

const catalog: ApplicationsDto = {
  revision: 4,
  canManage: false,
  applications: [
    { id: "work", enabled: true, projectIds: ["first", "second"] },
    { id: "knowledge", enabled: true, projectIds: ["second"] },
    { id: "objects", enabled: false, projectIds: ["second"] },
  ],
};

describe("application navigation boundaries", () => {
  test("Work keeps task views in their original order without document or object tabs", () => {
    expect(projectViewsForApplication("work")).toEqual([
      "overview", "board", "backlog", "timeline", "calendar", "sprints", "processes", "planning", "files",
    ]);
    expect(defaultApplicationView("work")).toBe("board");
  });

  test("Knowledge and Objects each expose only their own project work and shared files", () => {
    expect(projectViewsForApplication("knowledge")).toEqual(["documents", "files"]);
    expect(projectViewsForApplication("objects")).toEqual(["objects", "files"]);
    expect(defaultApplicationView("knowledge")).toBe("documents");
    expect(defaultApplicationView("objects")).toBe("objects");
  });

  test.each([
    ["/p/CORP/documents", "knowledge"],
    ["/p/CORP/objects", "objects"],
    ["/p/CORP/board", "work"],
    ["/p/CORP/list", "work"],
    ["/p/CORP/processes", "work"],
    ["/p/CORP/planning", "work"],
  ] as const)("existing direct link %s determines its application", (path, expected) => {
    const route = parsePath(path);
    expect(route.kind).toBe("view");
    if (route.kind === "view") expect(applicationForView(route.view)).toBe(expected);
  });

  test.each(["files", "library", "settings", "projectSettings", "orgSettings", "docs", "applicationHome"] as const)(
    "shared page %s retains the current application",
    (view) => expect(applicationForView(view)).toBeNull(),
  );

  test("a visible project is offered only inside its enabled application", () => {
    expect(projectAvailable("work", "first", catalog)).toBe(true);
    expect(projectAvailable("knowledge", "first", catalog)).toBe(false);
    expect(projectAvailable("knowledge", "second", catalog)).toBe(true);
    expect(projectAvailable("objects", "second", catalog)).toBe(false);
    expect(projectAvailable("knowledge", "not-visible", catalog)).toBe(false);
  });

  test("catalog refresh revokes a project even when an old preference still names it", () => {
    const updated: ApplicationsDto = {
      ...catalog,
      revision: 5,
      applications: catalog.applications.map((app) => app.id === "knowledge" ? { ...app, projectIds: [] } : app),
    };
    expect(projectAvailable("knowledge", "second", catalog)).toBe(true);
    expect(projectAvailable("knowledge", "second", updated)).toBe(false);
  });
});
