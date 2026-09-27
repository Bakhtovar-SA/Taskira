import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Button, Checkbox, IconButton, Switch, Tabs, Textarea } from ".";

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
