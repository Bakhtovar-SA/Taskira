import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Combobox, type ComboOption } from "./Combobox";

afterEach(() => { cleanup(); vi.useRealTimers(); });
test("controlled selection updates its label and restores unselected text on blur", () => {
  const load = vi.fn(async () => []), selected = vi.fn();
  const view = render(<Combobox label="Zone" load={load} onSelect={selected} value={{ id: "UTC", label: "UTC" }} />);
  const input = screen.getByRole("combobox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Unselected zone" } }); expect(input.value).toBe("Unselected zone");
  fireEvent.blur(input); expect(input.value).toBe("UTC"); expect(selected).not.toHaveBeenCalled();
  view.rerender(<Combobox label="Zone" load={load} onSelect={selected} value={{ id: "Asia/Tashkent", label: "Asia/Tashkent" }} />);
  expect(input.value).toBe("Asia/Tashkent");
});

test.each([0, 200, 1000])("Enter cannot select previous results during a new search (%i ms)", async latency => {
  vi.useFakeTimers();
  const selected = vi.fn();
  const load = vi.fn((q: string) => new Promise<ComboOption[]>(resolve => {
    setTimeout(() => resolve(q ? [{ id: "igor", label: "Igor" }] : [{ id: "anna", label: "Anna" }]), latency);
  }));
  render(<Combobox label="Assignee" load={load} onSelect={selected} />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  await act(async () => { await vi.advanceTimersByTimeAsync(201 + latency); });
  expect(screen.getByRole("option", { name: "Anna", hidden: true })).toBeTruthy();
  fireEvent.change(input, { target: { value: "Igor" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(selected).not.toHaveBeenCalled();
  expect(input.getAttribute("aria-activedescendant")).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(201 + latency); });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(selected).toHaveBeenCalledWith({ id: "igor", label: "Igor" });
});

test("late responses and below-minimum queries cannot repopulate selectable options", async () => {
  vi.useFakeTimers();
  const pending: Record<string, (items: ComboOption[]) => void> = {};
  const load = vi.fn((q: string) => new Promise<ComboOption[]>(resolve => { pending[q] = resolve; }));
  const selected = vi.fn();
  render(<Combobox label="Search" minChars={2} load={load} onSelect={selected} />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "old" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  fireEvent.change(input, { target: { value: "new" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  await act(async () => { pending.new([{ id: "new", label: "New" }]); });
  await act(async () => { pending.old([{ id: "old", label: "Old" }]); });
  expect(screen.queryByRole("option", { name: "Old", hidden: true })).toBeNull();
  fireEvent.change(input, { target: { value: "x" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(selected).not.toHaveBeenCalled();
  expect(screen.queryAllByRole("option", { hidden: true })).toHaveLength(0);
});
