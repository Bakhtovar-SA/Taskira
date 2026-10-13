import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";

const { cancel } = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock("../boardFlip", () => ({ cancelBoardFlip: (o: unknown) => cancel(o) }));

const store = {
  me: { id: "u1", name: "Анна", accessRole: "admin" },
  data: {
    users: [
      { id: "u1", name: "Анна", authSource: "local" },
      { id: "u2", name: "Борис (участник)", authSource: "local" },
      { id: "u3", name: "Администратор (не в проекте)", authSource: "local" },
      { id: "u4", name: "Сервисный токен", authSource: "service" },
    ],
    members: { u1: "admin", u2: "employee", u4: "employee" },
    workflow: { statuses: [] },
  },
  can: () => true,
  bulkApplyIssueAction: vi.fn(),
};
vi.mock("../store", () => ({ useStore: () => store }));
import BulkBar from "./BulkBar";

afterEach(cleanup);

test("массовое назначение предлагает только участников проекта (не всех пользователей, не сервисные)", () => {
  render(
    <I18nProvider>
      <BulkBar selectedIds={new Set(["a"])} onDone={() => undefined} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Исполнитель/ }));
  // jsdom без Popover API: содержимое меню скрыто, ищем с hidden: true.
  const items = screen.getAllByRole("menuitem", { hidden: true }).map((e) => e.textContent ?? "");
  expect(items.some((t) => t.includes("Борис (участник)"))).toBe(true);
  expect(items.some((t) => t.includes("Анна"))).toBe(true);
  expect(items.some((t) => t.includes("не в проекте"))).toBe(false);
  expect(items.some((t) => t.includes("Сервисный токен"))).toBe(false);
});


test("массовая смена статуса на доске: снимок перед запросом; отказ — снимок отменяется", async () => {
  store.data.workflow = { statuses: [{ id: "s1", sid: "todo", name: "К выполнению", category: "todo", position: 0 }] } as never;
  const snap = {};
  const before = vi.fn(() => snap);
  store.bulkApplyIssueAction.mockResolvedValueOnce({ succeeded: [], failed: [{ issueId: "a", reason: "x" }] });
  render(
    <I18nProvider>
      <BulkBar selectedIds={new Set(["a"])} onDone={() => undefined} onBeforeStatus={before} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Статус/ }));
  fireEvent.click(screen.getAllByRole("menuitem", { hidden: true }).find((e) => e.textContent?.includes("К выполнению"))!);
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith(snap));
  expect(before).toHaveBeenCalledTimes(1);

  cancel.mockClear();
  store.bulkApplyIssueAction.mockResolvedValueOnce({ succeeded: ["a"], failed: [] });
  fireEvent.click(screen.getByRole("button", { name: /Статус/ }));
  fireEvent.click(screen.getAllByRole("menuitem", { hidden: true }).find((e) => e.textContent?.includes("К выполнению"))!);
  await vi.waitFor(() => expect(store.bulkApplyIssueAction).toHaveBeenCalledTimes(2));
  await act(async () => {}); // run() дошёл до конца: после успешного ответа снимок остаётся
  expect(before).toHaveBeenCalledTimes(2);
  expect(cancel).not.toHaveBeenCalled();
});
