/** Фокус в <Modal> (ТЗ 5.16, проход с клавиатуры): поле с autoFocus не перебивается крестиком из шапки, а после
 *  закрытия фокус возвращается туда, откуда диалог открыли, — а не в удалённое поле самого диалога. */
import { useLayoutEffect, useState } from "react";
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

test("removing a focused conditional field does not reset focus to the close button", () => {
  const view = (field: boolean) => <I18nProvider><Modal title="Edit" onClose={() => {}}><button>close</button>{field && <input aria-label="conditional" />}</Modal></I18nProvider>;
  const ui = render(view(true));
  screen.getByLabelText("conditional").focus();
  ui.rerender(view(false));
  expect(document.activeElement).toBe(document.body);
  expect(document.activeElement).not.toBe(screen.getByText("close"));
});

test("explicit loading completion restores focus once and ordinary rerenders preserve it", () => {
  const view = (ready: boolean, count: number) => <I18nProvider><Modal title="Edit" focusReady={ready} onClose={() => {}}>{ready ? <input aria-label="loaded" /> : <button>loading</button>}<span>{count}</span></Modal></I18nProvider>;
  const ui = render(view(false, 0));
  expect(document.activeElement).toBe(screen.getByText("loading"));
  ui.rerender(view(true, 0));
  const field = screen.getByLabelText("loaded");
  expect(document.activeElement).toBe(field);
  fireEvent.change(field, { target: { value: "draft" } });
  ui.rerender(view(true, 1));
  expect(document.activeElement).toBe(field);
});

test("mount pulls focus inside even when another layout effect focused an unrelated field", () => {
  function StealFocus() {
    useLayoutEffect(() => { document.getElementById("outside-field")!.focus(); }, []);
    return null;
  }
  render(<I18nProvider><input id="outside-field" /><Modal title="Edit" onClose={() => {}}><StealFocus /><button>inside</button></Modal></I18nProvider>);
  expect(document.activeElement).toBe(screen.getByText("inside"));
});

test("loading completion leaves focus in an external popover control", () => {
  const view = (ready: boolean) => <I18nProvider><input aria-label="popover field" /><Modal title="Edit" focusReady={ready} onClose={() => {}}><button>inside</button></Modal></I18nProvider>;
  const ui = render(view(false));
  const outside = screen.getByLabelText("popover field");
  outside.focus();
  ui.rerender(view(true));
  expect(document.activeElement).toBe(outside);
});
