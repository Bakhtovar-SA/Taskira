/** Правка шаблона задачи и переименование пользовательского поля (INVENTORY 1.2 №12–13): действия стора уже были,
 *  интерфейса к ним не было. */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";

const store = {
  data: {
    currentProjectId: "p1",
    project: { key: "CORP", name: "Corp" },
    workflow: { statuses: [{ id: "s1", sid: "todo", name: "К выполнению", category: "todo" }], transitions: [] },
    issueTemplates: [{ id: "t1", name: "Баг-репорт", typeId: "bug", priorityId: "high", title: "Ошибка: ", description: "Шаги", statusId: null, position: 0 }],
    customFields: [{ id: "f1", name: "Клиент", fieldType: "text", options: [], position: 0 }],
  },
  addTransition: vi.fn(),
  removeTransition: vi.fn(),
  resetWorkflow: vi.fn(),
  addIssueTemplate: vi.fn(),
  updateIssueTemplateAction: vi.fn(),
  removeIssueTemplate: vi.fn(),
  addCustomField: vi.fn(),
  renameCustomField: vi.fn(),
  removeCustomField: vi.fn(),
  toast: vi.fn(),
  can: () => true,
  setView: vi.fn(),
};
vi.mock("../store", () => ({ useStore: () => store }));
vi.mock("../issuePages", () => ({ NO_ISSUE_FILTERS: {}, useIssueCounts: () => ({ counts: null }), useIssuesRevision: () => 0 }));

import WorkflowView from "./WorkflowView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const ui = (part: "templates" | "fields") =>
  render(
    <I18nProvider>
      <WorkflowView part={part} />
    </I18nProvider>,
  );

test("шаблон: карандаш загружает его в форму, «Сохранить изменения» зовёт update, а не add", () => {
  ui("templates");
  fireEvent.click(screen.getByRole("button", { name: "Изменить шаблон «Баг-репорт»" }));
  const name = screen.getByDisplayValue("Баг-репорт");
  fireEvent.change(name, { target: { value: "Ошибка" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить изменения" }));
  expect(store.updateIssueTemplateAction).toHaveBeenCalledWith("t1", expect.objectContaining({ name: "Ошибка", typeId: "bug", priorityId: "high", title: "Ошибка: " }));
  expect(store.addIssueTemplate).not.toHaveBeenCalled();
});

test("поле: переименование в строке — Enter сохраняет, Esc отменяет", () => {
  ui("fields");
  fireEvent.click(screen.getByRole("button", { name: "Переименовать поле «Клиент»" }));
  const input = screen.getByRole("textbox", { name: "Переименовать поле «Клиент»" });
  fireEvent.change(input, { target: { value: "Заказчик" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(store.renameCustomField).toHaveBeenCalledWith("f1", "Заказчик");

  fireEvent.click(screen.getByRole("button", { name: "Переименовать поле «Клиент»" }));
  const again = screen.getByRole("textbox", { name: "Переименовать поле «Клиент»" });
  fireEvent.change(again, { target: { value: "Что-то" } });
  fireEvent.keyDown(again, { key: "Escape" });
  expect(store.renameCustomField).toHaveBeenCalledTimes(1);
});
