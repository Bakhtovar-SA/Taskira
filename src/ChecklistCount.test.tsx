import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChecklistCount } from "./ChecklistCount";
import * as motion from "./motion";

beforeEach(() => { localStorage.clear(); vi.stubGlobal("matchMedia", () => ({ matches: false })); motion.__resetMotionForTests(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
const count = (done: number, total: number, issueId = "one") => <ChecklistCount issueId={issueId} done={done} total={total}>{done}/{total}</ChecklistCount>;

test("only incomplete→complete flashes the count; first render and unchanged complete do not", () => {
  const flash = vi.spyOn(motion, "flash").mockImplementation(() => undefined);
  const { container, rerender } = render(count(1, 2));
  expect(flash).not.toHaveBeenCalled();
  rerender(count(2, 2));
  expect(flash).toHaveBeenCalledTimes(1);
  expect(flash).toHaveBeenCalledWith(container.firstChild);
  expect(container.textContent).toBe("2/2");
  rerender(count(2, 2));
  rerender(count(1, 2));
  expect(flash).toHaveBeenCalledTimes(1);
  rerender(count(2, 2));
  expect(flash).toHaveBeenCalledTimes(2);
});

test("initial complete, loaded empty→complete, unchanged false and deleting unfinished items never flash", () => {
  const flash = vi.spyOn(motion, "flash").mockImplementation(() => undefined);
  const { rerender } = render(count(2, 2));
  rerender(count(0, 0)); rerender(count(1, 1));
  rerender(count(1, 3)); rerender(count(1, 2)); rerender(count(1, 1));
  expect(flash).not.toHaveBeenCalled();
});

test("switching issues and decreasing a complete count do not flash", () => {
  const flash = vi.spyOn(motion, "flash").mockImplementation(() => undefined);
  const { rerender } = render(count(1, 2));
  rerender(count(3, 3, "two")); rerender(count(2, 2, "two"));
  expect(flash).not.toHaveBeenCalled();
});

test.each(["system", "personal"])("%s reduce leaves final count without a WAAPI flash", mode => {
  const { container, rerender } = render(count(1, 2));
  const node = container.firstElementChild as HTMLSpanElement;
  node.animate = vi.fn() as unknown as HTMLElement["animate"];
  if (mode === "personal") motion.setReducedMotion(true);
  else vi.stubGlobal("matchMedia", () => ({ matches: true }));
  rerender(count(2, 2));
  expect(container.textContent).toBe("2/2");
  expect(node.animate).not.toHaveBeenCalled();
});
