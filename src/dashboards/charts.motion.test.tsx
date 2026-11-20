import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { BarList, Donut, Lines, Meter, StackedRow, type Part } from "./charts";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const parts: Part[] = [
  { key: "open", label: "В работе", value: 3, color: "var(--chart-1)" },
  { key: "done", label: "Готово", value: 5, color: "var(--chart-2)" },
];

test("bar geometry replays only for changed proportions; labels remain outside the animated mark", () => {
  const view = render(<BarList rows={parts} />);
  const before = view.container.querySelector(".chart-motion-bar")!;
  expect(before.textContent).toBe("");
  view.rerender(<BarList rows={parts.map(p => ({ ...p, label: `Новая подпись ${p.label}` }))} />);
  expect(view.container.querySelector(".chart-motion-bar")).toBe(before);
  view.rerender(<BarList rows={[{ ...parts[0], value: 4 }, parts[1]]} />);
  expect(view.container.querySelector(".chart-motion-bar")).not.toBe(before);
  expect(view.container.querySelector("li")?.textContent).toContain("4");
});

test("long rankings use the shared bounded entrance budget", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ ...parts[0], key: String(i), value: i + 1 }));
  const view = render(<BarList rows={rows} />);
  expect(view.container.querySelectorAll("li")).toHaveLength(40);
  expect(view.container.querySelectorAll(".chart-motion-bar")).toHaveLength(8);
});

test("donut hover retains running arcs, changed values replace them without changing the final total", () => {
  const view = render(<Donut parts={parts} total={8} centerLabel="Задач" />);
  const before = view.container.querySelector(".chart-motion-arc")!;
  fireEvent.pointerEnter(before);
  expect(view.container.querySelector(".chart-motion-arc")).toBe(before);
  expect(before.getAttribute("stroke-width")).toBe("13");
  view.rerender(<Donut parts={[{ ...parts[0], value: 4 }, parts[1]]} total={9} centerLabel="Задач" />);
  expect(view.container.querySelector(".chart-motion-arc")).not.toBe(before);
  expect(view.getByRole("img").getAttribute("aria-label")).toBe("Задач: 9");
  expect(view.container.querySelector("svg text")?.textContent).toBe("9");
});

test("line hover and responsive resize keep the path; changed history replays it and updates the accessible table", () => {
  let width = 600;
  let resize = () => {};
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  const series = [{ key: "closed", label: "Закрыто", color: "var(--chart-1)", values: [1, 3] }];
  const props = { xs: ["2026-11-01", "2026-11-08"], series, fmtX: (x: string) => x, height: 180, label: "Выполнение" };
  const view = render(<Lines {...props} />);
  const before = view.container.querySelector(".chart-motion-line")!;
  fireEvent.focus(view.getByRole("img"));
  expect(view.container.querySelector(".chart-motion-line")).toBe(before);
  const path = before.getAttribute("d");
  act(() => { width = 800; resize(); });
  expect(view.container.querySelector(".chart-motion-line")).toBe(before);
  expect(before.getAttribute("d")).not.toBe(path);
  view.rerender(<Lines {...props} series={[{ ...series[0], values: [1, 4] }]} />);
  expect(view.container.querySelector(".chart-motion-line")).not.toBe(before);
  expect(view.container.querySelector("tbody tr:last-child td")?.textContent).toBe("4");
});

test("meter accessibility and stacked totals are final while only fills animate; zero values remain finite", () => {
  const view = render(<><Meter value={3} total={4} label="Готовность" /><StackedRow segments={parts} max={10} label="Команда" /></>);
  expect(view.getByRole("meter").getAttribute("aria-valuenow")).toBe("75");
  expect(view.container.querySelectorAll(".chart-motion-bar")).toHaveLength(2);
  expect(view.container.querySelector("[title]")?.textContent).toBe("8");
  view.rerender(<><Meter value={0} total={0} label="Готовность" /><Donut parts={[]} total={0} centerLabel="Задач" /></>);
  expect(view.getByRole("meter").getAttribute("aria-valuenow")).toBe("0");
  expect(view.container.innerHTML).not.toMatch(/NaN|Infinity/);
});
