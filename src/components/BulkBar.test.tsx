import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";

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
