import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { EnterScope } from "./EnterScope";

const enter = vi.fn();
vi.mock("./motion", async importOriginal => ({ ...(await importOriginal<typeof import("./motion")>()), enter: (...a: unknown[]) => enter(...a), motionReduced: () => false }));

afterEach(() => {
  cleanup();
  enter.mockReset();
  vi.useRealTimers();
});

const list = (ids: string[], key = "a") => (
  <EnterScope ids={ids} resetKey={key}>
    {ids.map((id) => (
      <p key={id} data-enter-id={id}>
        {id}
      </p>
    ))}
  </EnterScope>
);

test("первый непустой набор — базовая линия (даже если пришёл поздно); добавленное позже — пружиной", () => {
  vi.useFakeTimers();
  const { rerender } = render(list([]));
  vi.advanceTimersByTime(5000); // медленная сеть: лента пришла через 5 с
  rerender(list(["1", "2"]));
  expect(enter).not.toHaveBeenCalled();
  rerender(list(["1", "2", "3"]));
  expect(enter).toHaveBeenCalledTimes(1);
  expect((enter.mock.calls[0][0] as HTMLElement).textContent).toBe("3");
  expect(enter.mock.calls[0][1]).toBe("rise");
});

test("смена resetKey (другая задача, другая вкладка) — снова базовая линия", () => {
  const { rerender } = render(list(["1"]));
  rerender(list(["x", "y"], "b"));
  expect(enter).not.toHaveBeenCalled();
});

test("пустой набор до ответа сервера, затем N элементов — не анимируются (деталь задачи приходит позже списка)", () => {
  const view = (ids: string[]) => (
    <EnterScope ids={ids} resetKey="a">
      {ids.map((id) => (
        <p key={id} data-enter-id={id}>
          {id}
        </p>
      ))}
    </EnterScope>
  );
  const { rerender } = render(view([]));
  rerender(view(["1", "2", "3"]));
  expect(enter).not.toHaveBeenCalled();
});
