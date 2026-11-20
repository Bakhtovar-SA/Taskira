import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Popover } from "./Overlay";
import { mockPopoverVisibility } from "./Popover.testing";

vi.mock("./floating", async original => ({
  ...await original<typeof import("./floating")>(),
  useAnchored: () => {},
}));
mockPopoverVisibility();
afterEach(cleanup);

test("an open popover preserves focus across parent callback updates and calls the latest handler", () => {
  const first = vi.fn(), latest = vi.fn();
  const view = (onOpenChange: (open: boolean) => void) => <Popover open label="Editor" onOpenChange={onOpenChange} trigger={() => null}>
    <input aria-label="First field" />
    <button>Current action</button>
  </Popover>;
  const ui = render(view(first));
  const action = screen.getByRole("button", { name: "Current action" });
  action.focus();
  ui.rerender(view(latest));
  expect(document.activeElement).toBe(action);
  expect(first).not.toHaveBeenCalled();
  const closed = new Event("toggle");
  Object.defineProperty(closed, "newState", { value: "closed" });
  fireEvent(screen.getByRole("dialog", { name: "Editor" }), closed);
  expect(latest).toHaveBeenCalledExactlyOnceWith(false);
  expect(first).not.toHaveBeenCalled();
});
