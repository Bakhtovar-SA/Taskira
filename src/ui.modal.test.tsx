/** Фокус в <Modal> (ТЗ 5.16, проход с клавиатуры): поле с autoFocus не перебивается крестиком из шапки, а после
 *  закрытия фокус возвращается туда, откуда диалог открыли, — а не в удалённое поле самого диалога. */
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "./i18n";
import { Modal } from "./ui";

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <I18nProvider>
      <button onClick={() => setOpen(true)}>open</button>
      {open && (
        <Modal title="Создать" onClose={() => setOpen(false)}>
          <input aria-label="title" autoFocus />
        </Modal>
      )}
    </I18nProvider>
  );
}

test("autoFocus поля сохраняется, после закрытия фокус — на кнопке-открывателе", () => {
  render(<Harness />);
  const opener = screen.getByText("open");
  opener.focus();
  fireEvent.click(opener);
  expect(document.activeElement).toBe(screen.getByLabelText("title"));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByLabelText("title")).toBeNull();
  expect(document.activeElement).toBe(opener);
});
