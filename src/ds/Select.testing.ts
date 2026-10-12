/** Помощники модульных тестов для ds `Select` (замена `fireEvent.change` на нативном `<select>`). jsdom не знает
 *  Popover API — список ищется с `hidden: true`. */
import { fireEvent, within } from "@testing-library/react";

/** Открыть список и выбрать вариант по доступному имени. */
export function chooseOption(combobox: HTMLElement, name: string | RegExp): void {
  if (combobox.getAttribute("aria-expanded") !== "true") fireEvent.click(combobox);
  const list = document.getElementById(combobox.getAttribute("aria-controls") ?? "");
  if (!list) throw new Error("Select: список не открылся");
  fireEvent.click(within(list).getByRole("option", { name, hidden: true }));
}

/** Текст выбранного значения на кнопке. */
export const selectedText = (combobox: HTMLElement): string => combobox.querySelector(".ds-select-value")?.textContent ?? "";

/** Подписи вариантов (открывает список и закрывает его обратно). */
export function optionLabels(combobox: HTMLElement): string[] {
  fireEvent.click(combobox);
  const list = document.getElementById(combobox.getAttribute("aria-controls") ?? "");
  const out = list ? within(list).getAllByRole("option", { hidden: true }).map((o) => o.textContent ?? "") : [];
  fireEvent.keyDown(combobox, { key: "Escape" });
  return out;
}
