import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { usePulse } from "./usePulse";

const enter = vi.fn();
vi.mock("./motion", () => ({ enter: (...a: unknown[]) => enter(...a) }));

afterEach(() => {
  cleanup();
  enter.mockReset();
});

function Badge({ n }: { n: number }) {
  const ref = usePulse<HTMLSpanElement>(n);
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
