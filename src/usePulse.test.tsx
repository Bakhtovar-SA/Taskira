import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { usePulse } from "./usePulse";

const enter = vi.fn();
vi.mock("./motion", () => ({ enter: (...a: unknown[]) => enter(...a) }));

afterEach(() => {
  cleanup();
  enter.mockReset();
});

function Badge({ n, when }: { n: number | null; when?: "up" | "any" }) {
  const ref = usePulse<HTMLSpanElement>(n, when);
  return <span ref={ref}>{n}</span>;
}

test("подпрыгивает только когда число выросло; первый показ и убывание — нет", () => {
  const { rerender } = render(<Badge n={2} />);
  expect(enter).not.toHaveBeenCalled();
  rerender(<Badge n={3} />);
  expect(enter).toHaveBeenCalledTimes(1);
  expect(enter.mock.calls[0][1]).toBe("pop");
  rerender(<Badge n={1} />);
  expect(enter).toHaveBeenCalledTimes(1);
});

test("when=any — подпрыгивает и при уменьшении (счётчики)", () => {
  const { rerender } = render(<Badge n={5} when="any" />);
  rerender(<Badge n={4} when="any" />);
  expect(enter).toHaveBeenCalledTimes(1);
  rerender(<Badge n={4} when="any" />);
  expect(enter).toHaveBeenCalledTimes(1);
});

test("null (ещё грузится) → число не подпрыгивает", () => {
  const { rerender } = render(<Badge n={null} when="any" />);
  rerender(<Badge n={7} when="any" />);
  expect(enter).not.toHaveBeenCalled();
});
