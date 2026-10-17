import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { I18nProvider } from "./i18n";
import { Toasts } from "./ui";
import type { Toast } from "./types";
const state = vi.hoisted(() => ({ toasts: [] as Toast[] }));
vi.mock("./store", () => ({ useToasts: () => state.toasts }));
vi.mock("./motion", () => ({ exit: () => Promise.resolve(), flipFrom: vi.fn(), motionReduced: () => false, preloadMotionIdle: () => () => undefined }));
vi.mock("./ds/floating", () => ({ showPop: vi.fn(), hidePop: vi.fn() }));
afterEach(() => { cleanup(); state.toasts = []; });

test("real Toasts path draws only success and preserves its icon DOM while queue changes", () => {
  state.toasts = [{ id: 1, kind: "success", text: "Saved" }, { id: 2, kind: "error", text: "Failed" }, { id: 3, kind: "info", text: "Notice" }];
  const { container, rerender } = render(<I18nProvider><Toasts /></I18nProvider>);
  const success = container.querySelector('[data-toast-id="1"] .success-check');
  expect(success?.getAttribute("aria-hidden")).toBe("true");
  expect(success?.querySelector("path")?.getAttribute("pathLength")).toBe("1");
  expect(container.querySelectorAll(".success-check")).toHaveLength(1);
  state.toasts = [...state.toasts, { id: 4, kind: "success", text: "Also saved" }];
  rerender(<I18nProvider><Toasts /></I18nProvider>);
  expect(container.querySelector('[data-toast-id="1"] .success-check')).toBe(success);
  expect(container.querySelectorAll(".success-check")).toHaveLength(2);
});
