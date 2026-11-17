import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Menu, Popover } from "./Overlay";

vi.mock("./floating", async original => ({
  ...await original<typeof import("./floating")>(),
  useAnchored: () => {},
  showPop: () => {},
  hidePop: () => {},
}));

afterEach(cleanup);

test("opening a popover skips disabled controls for initial focus", () => {
  render(<Popover label="Actions" trigger={p => <button {...p}>Open</button>}>
    <button disabled>Unavailable</button>
    <fieldset disabled><button>Unavailable in fieldset</button></fieldset>
    <button>Available</button>
  </Popover>);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Available", hidden: true }));
});

test("popover focus skips hidden and inert branches, honoring explicit autofocus", () => {
  render(<Popover label="Actions" trigger={p => <button {...p}>Open</button>}>
    <div hidden><button data-autofocus>Hidden</button></div>
    <div inert><button data-autofocus>Inert</button></div>
    <button>Ordinary first action</button>
    <input aria-label="Search" data-autofocus />
  </Popover>);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(document.activeElement).toBe(screen.getByLabelText("Search"));
});

test("menu repeated letters cycle matching actions and a new opening resets the query", () => {
  render(<Menu label="Actions" trigger={p => <button {...p}>Open</button>} items={[
    { id: "add", label: "Add", onSelect: () => {} },
    { id: "copy", label: "Copy", onSelect: () => {} },
    { id: "close", label: "Close", onSelect: () => {} },
  ]} />);
  const open = screen.getByRole("button", { name: "Open" });
  fireEvent.click(open);
  const add = screen.getByRole("menuitem", { name: "Add", hidden: true });
  const copy = screen.getByRole("menuitem", { name: "Copy", hidden: true });
  const close = screen.getByRole("menuitem", { name: "Close", hidden: true });
  fireEvent.keyDown(add, { key: "c" }); expect(document.activeElement).toBe(copy);
  fireEvent.keyDown(copy, { key: "c" }); expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: "c" }); expect(document.activeElement).toBe(copy);
  fireEvent.keyDown(copy, { key: "Escape" });
  fireEvent.click(open);
  const reopened = screen.getByRole("menuitem", { name: "Add", hidden: true });
  fireEvent.keyDown(reopened, { key: "a" });
  expect(document.activeElement).toBe(reopened);
});

test("a menu opening starts a fresh prefix after the previous menu was closed", () => {
  render(<Menu label="Actions" trigger={p => <button {...p}>Open</button>} items={[
    { id: "add", label: "Add", onSelect: () => {} },
    { id: "copy", label: "Copy", onSelect: () => {} },
    { id: "close", label: "Close", onSelect: () => {} },
  ]} />);
  const open = screen.getByRole("button", { name: "Open" });
  fireEvent.click(open);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Add", hidden: true }), { key: "c" });
  fireEvent.keyDown(document.activeElement!, { key: "l" });
  expect(document.activeElement?.textContent).toBe("Close");
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  fireEvent.click(open);
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Add", hidden: true }), { key: "c" });
  expect(document.activeElement?.textContent).toBe("Copy");
});

test.each(["ctrlKey", "metaKey", "altKey"])("menu typeahead preserves %s shortcuts", modifier => {
  render(<Menu label="Actions" trigger={p => <button {...p}>Open</button>} items={[
    { id: "add", label: "Add", onSelect: () => {} },
    { id: "copy", label: "Copy", onSelect: () => {} },
  ]} />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  const first = screen.getByRole("menuitem", { name: "Add", hidden: true });
  expect(document.activeElement).toBe(first);
  const event = new KeyboardEvent("keydown", { key: "c", [modifier]: true, bubbles: true, cancelable: true });
  fireEvent(first, event);
  expect(document.activeElement).toBe(first);
  expect(event.defaultPrevented).toBe(false);
  fireEvent.keyDown(first, { key: "c" });
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy", hidden: true }));
});
