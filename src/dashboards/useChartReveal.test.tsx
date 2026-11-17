import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { motionReduced } from "../motion";
import { useChartReveal } from "./useChartReveal";

vi.mock("../motion", () => ({ motionReduced: vi.fn(() => false) }));

let intersect: (entries: { isIntersecting: boolean }[]) => void;
let disconnect: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.mocked(motionReduced).mockReturnValue(false);
  disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof intersect) { intersect = callback; }
    observe() {}
    disconnect = disconnect;
  });
});
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("vt-nav");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Chart({ revision = "1" }: { revision?: string }) {
  const ref = useChartReveal<HTMLDivElement>(revision);
  return <div ref={ref}><span className="chart-motion-bar" />Final values</div>;
}

test("offscreen charts wait, then reveal once without replaying when scrolled back", () => {
  const { container } = render(<Chart />);
  const chart = container.firstElementChild!;
  expect(chart.getAttribute("data-chart-motion")).toBe("waiting");
  act(() => intersect([{ isIntersecting: false }]));
  expect(chart.getAttribute("data-chart-motion")).toBe("waiting");
  act(() => intersect([{ isIntersecting: true }]));
  expect(chart.getAttribute("data-chart-motion")).toBe("ready");
  expect(disconnect).toHaveBeenCalledOnce();
  expect(chart.textContent).toBe("Final values");
});

test("the navigation snapshot cannot consume a visible chart's animation", async () => {
  document.documentElement.classList.add("vt-nav");
  const { container } = render(<Chart />);
  const chart = container.firstElementChild!;
  act(() => intersect([{ isIntersecting: true }]));
  expect(chart.getAttribute("data-chart-motion")).toBe("waiting");
  await act(async () => { document.documentElement.classList.remove("vt-nav"); });
  expect(chart.getAttribute("data-chart-motion")).toBe("ready");
  expect(disconnect).toHaveBeenCalledOnce();
});

test("only a new data revision arms another entrance; unmount cleans pending observers", () => {
  const view = render(<Chart />);
  const chart = view.container.firstElementChild!;
  act(() => intersect([{ isIntersecting: true }]));
  view.rerender(<Chart revision="1" />);
  expect(chart.getAttribute("data-chart-motion")).toBe("ready");
  view.rerender(<Chart revision="2" />);
  expect(chart.getAttribute("data-chart-motion")).toBe("waiting");
  view.unmount();
  expect(chart.hasAttribute("data-chart-motion")).toBe(false);
  act(() => intersect([{ isIntersecting: true }]));
  expect(chart.hasAttribute("data-chart-motion")).toBe(false);
});

test("reduced motion never waits on intersection or navigation", () => {
  vi.mocked(motionReduced).mockReturnValue(true);
  document.documentElement.classList.add("vt-nav");
  const { container } = render(<Chart />);
  expect(container.firstElementChild?.getAttribute("data-chart-motion")).toBe("ready");
});

test("browsers without intersection support retain visible content", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const { container } = render(<Chart />);
  expect(container.firstElementChild?.getAttribute("data-chart-motion")).toBe("ready");
});
