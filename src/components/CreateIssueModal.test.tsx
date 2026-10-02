import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { lazyWithPreload } from "../lazyModals";
import { I18nProvider } from "../i18n";

const createIssue = vi.fn();
const setCreateOpen = vi.fn();
const data = { issueTemplates: [], users: [], members: [], project: { key: "CORP" } };
vi.mock("../store", () => ({ useStore: () => ({ data, ui: { createParentId: null }, setCreateOpen, createIssue }) }));
vi.mock("../issuePages", () => ({ useIssue: () => null }));
vi.mock("./IssueSearchBox", () => ({ default: () => <input aria-label="Direction search" /> }));
import CreateIssueModal from "./CreateIssueModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (Element.prototype as Partial<Element>).getAnimations;
  delete (Element.prototype as Partial<Element>).scrollIntoView;
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

test("чек-лист расположен после описания и перед приоритетом", () => {
  render(view(true));
  const description = screen.getByPlaceholderText(/Что нужно сделать/);
  const checklist = screen.getByPlaceholderText(/Добавить пункт и нажать Enter/);
  const priority = screen.getByRole("button", { name: /Средний/ });
  expect(description.compareDocumentPosition(checklist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(checklist.compareDocumentPosition(priority) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("направление закрывается кликом снаружи, сохраняя черновик задачи", () => {
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), configurable: true });
  render(view(true));
  const title = screen.getByPlaceholderText(/Экран восстановления пароля/);
  fireEvent.change(title, { target: { value: "Черновик" } });
  const direction = screen.getByRole("button", { name: "Без направления" });
  fireEvent.click(direction);
  expect(direction.getAttribute("aria-expanded")).toBe("true");
  fireEvent.pointerDown(title);
  expect(direction.getAttribute("aria-expanded")).toBe("false");
  expect((title as HTMLInputElement).value).toBe("Черновик");
  expect(setCreateOpen).not.toHaveBeenCalled();
});

test("a deferred first import preserves the real create-modal draft and focus after parent rerenders", async () => {
  let resolve!: (module: { default: typeof CreateIssueModal }) => void;
  const LazyCreate = lazyWithPreload(() => new Promise<{ default: typeof CreateIssueModal }>(done => { resolve = done; }));
  const view = (tick: number) => <I18nProvider><span>{tick}</span><Suspense fallback={<p>loading chunk</p>}><LazyCreate open /></Suspense></I18nProvider>;
  const ui = render(view(0));
  expect(screen.getByText("loading chunk")).toBeTruthy();
  await act(async () => { resolve({ default: CreateIssueModal }); });
  const title = await screen.findByPlaceholderText(/Экран восстановления пароля/);
  title.focus();
  fireEvent.change(title, { target: { value: "Новая задача, черновик" } });
  ui.rerender(view(1));
  ui.rerender(view(2));
  expect(screen.getByPlaceholderText(/Экран восстановления пароля/)).toBe(title);
  expect((title as HTMLInputElement).value).toBe("Новая задача, черновик");
  expect(document.activeElement).toBe(title);
  expect(createIssue).not.toHaveBeenCalled();
});
