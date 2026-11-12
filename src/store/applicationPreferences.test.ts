import { afterEach, describe, expect, test, vi } from "vitest";
import { readApplicationPreferences, rememberApplication } from "./applicationPreferences";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("account-scoped application preferences", () => {
  test("two accounts keep their own application and last project per application", () => {
    rememberApplication("anna", "work", "operations", "board");
    rememberApplication("anna", "knowledge", "policies", "documents");
    rememberApplication("mikhail", "objects", "equipment", "objects");
    expect(readApplicationPreferences("anna")).toEqual({
      lastApplication: "knowledge", projects: {
        work: { projectId: "operations", view: "board" },
        knowledge: { projectId: "policies", view: "documents" },
      },
    });
    expect(readApplicationPreferences("mikhail")).toEqual({
      lastApplication: "objects", projects: { objects: { projectId: "equipment", view: "objects" } },
    });
    expect(readApplicationPreferences("another-account")).toEqual({ projects: {} });
  });

  test("a shared page does not replace the app's last project view", () => {
    rememberApplication("anna", "knowledge", "policies", "documents");
    rememberApplication("anna", "knowledge", "policies", "files");
    expect(readApplicationPreferences("anna").projects.knowledge).toEqual({ projectId: "policies", view: "documents" });
    rememberApplication("anna", "work", "operations", "board");
    rememberApplication("anna", "work", "operations", "inbox");
    expect(readApplicationPreferences("anna").projects.work).toEqual({ projectId: "operations", view: "board" });
  });

  test("an incompatible or unknown saved view cannot reopen another app or a nonexistent screen", () => {
    localStorage.setItem("taskira.applications.anna", JSON.stringify({
      lastApplication: "unknown-app",
      projects: {
        knowledge: { projectId: "policies", view: "board" },
        work: { projectId: "operations", view: "removed-view" },
        objects: { projectId: 42, view: "objects" },
      },
    }));
    expect(readApplicationPreferences("anna")).toEqual({ projects: {} });
  });

  test("corrupt or unavailable storage falls back without blocking sign-in", () => {
    localStorage.setItem("taskira.applications.anna", "not-json");
    expect(readApplicationPreferences("anna")).toEqual({ projects: {} });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    expect(() => rememberApplication("anna", "knowledge", "policies", "documents")).not.toThrow();
    expect(readApplicationPreferences("anna")).toEqual({ projects: {} });
  });

  test("an unsigned account never writes navigation preferences", () => {
    rememberApplication("", "knowledge", "policies", "documents");
    expect(localStorage.length).toBe(0);
    expect(readApplicationPreferences("")).toEqual({ projects: {} });
  });
});
