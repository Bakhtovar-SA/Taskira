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

test("clearing a controlled value also clears the old displayed selection", () => {
  const load = vi.fn(async () => []), onSelect = vi.fn();
  const view = render(<Combobox label="Zone" load={load} onSelect={onSelect} value={{ id: "UTC", label: "UTC" }} />);
  const input = screen.getByRole<HTMLInputElement>("combobox");
  view.rerender(<Combobox label="Zone" load={load} onSelect={onSelect} value={null} />);
  expect(input.value).toBe("");
  expect(onSelect).not.toHaveBeenCalled();
});

test("a multi-selection search stays clear after a controlled update and blur", () => {
  const load = vi.fn(async () => []), onSelect = vi.fn();
  const view = render(<Combobox label="People" clearOnSelect load={load} onSelect={onSelect} value={{ id: "anna", label: "Anna" }} />);
  const input = screen.getByRole<HTMLInputElement>("combobox");
  expect(input.value).toBe("");
  view.rerender(<Combobox label="People" clearOnSelect load={load} onSelect={onSelect} value={{ id: "boris", label: "Boris" }} />);
  fireEvent.blur(input);
  expect(input.value).toBe("");
});
test("opening a selected picker browses all options, then filters typed text", async () => {
  vi.useFakeTimers(); const load = vi.fn(async () => [{ id: "UTC", label: "UTC" }, { id: "Asia/Tashkent", label: "Asia/Tashkent" }]);
  const selected = vi.fn(); render(<Combobox label="Zone" load={load} onSelect={selected} value={{ id: "Asia/Tashkent", label: "Asia/Tashkent" }} />);
  const input = screen.getByRole("combobox"); fireEvent.focus(input);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); }); expect(load).toHaveBeenLastCalledWith("");
  expect(screen.getByRole("option", { name: "Asia/Tashkent", hidden: true })).toBeTruthy();
  fireEvent.keyDown(input, { key: "Enter" }); expect(selected).toHaveBeenCalledWith({ id: "Asia/Tashkent", label: "Asia/Tashkent" });
  selected.mockClear(); fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Asia" } }); fireEvent.keyDown(input, { key: "Enter" }); expect(selected).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(200); }); expect(load).toHaveBeenLastCalledWith("Asia");
});
test("adding whitespace while a request is pending still supplies current options", async () => {
  vi.useFakeTimers(); const load = vi.fn(async () => [{ id: "anna", label: "Anna" }]);
  render(<Combobox label="Assignee" load={load} onSelect={vi.fn()} />); const input = screen.getByRole("combobox");
  fireEvent.focus(input); fireEvent.change(input, { target: { value: "Anna" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  fireEvent.change(input, { target: { value: "Anna " } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(load).toHaveBeenLastCalledWith("Anna"); expect(screen.getByRole("option", { name: "Anna", hidden: true })).toBeTruthy();
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

test("keyboard navigation keeps the active option inside a scrolled list", async () => {
  vi.useFakeTimers();
  const load = vi.fn(async () => ["Anna", "Boris", "Vera"].map(id => ({ id, label: id })));
  render(<Combobox label="Assignee" load={load} onSelect={vi.fn()} />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  const rows = screen.getAllByRole("option", { hidden: true });
  const popup = rows[0].closest<HTMLElement>("[popover]")!;
  Object.defineProperty(popup, "clientHeight", { value: 60 });
  rows.forEach((row, i) => {
    Object.defineProperty(row, "offsetTop", { value: i * 40 });
    Object.defineProperty(row, "offsetHeight", { value: 40 });
  });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(popup.scrollTop).toBe(60);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(popup.scrollTop).toBe(0);
});

test("refocusing before the delayed blur closes does not dismiss the focused picker", async () => {
  vi.useFakeTimers();
  render(<Combobox label="Assignee" load={async () => []} onSelect={vi.fn()} />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.blur(input);
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  fireEvent.focus(input);
  await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  expect(input.getAttribute("aria-expanded")).toBe("true");
});

test("clicking a still-focused field reopens suggestions after Escape or selection", async () => {
  vi.useFakeTimers();
  const onSelect = vi.fn(), load = vi.fn(async () => [{ id: "anna", label: "Anna" }]);
  render(<Combobox label="Assignee" load={load} onSelect={onSelect} />);
  const input = screen.getByRole("combobox");
  act(() => input.focus());
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(document.activeElement).toBe(input);
  fireEvent.click(input);
  expect(input.getAttribute("aria-expanded")).toBe("true");
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSelect).toHaveBeenCalledWith({ id: "anna", label: "Anna" });
  expect(input.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(input);
  expect(input.getAttribute("aria-expanded")).toBe("true");
});

test("closing a pending search stops its visible loading indicator and ignores its response", async () => {
  vi.useFakeTimers();
  let finish!: (items: ComboOption[]) => void;
  const load = vi.fn(() => new Promise<ComboOption[]>(resolve => { finish = resolve; }));
  const view = render(<Combobox label="Assignee" load={load} onSelect={vi.fn()} />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(view.container.querySelector(".ds-spinner")).not.toBeNull();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(view.container.querySelector(".ds-spinner")).toBeNull();
  await act(async () => { finish([{ id: "anna", label: "Anna" }]); });
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryAllByRole("option", { hidden: true })).toHaveLength(0);
});

test("disabling the surrounding form closes suggestions and prevents selecting a cached option", async () => {
  vi.useFakeTimers();
  const onSelect = vi.fn(), load = vi.fn(async () => [{ id: "anna", label: "Anna" }]);
  const view = render(<fieldset><Combobox label="Assignee" load={load} onSelect={onSelect} /></fieldset>);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  const option = screen.getByRole("option", { name: "Anna", hidden: true });
  view.rerender(<fieldset disabled><Combobox label="Assignee" load={load} onSelect={onSelect} /></fieldset>);
  fireEvent.mouseDown(option);
  expect(onSelect).not.toHaveBeenCalled();
  expect(input.getAttribute("aria-expanded")).toBe("false");
});
