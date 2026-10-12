import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { Dialog } from "./Dialog";
import { Select, type SelectItem } from "./Select";
import { chooseOption, selectedText } from "./Select.testing";

const FRUITS: SelectItem[] = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry", disabled: true },
  { value: "date", label: "Date" },
];

function Harness<T extends string | number>({ initial, options, onChange, ...rest }: { initial: T; options: SelectItem<T>[]; onChange?: (v: T) => void } & Partial<Parameters<typeof Select<T>>[0]>) {
  const [v, setV] = useState<T>(initial);
  return <Select aria-label="Fruit" {...rest} value={v} options={options} onChange={(x) => { setV(x); onChange?.(x); }} />;
}

afterEach(cleanup);

const listOf =(cb: HTMLElement) => document.getElementById(cb.getAttribute("aria-controls") ?? "");
const activeText = (cb: HTMLElement) => document.getElementById(cb.getAttribute("aria-activedescendant") ?? "")?.textContent;

describe("Select", () => {
  test("button with role=combobox shows the selected label; click opens a listbox and choosing closes it", () => {
    const onChange = vi.fn();
    render(<Harness initial="apple" options={FRUITS} onChange={onChange} />);
    const cb = screen.getByRole("combobox", { name: "Fruit" });
    expect(cb.tagName).toBe("BUTTON");
    expect(selectedText(cb)).toBe("Apple");
    expect(cb.getAttribute("aria-expanded")).toBe("false");
    expect(listOf(cb)).toBeNull(); // options are rendered only while open
    fireEvent.click(cb);
    expect(cb.getAttribute("aria-expanded")).toBe("true");
    const list = listOf(cb)!;
    expect(list.getAttribute("role")).toBe("listbox");
    expect(within(list).getByRole("option", { name: "Apple", hidden: true }).getAttribute("aria-selected")).toBe("true");
    expect(activeText(cb)).toBe("Apple");
    fireEvent.click(within(list).getByRole("option", { name: "Banana", hidden: true }));
    expect(onChange).toHaveBeenCalledWith("banana");
    expect(selectedText(cb)).toBe("Banana");
    expect(cb.getAttribute("aria-expanded")).toBe("false");
  });

  test("a second click on the trigger closes the list without changing the value", () => {
    const onChange = vi.fn();
    render(<Harness initial="apple" options={FRUITS} onChange={onChange} />);
    const cb = screen.getByRole("combobox");
    fireEvent.pointerDown(cb); fireEvent.click(cb);
    expect(cb.getAttribute("aria-expanded")).toBe("true");
    fireEvent.pointerDown(cb); fireEvent.click(cb);
    expect(cb.getAttribute("aria-expanded")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("keyboard: arrows skip disabled options, Home/End, Enter chooses", () => {
    const onChange = vi.fn();
    render(<Harness initial="banana" options={FRUITS} onChange={onChange} />);
    const cb = screen.getByRole("combobox");
    fireEvent.keyDown(cb, { key: "ArrowDown" });
    expect(cb.getAttribute("aria-expanded")).toBe("true");
    expect(activeText(cb)).toBe("Banana");
    fireEvent.keyDown(cb, { key: "ArrowDown" });
    expect(activeText(cb)).toBe("Date"); // Cherry is disabled
    fireEvent.keyDown(cb, { key: "Home" });
    expect(activeText(cb)).toBe("Apple");
    fireEvent.keyDown(cb, { key: "End" });
    expect(activeText(cb)).toBe("Date");
    fireEvent.keyDown(cb, { key: "ArrowUp" });
    expect(activeText(cb)).toBe("Banana");
    fireEvent.keyDown(cb, { key: "Enter" });
    expect(cb.getAttribute("aria-expanded")).toBe("false");
    expect(onChange).not.toHaveBeenCalled(); // same value
    fireEvent.keyDown(cb, { key: " " });
    fireEvent.keyDown(cb, { key: "End" });
    fireEvent.keyDown(cb, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("date");
  });

  test("a disabled option cannot be chosen by click", () => {
    const onChange = vi.fn();
    render(<Harness initial="apple" options={FRUITS} onChange={onChange} />);
    const cb = screen.getByRole("combobox");
    fireEvent.click(cb);
    const cherry = within(listOf(cb)!).getByRole("option", { name: "Cherry", hidden: true });
    expect(cherry.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(cherry);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("typeahead: first letters, repeated letter cycles, Russian text and the wrong keyboard layout", () => {
    const opts: SelectItem[] = [
      { value: "1", label: "Почта" },
      { value: "2", label: "Портал" },
      { value: "3", label: "Телефон" },
      { value: "4", label: "Чат" },
    ];
    render(<Harness initial="1" options={opts} />);
    const cb = screen.getByRole("combobox");
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    fireEvent.keyDown(cb, { key: "т" });
    expect(cb.getAttribute("aria-expanded")).toBe("true");
    expect(activeText(cb)).toBe("Телефон");
    fireEvent.keyDown(cb, { key: "Escape" });
    // «gjh» — «пор», набранное в английской раскладке
    now.mockReturnValue(10_000);
    fireEvent.keyDown(cb, { key: "g" });
    fireEvent.keyDown(cb, { key: "j" });
    fireEvent.keyDown(cb, { key: "h" });
    expect(activeText(cb)).toBe("Портал");
    now.mockReturnValue(20_000);
    fireEvent.keyDown(cb, { key: "п" });
    expect(activeText(cb)).toBe("Почта"); // next option on «п» after Портал, wrapping around
    now.mockReturnValue(20_100);
    fireEvent.keyDown(cb, { key: "п" });
    expect(activeText(cb)).toBe("Портал"); // «пп» cycles
    now.mockRestore();
  });

  test("Escape closes only the list inside a Dialog; a second Escape is left to the dialog", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Settings">
        <Select aria-label="Fruit" value="apple" options={FRUITS} onChange={() => {}} />
      </Dialog>,
    );
    const cb = screen.getByRole("combobox", { name: "Fruit", hidden: true });
    fireEvent.click(cb);
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { cb.dispatchEvent(esc); });
    expect(esc.defaultPrevented).toBe(true); // dialogs and App's global handler skip a handled Escape
    expect(cb.getAttribute("aria-expanded")).toBe("false");
    expect(onClose).not.toHaveBeenCalled();
    const esc2 = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { cb.dispatchEvent(esc2); });
    expect(onClose).toHaveBeenCalledTimes(1); // closed list: Escape is not handled by Select, the dialog closes
  });

  test("Tab closes the list without choosing", () => {
    const onChange = vi.fn();
    render(<Harness initial="apple" options={FRUITS} onChange={onChange} />);
    const cb = screen.getByRole("combobox");
    fireEvent.keyDown(cb, { key: "ArrowDown" });
    fireEvent.keyDown(cb, { key: "ArrowDown" });
    fireEvent.keyDown(cb, { key: "Tab" });
    expect(cb.getAttribute("aria-expanded")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("disabled: native disabled (so a disabled fieldset works too), does not open", () => {
    render(
      <>
        <Select aria-label="Off" value="apple" options={FRUITS} onChange={() => {}} disabled />
        <fieldset disabled>
          <Select aria-label="In fieldset" value="apple" options={FRUITS} onChange={() => {}} />
        </fieldset>
      </>,
    );
    const off = screen.getByRole("combobox", { name: "Off" }) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    fireEvent.keyDown(off, { key: "ArrowDown" });
    expect(off.getAttribute("aria-expanded")).toBe("false");
    expect((screen.getByRole("combobox", { name: "In fieldset" }) as HTMLButtonElement).matches(":disabled")).toBe(true);
  });

  test("an open list closes and cannot choose when a surrounding fieldset becomes disabled", () => {
    const onChange = vi.fn();
    function Form() {
      const [off, setOff] = useState(false);
      return (
        <fieldset disabled={off}>
          <Select aria-label="Fruit" value="apple" options={FRUITS} onChange={onChange} />
          <button type="button" onClick={() => setOff(true)}>lock</button>
        </fieldset>
      );
    }
    render(<Form />);
    const cb = screen.getByRole("combobox", { name: "Fruit" });
    fireEvent.click(cb);
    expect(cb.getAttribute("aria-expanded")).toBe("true");
    const list = listOf(cb)!;
    fireEvent.click(screen.getByText("lock"));
    expect(cb.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(within(list).getByRole("option", { name: "Banana", hidden: true }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("when the options shrink while the list is open, aria-activedescendant never points past the end", () => {
    function Shrinking() {
      const [n, setN] = useState(4);
      return (
        <>
          <Select aria-label="Fruit" value="date" options={FRUITS.slice(0, n)} onChange={() => {}} />
          <button type="button" onClick={() => setN(2)}>shrink</button>
        </>
      );
    }
    render(<Shrinking />);
    const cb = screen.getByRole("combobox", { name: "Fruit" });
    fireEvent.click(cb);
    expect(activeText(cb)).toBe("Date");
    fireEvent.click(screen.getByText("shrink"));
    const id = cb.getAttribute("aria-activedescendant");
    expect(id === null || document.getElementById(id) !== null).toBe(true);
    expect(activeText(cb)).toBe("Banana");
  });

  test("label association: external <label htmlFor>, own label prop, error and the listbox name", () => {
    render(
      <>
        <label htmlFor="sel-ext">Support level</label>
        <Select id="sel-ext" value="apple" options={FRUITS} onChange={() => {}} />
        <Select label="Channel" value="apple" options={FRUITS} onChange={() => {}} error="Required" />
      </>,
    );
    const ext = screen.getByRole("combobox", { name: "Support level" });
    expect(screen.getByLabelText("Support level")).toBe(ext);
    fireEvent.click(ext);
    expect(listOf(ext)!.getAttribute("aria-label")).toBe("Support level");
    const own = screen.getByRole("combobox", { name: "Channel" });
    expect(own.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(own.getAttribute("aria-describedby")!)!.textContent).toBe("Required");
  });

  test("numbers keep their type; groups render as labelled groups; unknown value shows the placeholder", () => {
    const onChange = vi.fn();
    const opts: SelectItem<number>[] = [
      { group: "Short", options: [{ value: 7, label: "7 days" }, { value: 30, label: "30 days" }] },
      { group: "Long", options: [{ value: 90, label: "90 days" }] },
    ];
    render(<Harness initial={99} options={opts} onChange={onChange} placeholder="Pick a period" />);
    const cb = screen.getByRole("combobox");
    expect(selectedText(cb)).toBe("Pick a period");
    fireEvent.click(cb);
    const groups = within(listOf(cb)!).getAllByRole("group", { hidden: true });
    expect(groups.map((g) => g.getAttribute("aria-labelledby") && document.getElementById(g.getAttribute("aria-labelledby")!)!.textContent)).toEqual(["Short", "Long"]);
    chooseOption(cb, "90 days");
    expect(onChange).toHaveBeenCalledWith(90);
    expect(selectedText(cb)).toBe("90 days");
  });

  test("name renders a hidden form field with the current value", () => {
    const { container } = render(<Select aria-label="Fruit" name="fruit" value="banana" options={FRUITS} onChange={() => {}} />);
    expect((container.querySelector("input[type=hidden][name=fruit]") as HTMLInputElement).value).toBe("banana");
  });
});
