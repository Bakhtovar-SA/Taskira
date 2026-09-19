import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Dropdown } from "./ui";

describe("Dropdown", () => {
  test("закрывается по pointerdown вне меню", () => {
    render(
      <div>
        <Dropdown button={() => <button>trigger</button>}><span>menu content</span></Dropdown>
        <button>outside</button>
      </div>,
    );
    fireEvent.click(screen.getByText("trigger"));
    expect(screen.getByText("menu content")).toBeTruthy();
    fireEvent.pointerDown(screen.getByText("outside"));
    expect(screen.queryByText("menu content")).toBeNull();
  });
});
