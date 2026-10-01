import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, test, vi } from "vitest";
const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@floating-ui/dom", () => ({
  autoUpdate: (a: HTMLElement, _f: HTMLElement, update: () => void) => { track(a); update(); return () => {}; },
  computePosition: async (a: HTMLElement) => ({ x: a.textContent === "Replacement" ? 400 : 20, y: 180, placement: "bottom-start" }),
  flip: () => ({}), offset: () => ({}), shift: () => ({}), size: () => ({}),
}));
import { Popover } from "./Overlay";
test("open menu follows a replacement trigger instead of retaining the detached fallback", async () => {
  function Example() {
    const [replace, setReplace] = useState(false);
    return <><button onClick={() => setReplace(true)}>Replace anchor</button>
      <Popover label="Actions" trigger={p => replace ? <span><button {...p}>Replacement</button></span> : <button {...p}>Fallback</button>}><button>Action</button></Popover></>;
  }
  render(<Example />);
  fireEvent.click(screen.getByRole("button", { name: "Fallback" }));
  await act(async () => {});
  expect(screen.getByRole("dialog", { hidden: true }).style.left).toBe("20px");
  fireEvent.click(screen.getByRole("button", { name: "Replace anchor" }));
  await act(async () => {});
  const replacement = screen.getByRole("button", { name: "Replacement" });
  expect(track).toHaveBeenLastCalledWith(replacement);
  expect(screen.getByRole("dialog", { hidden: true }).style.left).toBe("400px");
  fireEvent.keyDown(screen.getByRole("button", { name: "Action", hidden: true }), { key: "Escape" });
  expect(document.activeElement).toBe(replacement);
});
