import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Tabs } from "./Tabs";
import { cssZoom, glideTo } from "../motion";
vi.mock("../motion", () => ({ cssZoom: vi.fn(() => 1), glideTo: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.mocked(cssZoom).mockReturnValue(1); });

test("replacing the preceding tab repositions the glider with the same selected index", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const left = this.hasAttribute("data-tab") ? (this.previousElementSibling?.textContent?.length ?? 0) * 10 : 0;
    return { left, top: 0, width: 100, height: 30, right: left + 100, bottom: 30, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  const view = render(<Tabs label="Views" value="board" onChange={() => undefined} items={[{ id: "all", label: "All" }, { id: "board", label: "Board" }]} />);
  expect(vi.mocked(glideTo).mock.calls.at(-1)?.[1]).toMatchObject({ x: 30 });
  vi.mocked(glideTo).mockClear();
  view.rerender(<Tabs label="Views" value="board" onChange={() => undefined} items={[{ id: "sprints", label: "Sprints" }, { id: "board", label: "Board" }]} />);
  expect(glideTo).toHaveBeenCalledTimes(1);
  expect(vi.mocked(glideTo).mock.calls[0][1]).toMatchObject({ x: 70 });
});

test("navigation reveals the selected link only in its local scroller, including viewport resize and zoom", () => {
  let viewportWidth = 300;
  let resize = () => {};
  const observed: Element[] = [];
  vi.mocked(cssZoom).mockReturnValue(1.1);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe(el: Element) { observed.push(el); }
    disconnect() {}
  });
  const rect = (left: number, width: number): DOMRect => ({ left, top: 20, width, height: 40, right: left + width, bottom: 60, x: left, y: 20, toJSON: () => ({}) });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.tagName === "NAV" ? viewportWidth : 900;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const nav = this.closest("nav");
    const scroll = nav?.scrollLeft ?? 0;
    if (this.tagName === "NAV") return rect(20, viewportWidth * 1.1);
    if (this.hasAttribute("data-tab")) {
      const index = [...this.parentElement!.querySelectorAll("[data-tab]")].indexOf(this);
      return rect(20 + (index * 100 - scroll) * 1.1, 100 * 1.1);
    }
    return rect(20 - scroll * 1.1, 900 * 1.1);
  });
  const items = Array.from({ length: 9 }, (_, i) => ({ id: String(i), label: `View ${i}`, href: `/view/${i}` }));
  // jsdom has no stylesheet; provide the same computed overflow as .project-view-tabs.
  const computed = window.getComputedStyle.bind(window);
  const style = vi.spyOn(window, "getComputedStyle").mockImplementation(el => el.tagName === "NAV" ? { ...computed(el), overflowX: "auto" } as CSSStyleDeclaration : computed(el));
  const view = render(<nav><Tabs mode="navigation" label="Views" value="8" onChange={() => {}} items={items} /></nav>);
  const nav = view.container.querySelector("nav")!;
  expect(nav.scrollLeft).toBeCloseTo(600);
  expect(observed).toContain(nav);
  const pageScroll = document.documentElement.scrollLeft;
  act(() => resize()); // ResizeObserver's initial notification.
  viewportWidth = 200;
  act(() => resize());
  expect(nav.scrollLeft).toBeCloseTo(700);
  expect(document.documentElement.scrollLeft).toBe(pageScroll);
  expect(document.documentElement.scrollTop).toBe(0);
  view.rerender(<nav><Tabs mode="navigation" label="Views" value="0" onChange={() => {}} items={items} /></nav>);
  expect(nav.scrollLeft).toBeCloseTo(0);
  view.rerender(<nav><Tabs mode="navigation" label="Views" value="7" onChange={() => {}} items={[{ id: "new", label: "New", href: "/new" }, ...items]} /></nav>);
  expect(nav.scrollLeft).toBeCloseTo(700);
  style.mockRestore();
});

test("filter tabs do not scroll their parent when their selected value changes", () => {
  const view = render(<nav><Tabs label="Period" value="week" onChange={() => {}} items={[{ id: "week", label: "Week" }, { id: "month", label: "Month" }]} /></nav>);
  const nav = view.container.querySelector("nav")!;
  nav.scrollLeft = 50;
  view.rerender(<nav><Tabs label="Period" value="month" onChange={() => {}} items={[{ id: "week", label: "Week" }, { id: "month", label: "Month" }]} /></nav>);
  expect(nav.scrollLeft).toBe(50);
});

test("the first resize delivery corrects font geometry but an unchanged delivery preserves the glide", () => {
  let left = 200;
  let resize = () => {};
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const x = this.hasAttribute("data-tab") ? left : 0;
    return { left: x, top: 0, width: 100, height: 32, right: x + 100, bottom: 32, x, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  render(<Tabs label="Views" value="files" onChange={() => {}} items={[{ id: "files", label: "Files" }]} />);
  vi.mocked(glideTo).mockClear();
  left = 208;
  act(() => resize());
  expect(glideTo).toHaveBeenCalledExactlyOnceWith(expect.any(HTMLElement), { x: 208, y: 0, w: 100, h: 32 }, { animate: false });
  vi.mocked(glideTo).mockClear();
  act(() => resize());
  expect(glideTo).not.toHaveBeenCalled();
});
