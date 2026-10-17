import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Tabs } from "./Tabs";
import { glideTo } from "../motion";
vi.mock("../motion", () => ({ cssZoom: () => 1, glideTo: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

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
