import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { ReportSummary } from "../api";
import { selectReportProject } from "../reportProjectSelection";

const REPORT: ReportSummary = {
  from: "2026-09-06", to: "2026-10-05", groupBy: "project", projectCount: 2,
  totals: { closed: 17, created: 23, open: 41, overdue: 3, avgLeadDays: 4.5, medianLeadDays: 3 },
  rows: [{ key: "p1", label: "Альфа", closed: 12, created: 15, open: 30, overdue: 2, avgLeadDays: 5 }, { key: "p2", label: "Бета", closed: 5, created: 8, open: 11, overdue: 1, avgLeadDays: null }],
  trend: [{ week: "2026-09-07", closed: 4, created: 7 }, { week: "2026-09-14", closed: 6, created: 8 }, { week: "2026-09-21", closed: 7, created: 8 }],
};
const summary = vi.fn(async (_f: unknown): Promise<ReportSummary> => REPORT);
const downloadReportCsv = vi.fn(async (_f: unknown) => undefined);
vi.mock("../api", async orig => ({ ...(await orig<typeof import("../api")>()), reportsApi: { summary: (f: unknown) => summary(f) }, downloadReportCsv: (f: unknown) => downloadReportCsv(f) }));
const store = { data: { projects: [{ id: "p1", key: "A", name: "Альфа", departmentId: "d1" }, { id: "p2", key: "B", name: "Бета", departmentId: "d2" }, { id: "p3", key: "C", name: "Гамма", departmentId: "d2" }], departments: [{ id: "d1", name: "Продажи" }, { id: "d2", name: "Разработка" }, { id: "d3", name: "Пустой отдел" }] }, toast: vi.fn(), setView: vi.fn() };
vi.mock("../store", () => ({ useStore: () => store }));
vi.mock("../dashboards/DashboardTabs", () => ({ useDashboardList: () => ({ list: [] }), DashboardTabs: ({ actions }: { actions: React.ReactNode }) => <header>{actions}</header> }));
import ReportsView, { previousPeriod } from "./ReportsView";
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); });
const renderReports = async () => { render(<I18nProvider><ReportsView /></I18nProvider>); await settle(); };
const open = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const choose = async (button: string, item: string) => { open(button); await settle(); fireEvent.click(screen.getByRole("menuitem", { name: item, hidden: true })); await settle(); };
const currentCall = () => summary.mock.calls.at(-2)![0] as Record<string, unknown>;
afterEach(() => { cleanup(); vi.clearAllMocks(); summary.mockImplementation(async () => REPORT); });

