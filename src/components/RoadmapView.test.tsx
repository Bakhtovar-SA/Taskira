/** Роадмап проектов (ТЗ 5.15): группы по отделам, полосы с датами и без, вехи, линии зависимостей (красная —
 *  источник не успевает), клик — в проект его представлением по умолчанию, шестерёнка — к «Срокам и вехам». */
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { RoadmapDto } from "../../server/src/contract";

const ROADMAP: RoadmapDto = {
  projects: [
    { id: "a", key: "ALP", name: "Альфа", departmentId: "d1", icon: null, color: "teal", createdAt: "2026-01-01", startDate: "2026-09-01", targetDate: "2026-10-31", done: 3, total: 4, milestones: [{ id: "m1", name: "Бета-релиз", date: "2026-10-10" }], canEdit: true },
    { id: "b", key: "BET", name: "Бета", departmentId: "d1", icon: null, color: null, createdAt: "2026-01-01", startDate: "2026-10-15", targetDate: "2026-12-01", done: 0, total: 2, milestones: [], canEdit: false },
    { id: "c", key: "GAM", name: "Гамма", departmentId: "d2", icon: null, color: null, createdAt: "2026-01-01", startDate: null, targetDate: null, done: 0, total: 0, milestones: [], canEdit: false },
  ],
  dependencies: [{ sourceId: "a", dependentId: "b" }],
};
const get = vi.fn(async (): Promise<RoadmapDto> => ROADMAP);
vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), roadmapApi: { get: () => get() } }));
const store = {
  data: {
    currentProjectId: "a",
    departments: [
      { id: "d1", name: "Разработка" },
      { id: "d2", name: "Маркетинг" },
    ],
    projects: [
      { id: "a", key: "ALP", defaultView: null },
      { id: "b", key: "BET", defaultView: "backlog" },
      { id: "c", key: "GAM", defaultView: null },
    ],
  },
  setView: vi.fn(),
  switchProject: vi.fn(),
};
vi.mock("../store", () => ({ useStore: () => store }));

import RoadmapView from "./RoadmapView";

// jsdom не знает ResizeObserver, которым роадмап (как и Таймлайн) следит за шириной панели.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const renderIt = async () => {
  render(
    <I18nProvider>
      <RoadmapView />
    </I18nProvider>,
  );
  await settle();
};

test("отделы, полосы, «сроки не заданы», вехи и зависимость", async () => {
  await renderIt();
  expect(screen.getByText("Маркетинг · 1")).toBeTruthy();
  expect(screen.getByText("Разработка · 2")).toBeTruthy();
  // Полоса — кнопка с понятной подписью: даты, прогресс, кого ждёт.
  expect(screen.getByRole("button", { name: /^Альфа · .* · закрыто 3 из 4 задач$/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Бета · .* ждёт: Альфа$/ })).toBeTruthy();
  expect(screen.getByText("Сроки не заданы")).toBeTruthy();
  expect(screen.getByText("Бета-релиз")).toBeTruthy();
  // Альфа заканчивается 31.10, Бета начинается 15.10 — линия красная.
  const path = document.querySelector("svg path.stroke-\\[var\\(--status-danger\\)\\]");
  expect(path?.getAttribute("marker-end")).toBe("url(#rm-arrow-late)");
});

test("клик по полосе — в проект его представлением по умолчанию; шестерёнка — только с правом", async () => {
  await renderIt();
  fireEvent.click(screen.getByRole("button", { name: /^Бета · / }));
  expect(store.setView).toHaveBeenCalledWith("backlog");
  expect(store.switchProject).toHaveBeenCalledWith("b");

  const edit = screen.getAllByRole("button", { name: /^Сроки и вехи проекта/ });
  expect(edit).toHaveLength(1);
  fireEvent.click(edit[0]!);
  expect(store.setView).toHaveBeenLastCalledWith("projectSettings", "roadmap");
});

test("ошибка загрузки — «Повторить»", async () => {
  get.mockRejectedValueOnce(new Error("нет связи"));
  await renderIt();
  expect(screen.getByText("Не удалось загрузить роадмап")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  await settle();
  expect(screen.getByText("Разработка · 2")).toBeTruthy();
});
