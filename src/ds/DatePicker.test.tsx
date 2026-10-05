import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DatePicker } from "./DatePicker";

afterEach(cleanup);

test.each([
  ["2026-10-15", "2026-10-16"],
  ["2026-10-31", "2026-11-01"],
])("keyboard focus reaches %s → %s before the next animation frame", (start, next) => {
  // A fast subsequent keypress must not depend on an animation callback running first.
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  const changed = vi.fn();
  const { container } = render(<DatePicker value={start} onChange={changed} label="Срок" today="2026-10-01" />);
  const trigger = screen.getByRole("button", { name: /^Срок:/ });
  fireEvent.click(trigger);
  const current = container.querySelector<HTMLButtonElement>(`[data-iso="${start}"]`)!;
  current.focus();
  fireEvent.keyDown(current, { key: "ArrowRight" });
  const target = container.querySelector<HTMLButtonElement>(`[data-iso="${next}"]`)!;
  expect(document.activeElement).toBe(target);
  expect(target.tabIndex).toBe(0);
  fireEvent.click(target);
  expect(changed).toHaveBeenCalledWith(next);
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect(container.querySelector(`[data-iso="${start}"]`)?.getAttribute("tabindex")).toBe("0");
  // jsdom does not implement the native top layer, so query the labelled input directly.
  expect(document.activeElement).toBe(screen.getByLabelText("Срок", { selector: "input" }));
});
