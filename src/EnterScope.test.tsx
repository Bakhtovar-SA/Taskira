import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { EnterScope } from "./EnterScope";

const enter = vi.fn();
vi.mock("./motion", () => ({ enter: (...a: unknown[]) => enter(...a), motionReduced: () => false }));

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

test("то, что показано при открытии, не анимируется; добавленное позже — пружиной", () => {
  vi.useFakeTimers();
  const { rerender } = render(list(["1", "2"]));
  expect(enter).not.toHaveBeenCalled();
  rerender(list(["1", "2", "3"])); // пришло в первые 800 мс — это подгрузка, а не действие
  expect(enter).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  rerender(list(["1", "2", "3", "4"]));
  expect(enter).toHaveBeenCalledTimes(1);
  expect((enter.mock.calls[0][0] as HTMLElement).textContent).toBe("4");
  expect(enter.mock.calls[0][1]).toBe("rise");
});

test("смена resetKey (другая задача, другая вкладка) — снова базовая линия", () => {
  vi.useFakeTimers();
  const { rerender } = render(list(["1"]));
  vi.advanceTimersByTime(1000);
  rerender(list(["x", "y"], "b"));
  expect(enter).not.toHaveBeenCalled();
});
