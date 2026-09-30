import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";

const createIssue = vi.fn();
const setCreateOpen = vi.fn();
const data = { issueTemplates: [], users: [], members: [], project: { key: "CORP" } };
vi.mock("../store", () => ({ useStore: () => ({ data, ui: { createParentId: null }, setCreateOpen, createIssue }) }));
vi.mock("../issuePages", () => ({ useIssue: () => null }));
import CreateIssueModal from "./CreateIssueModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (Element.prototype as Partial<Element>).getAnimations;
});

const view = (open: boolean) => (
  <I18nProvider>
    <CreateIssueModal open={open} />
  </I18nProvider>
);

test("пока окно уходит с анимацией, второй Enter или клик «Создать задачу» не создают дубль", () => {
  // Окно остаётся на экране на время ухода только там, где есть анимации (в jsdom их нет — подставляем).
  (Element.prototype as { getAnimations?: () => Animation[] }).getAnimations = () => [];
  const { rerender } = render(view(true));
  const title = screen.getByPlaceholderText(/Экран восстановления пароля/);
  fireEvent.change(title, { target: { value: "Задача" } });
  fireEvent.keyDown(title, { key: "Enter" });
  expect(createIssue).toHaveBeenCalledTimes(1);
  expect(setCreateOpen).toHaveBeenCalledWith(false);

  rerender(view(false)); // родитель закрыл окно, Presence держит его на время анимации
  expect(document.querySelector("dialog[data-closing]")).toBeTruthy();
  fireEvent.keyDown(title, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "Создать задачу" }));
  expect(createIssue).toHaveBeenCalledTimes(1);
});
