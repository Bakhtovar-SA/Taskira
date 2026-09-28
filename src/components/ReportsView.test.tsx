/** Характеризация Отчётов (ТЗ 5.12 h, шаг 1 — снята ДО переделки вида): что должно пережить новый вид.
 *  Запрос сводки с периодом/разбивкой/проектом; пресеты периода; плитки и разбивка; выгрузка CSV с тостом;
 *  ошибка с «Повторить»; пустая разбивка со сбросом фильтров. Пресеты периода в новом виде — вкладки (role=tab). */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { ReportSummary } from "../api";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

const REPORT: ReportSummary = {
  from: daysAgo(30),
  to: iso(new Date()),
  groupBy: "project",
  projectCount: 2,
  totals: { closed: 17, created: 23, open: 41, overdue: 3, avgLeadDays: 4.5, medianLeadDays: 3 },
  rows: [
    { key: "p1", label: "Альфа", closed: 12, created: 15, open: 30, avgLeadDays: 5 },
    { key: "p2", label: "Бета", closed: 5, created: 8, open: 11, avgLeadDays: null },
  ],
  trend: [
    { week: "2026-09-07", closed: 4 },
    { week: "2026-09-14", closed: 6 },
    { week: "2026-09-21", closed: 7 },
  ],
};

const summary = vi.fn(async (_f: unknown): Promise<ReportSummary> => REPORT);
const downloadReportCsv = vi.fn(async (_f: unknown) => undefined);
vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  reportsApi: { summary: (f: unknown) => summary(f) },
  downloadReportCsv: (f: unknown) => downloadReportCsv(f),
}));
const store = {
  data: {
    projects: [
      { id: "p1", key: "A", name: "Альфа" },
      { id: "p2", key: "B", name: "Бета" },
    ],
  },
  toast: vi.fn(),
};
vi.mock("../store", () => ({ useStore: () => store }));

import ReportsView from "./ReportsView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  summary.mockImplementation(async () => REPORT);
});
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const renderReports = async () => {
  render(
    <I18nProvider>
      <ReportsView />
    </I18nProvider>,
  );
  await settle();
};
const lastCall = () => summary.mock.calls[summary.mock.calls.length - 1][0] as Record<string, unknown>;

describe("Отчёты", () => {
  test("сводка за 30 дней по проектам: плитки, разбивка, число проектов", async () => {
    await renderReports();
    expect(lastCall()).toEqual({ from: daysAgo(30), to: iso(new Date()), groupBy: "project", projectId: undefined });
    expect(screen.getByText("2 проекта в отчёте")).toBeTruthy();
    for (const n of ["17", "23", "41", "3"]) expect(screen.getAllByText(n).length).toBeGreaterThan(0);
    expect(screen.getByText("Альфа")).toBeTruthy();
    expect(screen.getByText("Бета")).toBeTruthy();
    expect(screen.getByText("Закрытия по неделям")).toBeTruthy();
  });

  test("пресет, разбивка и проект уходят в запрос", async () => {
    await renderReports();
    fireEvent.click(screen.getByRole("tab", { name: "Квартал" }));
    await settle();
    expect(lastCall().from).toBe(daysAgo(90));
    fireEvent.change(screen.getByLabelText("Разбивка"), { target: { value: "assignee" } });
    await settle();
    expect(lastCall().groupBy).toBe("assignee");
    fireEvent.change(screen.getByLabelText("Проект"), { target: { value: "p2" } });
    await settle();
    expect(lastCall().projectId).toBe("p2");
  });

  test("выгрузка CSV: выбранный охват, период и проект; успех — тост", async () => {
    await renderReports();
    fireEvent.change(screen.getByLabelText("Что выгружать"), { target: { value: "open" } });
    fireEvent.click(screen.getByRole("button", { name: /Скачать CSV/ }));
    await settle();
    expect(downloadReportCsv).toHaveBeenCalledWith({ from: daysAgo(30), to: iso(new Date()), scope: "open", projectId: undefined });
    expect(store.toast).toHaveBeenCalledWith("success", "Выгрузка скачана");
  });

  test("ошибка загрузки: сообщение и «Повторить»", async () => {
    summary.mockRejectedValueOnce(new Error("сеть"));
    await renderReports();
    expect(screen.getByText(/Не удалось загрузить отчёт/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await settle();
    expect(screen.getByText("Альфа")).toBeTruthy();
  });

  test("пустая разбивка: пустое состояние, «Сбросить» возвращает 30 дней и все проекты", async () => {
    summary.mockImplementation(async () => ({ ...REPORT, rows: [] }));
    await renderReports();
    fireEvent.click(screen.getByRole("tab", { name: "Год" }));
    fireEvent.change(screen.getByLabelText("Проект"), { target: { value: "p1" } });
    await settle();
    expect(screen.getByText("За этот период данных нет")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Сбросить/ }));
    await settle();
    expect(lastCall()).toMatchObject({ from: daysAgo(30), projectId: undefined });
  });
});
