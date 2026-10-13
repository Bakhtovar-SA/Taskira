import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Flash } from "./Flash";

const flash = vi.fn();
vi.mock("./motion", () => ({ flash: (...a: unknown[]) => flash(...a) }));

afterEach(() => {
  cleanup();
  flash.mockReset();
});

test("подсвечивается при смене значения; первый показ и то же значение — нет", () => {
  const { rerender } = render(<Flash value="todo">x</Flash>);
  expect(flash).not.toHaveBeenCalled();
  rerender(<Flash value="todo">y</Flash>);
  expect(flash).not.toHaveBeenCalled();
  rerender(<Flash value="done">y</Flash>);
  expect(flash).toHaveBeenCalledTimes(1);
});