describe("Reports refresh", () => {
  test("comparison periods are adjacent, inclusive and calendar-correct", () => {
    expect(previousPeriod("2026-09-03", "2026-10-02")).toEqual({ from: "2026-08-04", to: "2026-09-02" });
    expect(previousPeriod("2024-02-29", "2024-02-29")).toEqual({ from: "2024-02-28", to: "2024-02-28" });
    expect(previousPeriod("2026-01-01", "2026-01-30")).toEqual({ from: "2025-12-02", to: "2025-12-31" });
  });
  test("five metrics, two weekly series, overdue per project and equal comparison length", async () => {
    await renderReports();
    const f = currentCall();
    expect((Date.parse(f.to as string) - Date.parse(f.from as string)) / 86400000).toBe(29);
    expect(summary.mock.calls[1][0]).toMatchObject(previousPeriod(f.from as string, f.to as string));
    expect(document.querySelectorAll(".reports-metric")).toHaveLength(5);
    expect(document.querySelectorAll("rect[data-series]")).toHaveLength(6);
    expect(screen.getByText("Альфа")).toBeTruthy();
    expect(screen.getByText("Создано и закрыто по неделям", { selector: "h2" })).toBeTruthy();
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });
  test("presets, optional grouping and project selection reach the API", async () => {
    await renderReports(); open("Квартал"); await settle();
    const f = currentCall(); expect((Date.parse(f.to as string) - Date.parse(f.from as string)) / 86400000).toBe(89);
    await choose("Разбивка", "По исполнителям"); expect(currentCall().groupBy).toBe("assignee");
    open("3 проекта"); fireEvent.click(screen.getByRole("checkbox", { hidden: true, name: "A · Альфа" })); await settle();
    expect(currentCall().projectIds).toBe("p2,p3");
  });
  test("department resets project selection and filters both report and CSV", async () => {
    await renderReports(); await choose("Все отделы", "Разработка");
    expect(currentCall()).toMatchObject({ departmentId: "d2", projectIds: undefined });
    open("2 проекта"); expect(screen.queryByRole("checkbox", { hidden: true, name: "A · Альфа" })).toBeNull();
    expect(screen.getByRole("checkbox", { hidden: true, name: "B · Бета" })).toBeTruthy();
    await choose("Экспорт", "открытые сейчас · CSV");
    expect(downloadReportCsv).toHaveBeenLastCalledWith(expect.objectContaining({ departmentId: "d2", scope: "open" }));
    expect(store.toast).toHaveBeenCalledWith("success", "Выгрузка скачана");
  });
  test("large portfolios use all without IDs or a URL-safe subset of 150", async () => {
    const before = store.data.projects;
    store.data.projects = Array.from({ length: 151 }, (_, n) => ({ id: `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`, key: `P${n}`, name: `Project ${n}`, departmentId: "d1" }));
    try {
      await renderReports();
      expect(currentCall().projectIds).toBeUndefined();
      open("151 проект");
      const all = screen.getByRole("checkbox", { hidden: true, name: "Все доступные проекты" });
      const choices = screen.getAllByRole("checkbox", { hidden: true }).filter(el => el !== all) as HTMLInputElement[];
      expect(choices.every(el => el.disabled)).toBe(true);
      fireEvent.click(all);
      fireEvent.click(choices[0]); await settle();
      expect(currentCall().projectIds).toBe(store.data.projects[0].id);
      const available = store.data.projects.map(p => p.id);
      let selection: string[] | null = [];
      for (const id of available.slice(0, 150)) selection = selectReportProject(selection, available, id, true);
      expect(selection).toHaveLength(150);
      expect(selectReportProject(selection, available, available[150], true)).toBe(selection);
      const ids = selection!.join(",");
      const url = `/api/reports/summary?${new URLSearchParams({ from: "2026-09-01", to: "2026-10-01", groupBy: "project", departmentId: store.data.projects[0].id, projectIds: ids })}`;
      expect(url.length).toBeLessThan(6144);
      fireEvent.click(all); await settle();
      expect(currentCall().projectIds).toBeUndefined();
    } finally { store.data.projects = before; }
  });
  test("load failure can be retried", async () => {
    summary.mockRejectedValueOnce(new Error("сеть")); await renderReports();
    expect(screen.getByRole("alert")).toBeTruthy(); open("Повторить"); await settle();
    expect(screen.getByText("Альфа")).toBeTruthy();
  });
  test("a period without activity hides metrics even with currently open issues", async () => {
    summary.mockImplementation(async () => ({ ...REPORT, totals: { ...REPORT.totals, created: 0, closed: 0 }, trend: [], rows: [] }));
    await renderReports(); expect(screen.getByText("За этот период данных нет")).toBeTruthy();
    expect(document.querySelectorAll(".reports-metric")).toHaveLength(0);
    open("Год"); await settle(); open("Сбросить"); await settle();
    expect(currentCall().projectIds).toBeUndefined();
  });
  test("unavailable comparison does not discard current report or fabricate percentages", async () => {
    summary.mockReset().mockResolvedValueOnce(REPORT).mockRejectedValueOnce(new Error("сеть"));
    await renderReports(); expect(screen.getByText("Альфа")).toBeTruthy();
    expect(screen.getAllByText("Нет данных для сравнения").length).toBeGreaterThan(0);
  });
  test("zero baseline never renders an infinite percentage", async () => {
    summary.mockResolvedValueOnce(REPORT).mockResolvedValueOnce({ ...REPORT, totals: { ...REPORT.totals, closed: 0, created: 0 } });
    await renderReports(); expect(screen.getAllByText("В прошлом периоде: 0")).toHaveLength(2);
  });
  test("a stale response cannot replace the newly selected period", async () => {
    let resolve!: (r: ReportSummary) => void;
    summary.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await renderReports(); open("Квартал"); await settle();
    await act(async () => resolve({ ...REPORT, totals: { ...REPORT.totals, closed: 999 } })); await settle();
    expect(screen.queryByText("999")).toBeNull(); expect(screen.getByText("Альфа")).toBeTruthy();
  });
});
