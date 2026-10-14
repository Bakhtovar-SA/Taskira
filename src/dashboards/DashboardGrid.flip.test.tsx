// NEW-05: DashboardGrid отдаёт gridFlip сетку только в режиме правки и не считает активным виджет без указателя.
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { DashboardGrid } from "./DashboardGrid";
import type { Widget } from "./catalog";

const calls: { grid: HTMLElement | null; ids: string[]; active: string | null }[] = [];
vi.mock("./gridFlip", () => ({
  createGridFlip: () => (grid: HTMLElement | null, widgets: { id: string }[], active: string | null) => calls.push({ grid, ids: widgets.map((w) => w.id), active }),
}));

const w = (id: string, y: number) => ({ id, type: "count", x: 0, y, w: 4, h: 2 }) as unknown as Widget;
const ui = (editing: boolean, widgets: Widget[]) => <I18nProvider><DashboardGrid widgets={widgets} editing={editing} onChange={() => undefined} onRemove={() => undefined} renderFrame={(x) => <span>{x.id}</span>} /></I18nProvider>;

afterEach(() => {
  cleanup();
  calls.length = 0;
});

test("просмотр — grid = null; правка — сама сетка; смена раскладки вызывает эффект снова", () => {
  const { rerender, container } = render(ui(false, [w("a", 0)]));
  expect(calls.at(-1)).toMatchObject({ grid: null, ids: ["a"], active: null });
  rerender(ui(true, [w("a", 0)]));
  expect(calls.at(-1)!.grid).toBe(container.querySelector(".dash-grid"));
  const n = calls.length;
  rerender(ui(true, [w("a", 0), w("b", 2)]));
  expect(calls).toHaveLength(n + 1);
  expect(calls.at(-1)).toMatchObject({ ids: ["a", "b"], active: null });
});
