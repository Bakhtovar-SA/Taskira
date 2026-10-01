import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef, useState } from "react";
import { Button, Checkbox, DatePicker, IconButton, SidePanel, Switch, Tabs, Textarea } from ".";
import { Popover, Tooltip } from "./Overlay";

describe("Button", () => {
  test("недоступная — aria-disabled, в порядке фокуса, клик не срабатывает, причина — в подсказке", async () => {
    const onClick = vi.fn();
    render(<Button disabled="Нет прав" onClick={onClick}>Удалить</Button>);
    const b = screen.getByRole("button", { name: "Удалить" });
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.hasAttribute("disabled")).toBe(false);
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    // Подсказка грузится отдельным чанком (Button.tsx) — дожидаемся её.
    expect((await screen.findByRole("tooltip", { hidden: true })).textContent).toContain("Нет прав");
  });

  test("загрузка — aria-busy и клик не срабатывает", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Сохранить</Button>);
    const b = screen.getByRole("button", { name: /Сохранить/ });
    expect(b.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  test("IconButton: подпись — доступное имя", () => {
    render(<IconButton label="Редактировать">✎</IconButton>);
    expect(screen.getByRole("button", { name: "Редактировать" })).toBeTruthy();
  });
});

describe("Tabs", () => {
  test("стрелки переключают и переносят фокус, недоступная вкладка пропускается", () => {
    function T() {
      const [v, setV] = useState<"a" | "b" | "c">("a");
      return <Tabs label="Вид" value={v} onChange={setV} items={[{ id: "a", label: "А" }, { id: "b", label: "Б", disabled: true }, { id: "c", label: "В" }]} />;
    }
    render(<T />);
    const a = screen.getByRole("tab", { name: "А" });
    act(() => a.focus());
    fireEvent.keyDown(a, { key: "ArrowRight" });
    const c = screen.getByRole("tab", { name: "В" });
    expect(c.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(c);
    expect(c.getAttribute("tabindex")).toBe("0");
    expect(a.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(c, { key: "ArrowRight" });
    expect(a.getAttribute("aria-selected")).toBe("true");
  });
});

describe("поля", () => {
  test("Switch: role=switch, недоступный не переключается", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Switch checked={false} onChange={onChange} label="Спринты" />);
    fireEvent.click(screen.getByRole("switch", { name: "Спринты" }));
    expect(onChange).toHaveBeenCalledWith(true);
    onChange.mockClear();
    rerender(<Switch checked={false} onChange={onChange} label="Спринты" disabled="Только админ" />);
    fireEvent.click(screen.getByRole("switch", { name: "Спринты" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("Checkbox: подпись связана с полем", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Только мои" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Только мои" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("Textarea: счётчик и ошибка связаны через aria-describedby", () => {
    render(<Textarea label="Описание" value="абв" onChange={() => {}} maxChars={2} error="Слишком длинно" />);
    const ta = screen.getByRole("textbox", { name: "Описание" });
    expect(ta.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(ta.getAttribute("aria-describedby")!)?.textContent).toContain("Слишком длинно");
  });
});

test("окно: фокус на первый доступный элемент (выключенный пропускается); Esc закрывает, если его не обработали внутри", () => {
  const onClose = vi.fn();
  render(
    <SidePanel open onClose={onClose} title="Карточка" headless>
      <button disabled>Назад</button>
      <button>Вперёд</button>
      <input aria-label="Правка" onKeyDown={(e) => e.key === "Escape" && e.preventDefault()} />
    </SidePanel>,
  );
  const next = screen.getByRole("button", { name: "Вперёд" });
  expect(document.activeElement).toBe(next);
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Правка" }), { key: "Escape" }); // отмена правки внутри
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(next, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("подсказка не затирает ref и обработчики ребёнка (якорь Popover на IconButton), а дополняет их", () => {
  const ref = createRef<HTMLButtonElement>();
  const onFocus = vi.fn();
  render(
    <Tooltip label="Уведомления">
      <button ref={ref} onFocus={onFocus} aria-describedby="hint">
        Колокол
      </button>
    </Tooltip>,
  );
  const btn = screen.getByRole("button", { name: "Колокол" });
  expect(ref.current).toBe(btn);
  fireEvent.focus(btn);
  expect(onFocus).toHaveBeenCalledTimes(1);
  expect(btn.getAttribute("aria-describedby")?.split(" ")).toContain("hint");
  expect(btn.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
});

test("календарь: дни — в строках по неделе (grid → row → gridcell), как требует ARIA", () => {
  render(<DatePicker value="2026-10-01" onChange={() => {}} label="Срок" today="2026-10-01" />);
  fireEvent.click(screen.getByRole("button", { name: /^Срок/ }));
  const grid = screen.getByRole("grid", { hidden: true });
  const rows = [...grid.querySelectorAll('[role="row"]')];
  expect(rows).toHaveLength(6);
  for (const row of rows) expect(row.querySelectorAll('[role="gridcell"]')).toHaveLength(7);
  for (const cell of grid.querySelectorAll('[role="gridcell"]')) expect(cell.parentElement?.getAttribute("role")).toBe("row");
});

test("календарь: min/max — дни и быстрые кнопки вне диапазона выключены, ввод вне диапазона не принимается", () => {
  const onChange = vi.fn();
  const { container } = render(<DatePicker value={null} onChange={onChange} label="Начало периода" today="2026-10-01" min="2026-09-29" max="2026-10-05" />);
  fireEvent.click(screen.getByRole("button", { name: /^Начало периода:/ }));
  const day = (iso: string) => container.querySelector<HTMLElement>(`[data-iso="${iso}"]`)!;
  expect(day("2026-09-28").getAttribute("aria-disabled")).toBe("true");
  expect(day("2026-10-06").getAttribute("aria-disabled")).toBe("true");
  expect(day("2026-10-03").getAttribute("aria-disabled")).toBeNull();
  fireEvent.click(day("2026-10-06"));
  expect(onChange).not.toHaveBeenCalled();
  const box = within(container);
  expect((box.getByRole("button", { name: "Через неделю", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
  expect((box.getByRole("button", { name: "Завтра", hidden: true }) as HTMLButtonElement).disabled).toBe(false);
  const input = box.getByRole("textbox", { name: "Начало периода", hidden: true });
  fireEvent.change(input, { target: { value: "10.10.2026" } });
  expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("Вне допустимых дат");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(day("2026-10-03"));
  expect(onChange).toHaveBeenCalledWith("2026-10-03");
});


test("Escape in a nested calendar keeps the filter popover and returns focus to its date field", () => {
  const ui = render(<Popover label="Date filter" trigger={(p) => <button {...p}>Filter</button>}>
    <DatePicker label="From" value={null} onChange={() => {}} />
  </Popover>);
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  const date = screen.getByRole("button", { name: /^From:/, hidden: true });
  fireEvent.click(date);
  fireEvent.keyDown(screen.getByRole("textbox", { name: "From", hidden: true }), { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "From", hidden: true })).toBeNull();
  expect(screen.getByRole("button", { name: "Filter" }).getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(date);
  fireEvent.keyDown(date, { key: "Escape" });
  expect(screen.getByRole("button", { name: "Filter" }).getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Filter" }));
  ui.unmount();
});
