/** Дашборды (ADR-0022): встроенный обзор проекта, правка и сохранение, права, раздел организации, изоляция
 *  ошибки одного виджета. API — моки той же формы, что у сервера (contract.ts). */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { DashboardDto, DashboardWidget, WidgetDataDto } from "../api";

const { api, store, empty } = vi.hoisted(() => {
  const empty = (w: DashboardWidget): WidgetDataDto => {
    switch (w.type) {
      case "count":
        return { type: "count", value: w.metric === "overdue" ? 4 : 12 };
      case "breakdown":
        return { type: "breakdown", total: 3, items: [{ key: "todo:К выполнению", label: "К выполнению", count: 3, category: "todo" }] };
      case "trend":
        return { type: "trend", weeks: [] };
      case "issues":
        return { type: "issues", items: [], truncated: false };
      default:
        return { type: w.type, items: [] } as WidgetDataDto;
    }
  };

  const api = {
    overview: vi.fn(async (_p: string) => ({ dashboard: null as DashboardDto | null, canEdit: true })),
    saveOverview: vi.fn(async (_p: string, widgets: DashboardWidget[]) => ({ id: "d1", name: "Обзор", kind: "project", projectId: "p1", ownerId: "u1", canEdit: true, widgets, updatedAt: "t" }) as DashboardDto),
    resetOverview: vi.fn(async () => undefined),
    data: vi.fn(async (widgets: DashboardWidget[]) => ({ results: Object.fromEntries(widgets.map((w) => [w.id, empty(w)])) })),
    list: vi.fn(async () => [] as DashboardDto[]),
    create: vi.fn(async (body: { name: string; widgets?: DashboardWidget[] }) => ({ id: "n1", name: body.name, kind: "personal", projectId: null, ownerId: "u1", canEdit: true, widgets: body.widgets ?? [], updatedAt: "t" }) as DashboardDto),
    patch: vi.fn(),
    remove: vi.fn(),
    get: vi.fn(),
  };
  const store = {
    data: { currentProjectId: "p1", projects: [{ id: "p1", key: "CORP", name: "Корп", departmentId: "d1" }], departments: [], users: [] },
    ui: { section: "" },
    me: { id: "u1", globalRole: "member" },
    toast: vi.fn(),
    openIssue: vi.fn(),
    switchProject: vi.fn(),
    setView: vi.fn((_v: string, section?: string) => {
      store.ui.section = section ?? "";
    }),
  };
  return { api, store, empty };
});
vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), dashboardsApi: api }));

vi.mock("../store", () => ({ useStore: () => store }));

import DashboardView from "./DashboardView";

const settle = () => act(async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
});
const show = async (mode: "org" | "project") => {
  render(
    <I18nProvider>
      <DashboardView mode={mode} />
    </I18nProvider>,
  );
  await settle();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 250));
  });
};

beforeEach(() => {
  store.ui.section = "";
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("обзор проекта", () => {
  test("пока не сохранён — встроенный набор с данными с сервера по этому проекту", async () => {
    await show("project");
    expect(screen.getByRole("heading", { name: "Обзор проекта" })).toBeTruthy();
    expect(screen.getByText(/Встроенный набор/)).toBeTruthy();
    expect(api.data).toHaveBeenCalledWith(expect.any(Array), "p1");
    expect(screen.getByRole("heading", { name: "Открытые задачи" })).toBeTruthy();
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
  });

  test("правка: добавить виджет и убрать другой с клавиатуры, «Готово» сохраняет набор", async () => {
    await show("project");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить виджет" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Ближайшие вехи" }));
    const tile = document.querySelector<HTMLElement>('[data-widget="count-open"]')!;
    tile.focus();
    fireEvent.keyDown(tile, { key: "Delete" });
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));
    await settle();
    const saved = api.saveOverview.mock.calls[0][1];
    expect(saved.some((w) => w.type === "milestones")).toBe(true);
    expect(saved.some((w) => w.id === "count-open")).toBe(false);
    expect(store.toast).toHaveBeenCalledWith("success", "Дашборд сохранён");
  });

  test("без права — только просмотр", async () => {
    api.overview.mockResolvedValueOnce({ dashboard: null, canEdit: false });
    await show("project");
    expect(screen.queryByRole("button", { name: "Изменить" })).toBeNull();
  });

  test("ошибка одного виджета не гасит остальные", async () => {
    api.data.mockImplementationOnce(async (widgets: DashboardWidget[]) => ({
      results: Object.fromEntries(widgets.map((w) => [w.id, w.id === "trend" ? ({ type: "error" } as WidgetDataDto) : empty(w)])),
    }));
    await show("project");
    expect(screen.getByText(/Этот виджет не посчитался/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Просрочено" })).toBeTruthy();
  });
});

describe("раздел «Дашборды»", () => {
  test("без id — встроенный обзор; общий заголовок и ссылка на периодный отчёт; правки нет", async () => {
    await show("org");
    expect(store.setView).toHaveBeenCalledWith("dashboards", "overview");
    expect(screen.getByRole("heading", { name: "Обзор организации" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Отчёты и дашборды" })).toBeTruthy();
    const reports = screen.getByRole("link", { name: "Задачи за период" });
    expect(reports.getAttribute("href")).toBe("/reports");
    expect(api.data).toHaveBeenCalledWith(expect.any(Array), undefined);
    expect(screen.queryByRole("button", { name: "Изменить" })).toBeNull();
  });

  test("«Сохранить как свой» создаёт личную копию обзора и открывает её", async () => {
    await show("org");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить как свой" }));
    await settle();
    const body = api.create.mock.calls[0][0];
    expect(body.name).toBe("Обзор организации");
    expect(body.widgets?.some((w) => w.type === "progress")).toBe(true);
    expect(store.setView).toHaveBeenCalledWith("dashboards", "n1");
  });

  test("«+ Дашборд» создаёт из шаблона и открывает", async () => {
    await show("org");
    fireEvent.click(screen.getByRole("button", { name: "Дашборд" }));
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    await settle();
    const body = api.create.mock.calls[0][0];
    expect(body.name).toBe("Портфель проектов");
    expect(body.widgets?.some((w) => w.type === "projects")).toBe(true);
    expect(store.setView).toHaveBeenCalledWith("dashboards", "n1");
  });

  test("чужой или удалённый id — «Дашборд не найден»", async () => {
    store.ui.section = "gone";
    await show("org");
    expect(screen.getByText("Дашборд не найден")).toBeTruthy();
  });
});
