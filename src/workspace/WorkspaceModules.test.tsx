import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { workspaceApi } from "./api";
import type { WorkspaceModules as Flags } from "../../server/src/workspaceContract";
const actor = vi.hoisted(() => ({ editable: true }));
vi.mock("../store", () => ({ useStore: () => ({ data: { currentProjectId: "project-1", currentUserId: "user-1" }, can: () => actor.editable }) }));
import WorkspaceModules from "./WorkspaceModules";
const flags: Flags = { documents: false, objects: true, processes: false, planning: false, files: true };
const show = () => render(<I18nProvider><WorkspaceModules /></I18nProvider>);
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); actor.editable = true; });

test("all workspace modules use switches and save immediately, preserving other flags", async () => {
  vi.spyOn(workspaceApi, "modules").mockResolvedValue(flags);
  const save = vi.spyOn(workspaceApi, "setModules").mockImplementation(async (_project, body) => body);
  const changed = vi.fn(); window.addEventListener("taskira:workspace-modules", changed);
  try {
    show();
    const documents = await screen.findByRole("switch", { name: /^Документы/ });
    expect(screen.getAllByRole("switch")).toHaveLength(5);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(documents);
    await waitFor(() => expect(save).toHaveBeenCalledWith("project-1", { ...flags, documents: true }));
    await waitFor(() => expect(documents.getAttribute("aria-checked")).toBe("true"));
    expect(changed).toHaveBeenCalledOnce();
    expect(screen.getByText("Изменения сохранены")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /^Файлы/ }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith("project-1", { ...flags, documents: true, files: false }));
  } finally { window.removeEventListener("taskira:workspace-modules", changed); }
});

test("failed saves roll back the switch and remain retryable", async () => {
  vi.spyOn(workspaceApi, "modules").mockResolvedValue(flags);
  const save = vi.spyOn(workspaceApi, "setModules").mockRejectedValueOnce(new Error("offline")).mockImplementation(async (_project, body) => body);
  show();
  const documents = await screen.findByRole("switch", { name: /^Документы/ });
  fireEvent.click(documents);
  await screen.findByRole("alert");
  expect(documents.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(documents);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await screen.findByText("Изменения сохранены");
  expect(documents.getAttribute("aria-checked")).toBe("true");
});

test("members without manageWorkspace can read descriptions but cannot toggle", async () => {
  actor.editable = false;
  vi.spyOn(workspaceApi, "modules").mockResolvedValue(flags);
  const save = vi.spyOn(workspaceApi, "setModules");
  show();
  await screen.findByRole("switch", { name: /^Документы/ });
  for (const control of screen.getAllByRole("switch")) {
    expect(control.getAttribute("aria-disabled")).toBe("true"); fireEvent.click(control);
  }
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText(/Модули рабочего пространства включает/)).toBeTruthy();
});
