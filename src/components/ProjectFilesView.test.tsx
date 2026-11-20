import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, loadLang } from "../i18n";
import { optionLabels } from "../ds/Select.testing";
import type { ProjectFilesResultDto } from "../../server/src/contract";
import { fileQuerySearch, readFileQuery } from "../projectFiles";

const mocks = vi.hoisted(() => ({ list: vi.fn(), download: vi.fn(), openIssue: vi.fn(), toast: vi.fn() }));
vi.mock("../store", () => ({ useStore: () => ({ data: { currentProjectId: "p1" }, openIssue: mocks.openIssue, toast: mocks.toast }) }));
vi.mock("../projectFiles", async original => ({ ...(await original<typeof import("../projectFiles")>()), projectFilesApi: { list: mocks.list } }));
vi.mock("../api", async original => ({ ...(await original<typeof import("../api")>()), attachmentsApi: { download: mocks.download } }));
import ProjectFilesView from "./ProjectFilesView";

const FILES: ProjectFilesResultDto = {
  items: [{ id: "f1", filename: "Проверка портала.pdf", contentType: "application/pdf", byteSize: 2048,
    createdAt: "2026-11-16T10:00:00Z", uploadedById: null, uploaderName: "Анна Соколова", type: "documents",
    issue: { id: "i1", key: "DEMO-12", title: "Проверить портал", archived: true } }],
  total: 1, totalBytes: 2048, limit: 50, offset: 0,
};
beforeEach(() => { localStorage.clear(); history.replaceState(null, "", "/p/DEMO/files"); mocks.list.mockResolvedValue(FILES); mocks.download.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });
const show = () => render(<I18nProvider><ProjectFilesView /></I18nProvider>);

