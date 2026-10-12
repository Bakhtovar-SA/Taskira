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

test("announces inside the innermost modal, then returns to its parent and the permanent root region", () => {
  const view = (outer: boolean, inner: boolean) => <I18nProvider>
    <Toasts />
    {outer && <Dialog open title="Outer" onClose={() => {}}><input aria-label="Outer input" /></Dialog>}
    {inner && <Dialog open title="Inner" onClose={() => {}}><input aria-label="Inner input" /></Dialog>}
  </I18nProvider>;
  const ui = render(view(false, false));
  const root = screen.getByRole("status");
  ui.rerender(view(true, false));
  const outer = screen.getByRole("dialog", { name: "Outer" }).querySelector("[data-toast-announcer]")!;
  expect(outer.textContent).toBe("");
  state.toasts = [{ id: 1, kind: "success", text: "Copied" }];
  ui.rerender(view(true, false));
  expect(outer.textContent).toContain("Copied");
  expect(root.textContent).toBe("");
  ui.rerender(view(true, true));
  const inner = screen.getByRole("dialog", { name: "Inner" }).querySelector("[data-toast-announcer]")!;
  expect(inner.textContent).toContain("Copied");
  expect(outer.textContent).toBe("");
  ui.rerender(view(true, false));
  expect(outer.textContent).toContain("Copied");
  ui.rerender(view(false, false));
  expect(screen.getByRole("status")).toBe(root);
  expect(root.textContent).toContain("Copied");
});
