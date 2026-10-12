import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "./i18n";
import type { Toast } from "./types";
import { Toasts } from "./ui";
import { Dialog } from "./ds/Dialog";
import { NATIVE_DIALOG_OPEN_EVENT } from "./ds/topLayer";

const state = vi.hoisted(() => ({ toasts: [] as Toast[] }));
vi.mock("./store", () => ({ useToasts: () => state.toasts }));
afterEach(() => { cleanup(); state.toasts = []; vi.restoreAllMocks(); });

test("permanent announcer and visual host survive queue updates; dialogs raise the host and cleanup removes listeners", () => {
  const open = new WeakSet<HTMLElement>();
  const show = vi.fn(function (this: HTMLElement) { open.add(this); });
  const hide = vi.fn(function (this: HTMLElement) { open.delete(this); });
  const nativeMatches = HTMLElement.prototype.matches;
  vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (this: HTMLElement, selector) {
    return selector === ":popover-open" ? open.has(this) : nativeMatches.call(this, selector);
  });
  Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: show });
  Object.defineProperty(HTMLElement.prototype, "hidePopover", { configurable: true, value: hide });
  try {
    const view = () => <StrictMode><I18nProvider><Toasts /></I18nProvider></StrictMode>;
    const ui = render(view());
    const region = screen.getByRole("status");
    const host = ui.container.querySelector<HTMLElement>("[popover]")!;
    expect(region.textContent).toBe("");
    expect(open.has(host)).toBe(true);
    show.mockClear(); hide.mockClear();
    state.toasts = [{ id: 1, kind: "success", text: "Copied" }];
    ui.rerender(view());
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toContain("Copied");
    state.toasts = [...state.toasts, { id: 2, kind: "info", text: "Saved" }];
    ui.rerender(view());
    state.toasts = [];
    ui.rerender(view());
    expect(open.has(host)).toBe(true);
    expect(show).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
    const dialog = document.createElement("dialog");
    document.dispatchEvent(new CustomEvent(NATIVE_DIALOG_OPEN_EVENT, { detail: dialog }));
    expect(show).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(1);
    ui.unmount();
    expect(open.has(host)).toBe(false);
    document.dispatchEvent(new CustomEvent(NATIVE_DIALOG_OPEN_EVENT, { detail: dialog }));
    expect(show).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(2);
  } finally {
    cleanup();
    Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
    Reflect.deleteProperty(HTMLElement.prototype, "hidePopover");
  }
});

test("host changes announce only new toast IDs, without replaying visible messages", () => {
  const view = (outer: boolean, inner: boolean) => <I18nProvider>
    <Toasts />
    {outer && <Dialog open title="Outer" onClose={() => {}}><input aria-label="Outer input" /></Dialog>}
    {inner && <Dialog open title="Inner" onClose={() => {}}><input aria-label="Inner input" /></Dialog>}
  </I18nProvider>;
  const ui = render(view(false, false));
  const rootSlot = screen.getByRole("status", { name: "Уведомления" }).parentElement;
  ui.rerender(view(true, false));
  const outer = screen.getByRole("dialog", { name: "Outer" }).querySelector("[data-toast-announcer]")!;
  expect(outer.textContent).toBe("");
  state.toasts = [{ id: 1, kind: "success", text: "Copied" }];
  ui.rerender(view(true, false));
  expect(outer.textContent).toContain("Copied");
  ui.rerender(view(true, true));
  const inner = screen.getByRole("dialog", { name: "Inner" }).querySelector("[data-toast-announcer]")!;
  expect(inner.textContent).toBe("");
  expect(outer.childElementCount).toBe(0);
  state.toasts = [...state.toasts, { id: 2, kind: "info", text: "Saved" }];
  ui.rerender(view(true, true));
  expect(inner.textContent).toContain("Saved");
  expect(inner.textContent).not.toContain("Copied");
  ui.rerender(view(true, false));
  expect(outer.textContent).toBe("");
  state.toasts = [...state.toasts, { id: 3, kind: "success", text: "Updated" }];
  ui.rerender(view(true, false));
  expect(outer.textContent).toContain("Updated");
  expect(outer.textContent).not.toMatch(/Copied|Saved/);
  ui.rerender(view(false, false));
  const root = screen.getByRole("status", { name: "Уведомления" });
  expect(root.parentElement).toBe(rootSlot);
  expect(root.textContent).toBe("");
  state.toasts = [...state.toasts, { id: 4, kind: "error", text: "Failed" }];
  ui.rerender(view(false, false));
  expect(root.textContent).toContain("Failed");
  expect(root.textContent).not.toMatch(/Copied|Saved|Updated/);
  state.toasts = [];
  ui.rerender(view(false, false));
  expect(root.textContent).toBe("");
});

test("a dialog without Toasts has no empty status region, and unmounting Toasts removes its live region", () => {
  const view = (toasts: boolean) => <I18nProvider>
    <Dialog open title="Standalone" onClose={() => {}}><input aria-label="Title" /></Dialog>
    {toasts && <Toasts />}
  </I18nProvider>;
  const ui = render(view(false));
  const slot = screen.getByRole("dialog").querySelector("[data-toast-announcer]")!;
  expect(screen.queryByRole("status")).toBeNull();
  expect(slot.childElementCount).toBe(0);
  expect(slot.getAttribute("aria-live")).toBeNull();
  ui.rerender(view(true));
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status").parentElement).toBe(slot);
  ui.rerender(view(false));
  expect(screen.queryByRole("status")).toBeNull();
  expect(slot.childElementCount).toBe(0);
});

test("a toast arriving with a new dialog is announced once inside that dialog", () => {
  const view = (open: boolean) => <I18nProvider>
    <Toasts />
    {open && <Dialog open title="New modal" onClose={() => {}}><input aria-label="Title" /></Dialog>}
  </I18nProvider>;
  const ui = render(view(false));
  state.toasts = [{ id: 1, kind: "success", text: "Saved with dialog" }];
  ui.rerender(view(true));
  const region = screen.getByRole("status", { name: "Уведомления" });
  expect(screen.getByRole("dialog").contains(region)).toBe(true);
  expect(region.textContent).toContain("Saved with dialog");
  ui.rerender(view(true));
  expect(region.children).toHaveLength(1);
});

test("unsupported popover selectors do not break dialog announcements or cleanup", () => {
  const nativeMatches = HTMLElement.prototype.matches;
  vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (this: HTMLElement, selector) {
    if (selector === ":popover-open") throw new DOMException("Unsupported selector", "SyntaxError");
    return nativeMatches.call(this, selector);
  });
  const view = (open: boolean) => <I18nProvider>
    <Toasts />
    {open && <Dialog open title="Fallback" onClose={() => {}}><input aria-label="Title" /></Dialog>}
  </I18nProvider>;
  const ui = render(view(false));
  state.toasts = [{ id: 1, kind: "success", text: "Saved" }];
  ui.rerender(view(true));
  state.toasts = [...state.toasts, { id: 2, kind: "info", text: "New message" }];
  ui.rerender(view(true));
  expect(screen.getByRole("status", { name: "Уведомления" }).textContent).toContain("New message");
  expect(() => ui.unmount()).not.toThrow();
});