describe("project file catalogue", () => {
  test("English dictionary covers filters, sizes, pagination and errors without translating task data", async () => {
    await loadLang("en");
    localStorage.setItem("taskira.lang", "en");
    mocks.list.mockResolvedValue({ ...FILES, total: 51, items: [{ ...FILES.items[0], uploaderName: null }] });
    mocks.download.mockRejectedValueOnce(new Error("Connection failed"));
    show();
    await screen.findByText("Files: 51 · 2 KB");
    expect(screen.getByRole("heading", { name: "Project files" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeTruthy();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(screen.getByText("Archived task")).toBeTruthy();
    expect(screen.getByText("Author unavailable")).toBeTruthy();
    const type = screen.getByRole("combobox", { name: "File type" });
    expect(optionLabels(type)).toEqual(["All types", "Images", "Documents", "Archives", "Other files"]);
    const sort = screen.getByRole("combobox", { name: "Sort" });
    expect(optionLabels(sort)).toEqual(["Newest first", "Oldest first", "Name", "Largest first"]);
    fireEvent.click(screen.getByRole("button", { name: "Проверка портала.pdf" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "Could not download the file. Try again."));
    fireEvent.click(screen.getByRole("button", { name: "DEMO-12 Проверить портал" }));
    expect(mocks.openIssue).toHaveBeenCalledWith("i1");
  });

  test("downloads using source task permissions and opens its source", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Проверка портала.pdf" }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith("p1", "i1", "f1", "Проверка портала.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "DEMO-12 Проверить портал" }));
    expect(mocks.openIssue).toHaveBeenCalledWith("i1");
    expect(screen.getByText("Архивная задача")).toBeTruthy();
    expect(document.querySelector("select")).toBeNull();
  });
  test("debounces search, resets pagination and keeps an addressable query", async () => {
    history.replaceState(null, "", "/p/DEMO/files?filePage=2&fileType=documents");
    mocks.list.mockResolvedValue({ ...FILES, total: 51, offset: 50 });
    show(); await screen.findByText("Файлов: 51 · 2 КБ");
    expect(mocks.list).toHaveBeenLastCalledWith("p1", expect.objectContaining({ offset: 50 }), expect.any(AbortSignal));
    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск" }), { target: { value: "DEMO-12" } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith("p1", expect.objectContaining({ q: "DEMO-12", type: "documents", offset: 0 }), expect.any(AbortSignal)));
    expect(new URLSearchParams(location.search).get("fileQ")).toBe("DEMO-12");
    expect(new URLSearchParams(location.search).has("filePage")).toBe(false);
  });
  test("shows a real load error with retry, not a misleading empty catalogue", async () => {
    mocks.list.mockRejectedValueOnce(new Error("Connection failed"));
    show(); await screen.findByRole("alert");
    expect(screen.queryByText("В проекте пока нет файлов")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByRole("button", { name: "Проверка портала.pdf" })).toBeTruthy();
  });
  test("ignores a late response after changing the requested catalogue", async () => {
    let finish!: (result: ProjectFilesResultDto) => void;
    mocks.list.mockImplementationOnce(() => new Promise<ProjectFilesResultDto>(resolve => { finish = resolve; }));
    show();
    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск" }), { target: { value: "nothing" } });
    mocks.list.mockResolvedValue({ ...FILES, items: [], total: 0, totalBytes: 0 });
    await screen.findByText("Файлы не найдены");
    await act(async () => { finish(FILES); });
    expect(screen.queryByRole("button", { name: "Проверка портала.pdf" })).toBeNull();
  });
  test("renders unknown authors and hostile file names as text", async () => {
    mocks.list.mockResolvedValue({ ...FILES, items: [{ ...FILES.items[0], filename: "<img src=x onerror=alert(1)>.pdf", uploaderName: null }] });
    show();
    expect(await screen.findByText("<img src=x onerror=alert(1)>.pdf")).toBeTruthy();
    expect(screen.getByText("Автор недоступен")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
  test("each concurrent download stays disabled until its own request finishes", async () => {
    const second = { ...FILES.items[0], id: "f2", filename: "Второй файл.pdf" };
    mocks.list.mockResolvedValue({ ...FILES, items: [...FILES.items, second], total: 2 });
    let finishFirst!: () => void, finishSecond!: () => void;
    mocks.download.mockImplementationOnce(() => new Promise<void>(resolve => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<void>(resolve => { finishSecond = resolve; }));
    show();
    const first = await screen.findByRole<HTMLButtonElement>("button", { name: FILES.items[0].filename });
    const next = screen.getByRole<HTMLButtonElement>("button", { name: second.filename });
    fireEvent.click(first); fireEvent.click(next);
    expect(first.disabled).toBe(true); expect(next.disabled).toBe(true);
    await act(async () => { finishFirst(); });
    expect(first.disabled).toBe(false); expect(next.disabled).toBe(true);
    await act(async () => { finishSecond(); });
    expect(next.disabled).toBe(false);
  });
  test("an obsolete page link returns to the last real page without dropping filters", async () => {
    history.replaceState(null, "", "/p/DEMO/files?filePage=3&fileType=documents&fileQ=portal&issue=DEMO-12");
    mocks.list.mockImplementation(async (_project, query) => query.offset === 100
      ? { ...FILES, items: [], total: 51, offset: 100 }
      : { ...FILES, total: 51, offset: 50 });
    show();
    expect(await screen.findByRole("button", { name: FILES.items[0].filename })).toBeTruthy();
    expect(mocks.list).toHaveBeenLastCalledWith("p1", expect.objectContaining({ q: "portal", type: "documents", offset: 50 }), expect.any(AbortSignal));
    expect(new URLSearchParams(location.search).get("filePage")).toBe("2");
    expect(new URLSearchParams(location.search).get("issue")).toBe("DEMO-12");
    expect(screen.queryByText("Файлы не найдены")).toBeNull();
  });
  test("clearing search returns keyboard focus to the field", async () => {
    history.replaceState(null, "", "/p/DEMO/files?fileQ=portal");
    show(); await screen.findByRole("button", { name: FILES.items[0].filename });
    const clear = screen.getByRole("button", { name: "Очистить поиск" });
    clear.focus(); fireEvent.click(clear);
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Поиск" }));
    expect(new URLSearchParams(location.search).has("fileQ")).toBe(false);
  });
});

test("file URL helpers reject invalid filters and preserve unrelated parameters", () => {
  expect(readFileQuery("?filePage=-1&fileType=unknown&fileSort=wrong")).toMatchObject({ type: "all", sort: "newest", offset: 0 });
  expect(readFileQuery("?filePage=20002").offset).toBe(0);
  const next = new URLSearchParams(fileQuerySearch("?issue=DEMO-1&filePage=3", { q: "Проверка & результат", type: "archives", offset: 0 }));
  expect(next.get("issue")).toBe("DEMO-1"); expect(next.get("fileQ")).toBe("Проверка & результат"); expect(next.has("filePage")).toBe(false);
});
