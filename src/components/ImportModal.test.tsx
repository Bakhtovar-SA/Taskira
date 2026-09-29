import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { CreateInput } from "../store/mappers";

const importIssues = vi.fn(async (..._args: unknown[]) => ({ ok: 1, failed: 0, cancelled: false }));
vi.mock("../store", () => ({ useStore: () => ({ importIssues }) }));
import ImportModal from "./ImportModal";

const jira = readFileSync("src/import/__fixtures__/jira.csv", "utf8");
const asana = readFileSync("src/import/__fixtures__/asana.csv", "utf8");

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

test("source selection, counts, closed toggle and CreateInput mapping", async () => {
  render(<I18nProvider><ImportModal onClose={() => {}} /></I18nProvider>);
  const source = screen.getByLabelText("Источник");
  fireEvent.change(source, { target: { value: "jira" } });
  const file = screen.getByLabelText(/Файл экспорта/);
  expect(file.getAttribute("accept")).toContain(".csv");
  fireEvent.change(file, { target: { files: [new File([jira], "jira.csv", { type: "text/csv" })] } });
  await waitFor(() => expect(screen.getByText(/Найдено задач: 9/)).toBeTruthy());
  expect(screen.getByText(/Пропущено без названия: 1/)).toBeTruthy();
  expect(screen.getByText(/Сроков не распознано: 1/)).toBeTruthy();
  expect(screen.getByText(/Будет создано: 7/)).toBeTruthy();
  expect(screen.getByText(/они будут созданы как открытые/)).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByText(/Будет создано: 9/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Импортировать/ }));
  await waitFor(() => expect(importIssues).toHaveBeenCalledTimes(1));
  const inputs = importIssues.mock.calls[0][0] as CreateInput[];
  expect(inputs[0]).toMatchObject({ title: "Fix login", typeId: "bug", priorityId: "critical", dueDate: "2026-09-29", assigneeIds: [] });
  expect(inputs).toHaveLength(9);
  await waitFor(() => expect(screen.getByText(/Импортировано 1 из 1/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Импортировать/ }));
  expect(importIssues).toHaveBeenCalledTimes(1);
});

test("switching source clears prior preview and parses Asana", async () => {
  render(<I18nProvider><ImportModal onClose={() => {}} /></I18nProvider>);
  const source = screen.getByLabelText("Источник");
  fireEvent.change(source, { target: { value: "asana" } });
  fireEvent.change(screen.getByLabelText(/Файл экспорта/), { target: { files: [new File([asana], "asana.csv", { type: "text/csv" })] } });
  await waitFor(() => expect(screen.getByText(/Найдено задач: 7/)).toBeTruthy());
  expect(screen.getByText(/Будет создано: 5/)).toBeTruthy();
  fireEvent.change(source, { target: { value: "trello" } });
  expect(screen.queryByText(/Найдено задач/)).toBeNull();
  expect(screen.getByLabelText(/Файл экспорта/).getAttribute("accept")).toContain(".json");
});

test("file size limit prevents reading", async () => {
  render(<I18nProvider><ImportModal onClose={() => {}} /></I18nProvider>);
  const tooLarge = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.json");
  fireEvent.change(screen.getByLabelText(/Файл экспорта/), { target: { files: [tooLarge] } });
  expect(screen.getByRole("alert").textContent).toContain("20 МБ");
});

test("cancelled result shows partial creation instead of a completed import", async () => {
  importIssues.mockResolvedValueOnce({ ok: 1, failed: 0, cancelled: true });
  render(<I18nProvider><ImportModal onClose={() => {}} /></I18nProvider>);
  const board = JSON.stringify({ name: "Board", lists: [], cards: [{ id: "1", name: "A" }, { id: "2", name: "B" }] });
  fireEvent.change(screen.getByLabelText(/Файл экспорта/), { target: { files: [new File([board], "board.json", { type: "application/json" })] } });
  await waitFor(() => expect(screen.getByText(/Будет создано: 2/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Импортировать/ }));
  await waitFor(() => expect(screen.getByText(/Импорт остановлен: 1 из 2/)).toBeTruthy());
});

test("preview warns when a long Jira description was shortened", async () => {
  render(<I18nProvider><ImportModal onClose={() => {}} /></I18nProvider>);
  fireEvent.change(screen.getByLabelText("Источник"), { target: { value: "jira" } });
  const csv = `Summary,Description,Issue key\nIssue,${"x".repeat(5100)},APP-99`;
  fireEvent.change(screen.getByLabelText(/Файл экспорта/), { target: { files: [new File([csv], "jira.csv", { type: "text/csv" })] } });
  await waitFor(() => expect(screen.getByText(/Длинные описания сокращены: 1/)).toBeTruthy());
});
