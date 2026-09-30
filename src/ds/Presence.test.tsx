import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { Presence } from "./Presence";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (Element.prototype as Partial<Element>).getAnimations;
});

let instances = 0;
function Child({ open }: { open: boolean }) {
  const [n] = useState(() => ++instances);
  return <p data-open={String(open)}>{n}</p>;
}

test("без анимаций (jsdom) снимает окно сразу", () => {
  const { container, rerender } = render(<Presence show>{(open) => <Child open={open} />}</Presence>);
  expect(container.querySelector("p")).toBeTruthy();
  rerender(<Presence show={false}>{(open) => <Child open={open} />}</Presence>);
  expect(container.querySelector("p")).toBeNull();
});

test("держит окно на время ухода, передаёт open=false, при новом открытии — свежий экземпляр", () => {
  vi.useFakeTimers();
  (Element.prototype as { getAnimations?: () => Animation[] }).getAnimations = () => [];
  const view = (show: boolean) => <Presence show={show}>{(open) => <Child open={open} />}</Presence>;
  const { container, rerender } = render(view(true));
  const first = container.querySelector("p")!.textContent;
  rerender(view(false));
  expect(container.querySelector("p")?.getAttribute("data-open")).toBe("false");
  rerender(view(true)); // открыли снова, пока прошлое уходило
  expect(container.querySelector("p")?.getAttribute("data-open")).toBe("true");
  expect(container.querySelector("p")!.textContent).not.toBe(first);
  rerender(view(false));
  act(() => vi.advanceTimersByTime(400));
  expect(container.querySelector("p")).toBeNull();
});
