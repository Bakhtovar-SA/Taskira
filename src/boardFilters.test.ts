import { describe, expect, test } from "vitest";
import {
  DONE_WINDOW_DAYS,
  NO_ONE,
  boardFilterParams,
  columnFilterParams,
  columnTotal,
  effectiveAssignee,
  hasBoardFilters,
  hiddenDoneCount,
  openTotal,
  type BoardFilterState,
  type QuickChip,
} from "./boardFilters";

const state = (over: Partial<Omit<BoardFilterState, "chips">> & { chips?: QuickChip[] } = {}): BoardFilterState => ({
  filterUser: null,
  q: "",
  currentUserId: "me",
  ...over,
  chips: new Set(over.chips ?? []),
});

describe("effectiveAssignee — аватар и чипы сводятся к одному параметру сервера", () => {
  test("ничего не выбрано — фильтра нет", () => {
    expect(effectiveAssignee(state())).toBeUndefined();
  });
  test("аватар сам по себе, «Мои» сами по себе, «Без исполнителя» сам по себе", () => {
    expect(effectiveAssignee(state({ filterUser: "u7" }))).toBe("u7");
    expect(effectiveAssignee(state({ filterUser: "none" }))).toBe("none");
    expect(effectiveAssignee(state({ chips: ["mine"] }))).toBe("me");
    expect(effectiveAssignee(state({ chips: ["unassigned"] }))).toBe("none");
  });
  test("совпадающие условия — то же значение (аватар «я» + «Мои»)", () => {
    expect(effectiveAssignee(state({ filterUser: "me", chips: ["mine"] }))).toBe("me");
    expect(effectiveAssignee(state({ filterUser: "none", chips: ["unassigned"] }))).toBe("none");
  });
  test("противоречащие условия дают пустой набор, как прежнее И над загруженным", () => {
    expect(effectiveAssignee(state({ filterUser: "u7", chips: ["mine"] }))).toBe(NO_ONE);
    expect(effectiveAssignee(state({ chips: ["mine", "unassigned"] }))).toBe(NO_ONE);
    expect(effectiveAssignee(state({ filterUser: "u7", chips: ["unassigned"] }))).toBe(NO_ONE);
  });
});

describe("boardFilterParams", () => {
  test("поиск и «Просроченные» уходят на сервер, пустое не попадает в запрос", () => {
    expect(boardFilterParams(state())).toEqual({ assignee: undefined, q: undefined, overdue: undefined });
    expect(boardFilterParams(state({ q: "отчёт", chips: ["overdue"], filterUser: "u1" }))).toEqual({
      assignee: "u1",
      q: "отчёт",
      overdue: "1",
    });
  });
  test("hasBoardFilters", () => {
    expect(hasBoardFilters(state())).toBe(false);
    expect(hasBoardFilters(state({ q: "x" }))).toBe(true);
    expect(hasBoardFilters(state({ chips: ["overdue"] }))).toBe(true);
    expect(hasBoardFilters(state({ filterUser: "u1" }))).toBe(true);
  });
});

describe("columnFilterParams", () => {
  const base = { assignee: "u1", q: "a" };
  test("обычная колонка: только статус", () => {
    expect(columnFilterParams(base, "s1", { isDone: false, showAllDone: false })).toEqual({
      assignee: "u1",
      q: "a",
      status: "s1",
      closed: undefined,
      closedDays: undefined,
    });
  });
  test("«Готово» по умолчанию — закрытое за окно; «показать всё» окно снимает", () => {
    expect(columnFilterParams(base, "d", { isDone: true, showAllDone: false })).toMatchObject({
      status: "d",
      closed: "recent",
      closedDays: DONE_WINDOW_DAYS,
    });
    expect(columnFilterParams(base, "d", { isDone: true, showAllDone: true })).toMatchObject({ closed: undefined });
  });
});

describe("счётчики колонок — реальное число, а не число загруженного", () => {
  const all = { total: 5300, byStatus: { todo: 3000, wip: 1500, done: 800 } };
  const older = { total: 600, byStatus: { done: 600 } };
  test("обычная колонка: значение сервера", () => {
    expect(columnTotal(all, older, "todo", { isDone: false, showAllDone: false })).toBe(3000);
    expect(columnTotal(all, null, "wip", { isDone: false, showAllDone: false })).toBe(1500);
  });
  test("«Готово»: из всего вычитается спрятанное окном", () => {
    expect(columnTotal(all, older, "done", { isDone: true, showAllDone: false })).toBe(200);
    expect(hiddenDoneCount(older, "done", { isDone: true, showAllDone: false })).toBe(600);
  });
  test("«показать всё закрытое»: полное число, ничего не спрятано", () => {
    expect(columnTotal(all, older, "done", { isDone: true, showAllDone: true })).toBe(800);
    expect(hiddenDoneCount(older, "done", { isDone: true, showAllDone: true })).toBe(0);
  });
  test("до ответа сервера — null, а не 0 (нет ложного «пусто»)", () => {
    expect(columnTotal(null, null, "todo", { isDone: false, showAllDone: false })).toBeNull();
    expect(columnTotal(all, null, "done", { isDone: true, showAllDone: false })).toBeNull();
    expect(hiddenDoneCount(null, "done", { isDone: true, showAllDone: false })).toBe(0);
  });
  test("статуса нет в ответе — 0, вычитание не уходит в минус", () => {
    expect(columnTotal(all, null, "review", { isDone: false, showAllDone: false })).toBe(0);
    expect(columnTotal({ total: 1, byStatus: { done: 1 } }, { total: 5, byStatus: { done: 5 } }, "done", { isDone: true, showAllDone: false })).toBe(0);
  });
  test("openTotal: сумма по незакрытым статусам", () => {
    expect(openTotal(all, new Set(["done"]))).toBe(4500);
    expect(openTotal({ total: 2, byStatus: { done: 2 } }, new Set(["done"]))).toBe(0);
    expect(openTotal(null, new Set(["done"]))).toBeNull();
  });
});
