import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Menu } from "./LazyOverlay";

afterEach(cleanup);

function Probe() {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label="Действия"
      items={[{ id: "a", label: "Альфа", onSelect: () => {} }]}
      trigger={(p) => (
        <button {...p} type="button">
          Меню
        </button>
      )}
    />
  );
}

test("фокус, поставленный на кнопку до загрузки меню, остаётся на кнопке после подмены заглушки", async () => {
  render(<Probe />);
  const stub = screen.getByRole("button", { name: "Меню" });
  expect(stub.getAttribute("aria-controls")).toBeNull(); // пока заглушка: без ссылки на несуществующий список
  stub.focus();
  await waitFor(() => expect(screen.getByRole("button", { name: "Меню" }).getAttribute("aria-controls")).toBeTruthy(), { timeout: 5000 });
  const real = screen.getByRole("button", { name: "Меню" });
  expect(real).not.toBe(stub);
  expect(document.activeElement).toBe(real);
});
