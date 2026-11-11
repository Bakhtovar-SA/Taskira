import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { Conditions } from "../../server/src/workspaceContract";
import { matches } from "../../server/src/services/workspaceLogic";
vi.mock("../store", () => ({ useStore: () => ({ data: { currentProjectId: "p", currentUserId: "u" }, can: () => true }) }));
import { ConditionsEditor } from "./shared";
afterEach(() => { cleanup(); localStorage.clear(); });
function show(initial: Conditions) {
  const saved = vi.fn();
  function Form() {
    const [value, setValue] = useState(initial);
    const [valid, setValid] = useState(true);
    return <><ConditionsEditor value={value} onChange={setValue} onValidityChange={setValid} />
      <button disabled={!valid} onClick={() => saved(value)}>Save</button></>;
  }
  render(<I18nProvider><Form /></I18nProvider>);
  return saved;
}
function select(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option, hidden: true }));
}
test("boolean and number conditions round trip as typed values and match object data", () => {
  const saved = show({ mode: "all", items: [{ field: "object.ready", op: "eq", value: "" }] });
  select("Тип значения", "Да / Нет");
  select("Значение", "Нет");
  fireEvent.click(screen.getByText("Save"));
  expect(saved.mock.lastCall![0].items[0].value).toBe(false);
  expect(matches(saved.mock.lastCall![0], { "object.ready": false })).toBe(true);
  select("Тип значения", "Число");
  fireEvent.change(screen.getByLabelText("Значение"), { target: { value: "-2.5" } });
  fireEvent.click(screen.getByText("Save"));
  expect(saved.mock.lastCall![0].items[0].value).toBe(-2.5);
  expect(matches(saved.mock.lastCall![0], { "object.ready": -2.5 })).toBe(true);
});
test("editing a numeric condition never coerces empty or nonfinite input to zero or a string", () => {
  const saved = show({ mode: "all", items: [{ field: "object.count", op: "eq", value: 10 }] });
  const input = screen.getByLabelText("Значение");
  for (const value of ["", "NaN", "Infinity", "1e999"]) {
    fireEvent.change(input, { target: { value } });
    expect(screen.getByRole("alert").textContent).toContain("конечное число");
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
  }
  fireEvent.change(input, { target: { value: "12" } });
  fireEvent.click(screen.getByText("Save"));
  expect(saved.mock.lastCall![0].items[0].value).toBe(12);
  select("Тип значения", "Пустое значение");
  fireEvent.click(screen.getByText("Save"));
  expect(saved.mock.lastCall![0].items[0].value).toBeNull();
});
