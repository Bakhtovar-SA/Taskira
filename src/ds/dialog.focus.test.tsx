/** Фокус в ds Dialog — те же проверки, что были у старого <Modal> из ui.tsx (ТЗ 5.16, проход с клавиатуры; трек H
 *  добавил focusReady). Modal удалён в G6, проверки перенесены сюда без ослабления. */
import { useLayoutEffect, useState } from "react";
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { Dialog } from "./Dialog";

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <I18nProvider>
      <button onClick={() => setOpen(true)}>open</button>
      {open && (
        <Dialog open title="Создать" onClose={() => setOpen(false)}>
          <input aria-label="title" data-autofocus />
        </Dialog>
      )}
    </I18nProvider>
  );
}

test("поле с data-autofocus получает фокус, а не крестик; после закрытия фокус — на кнопке-открывателе", () => {
  render(<Harness />);
  const opener = screen.getByText("open");
  opener.focus();
  fireEvent.click(opener);
  const field = screen.getByLabelText("title");
  expect(document.activeElement).toBe(field);
  fireEvent.keyDown(field, { key: "Escape" });
  expect(screen.queryByLabelText("title")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test("removing a focused conditional field does not reset focus to the close button", () => {
  const view = (field: boolean) => (
    <I18nProvider>
      <Dialog open title="Edit" onClose={() => {}}>
        <button>close</button>
        {field && <input aria-label="conditional" />}
      </Dialog>
    </I18nProvider>
  );
  const ui = render(view(true));
  screen.getByLabelText("conditional").focus();
  ui.rerender(view(false));
  expect(document.activeElement).toBe(document.body);
  expect(document.activeElement).not.toBe(screen.getByText("close"));
});

test("explicit loading completion restores focus once and ordinary rerenders preserve it", () => {
  const view = (ready: boolean, count: number) => (
    <I18nProvider>
      <Dialog open title="Edit" focusReady={ready} onClose={() => {}}>
        {ready ? <input aria-label="loaded" /> : <button>loading</button>}
        <span>{count}</span>
      </Dialog>
    </I18nProvider>
  );
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
    useLayoutEffect(() => {
      document.getElementById("outside-field")!.focus();
    }, []);
    return null;
  }
  render(
    <I18nProvider>
      <input id="outside-field" />
      <Dialog open title="Edit" onClose={() => {}}>
        <StealFocus />
        <button>inside</button>
      </Dialog>
    </I18nProvider>,
  );
  expect(document.activeElement).toBe(screen.getByText("inside"));
});

test("loading completion leaves focus in an external popover control", () => {
  const view = (ready: boolean) => (
    <I18nProvider>
      <input aria-label="popover field" />
      <Dialog open title="Edit" focusReady={ready} onClose={() => {}}>
        <button>inside</button>
      </Dialog>
    </I18nProvider>
  );
  const ui = render(view(false));
  const outside = screen.getByLabelText("popover field");
  outside.focus();
  ui.rerender(view(true));
  expect(document.activeElement).toBe(outside);
});
