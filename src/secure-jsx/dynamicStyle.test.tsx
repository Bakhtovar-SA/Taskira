import { render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { dynamicStyle } from "./dynamicStyle";

afterEach(() => { document.head.innerHTML = ""; vi.restoreAllMocks(); });

describe("CSP-safe JSX runtime", () => {
  test("turns React style props into a class and leaves no style attribute", () => {
    const sheet = document.createElement("style");
    sheet.id = "taskira-dynamic-styles";
    document.head.append(sheet);
    const { getByTestId } = render(<div data-testid="box" style={{ width: 24, color: "#123456" }} />);
    const box = getByTestId("box");
    expect(box.hasAttribute("style")).toBe(false);
    expect(box.className).toMatch(/^taskira-dyn-/);
    expect(sheet.sheet?.cssRules.length).toBe(1);
  });

  test("repeated styles skip DOM parsing; changed and unsafe values are still validated", () => {
    const first = dynamicStyle({ width: 137, color: "#abcdef" });
    const create = vi.spyOn(document, "createElement");
    expect(dynamicStyle({ width: 137, color: "#abcdef" })).toBe(first);
    expect(create).not.toHaveBeenCalled();
    expect(dynamicStyle({ width: 138, color: "#abcdef" })).not.toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(dynamicStyle({ background: "url(https://example.com/image.png)" })).toBe("");
    expect(dynamicStyle({ color: "red;display:none" })).toBe("");
  });

  test("cache distinguishes numeric and string values and preserves shorthand order", () => {
    const before = dynamicStyle({ margin: 10, marginLeft: 20 });
    const after = dynamicStyle({ marginLeft: 20, margin: 10 });
    expect(after).not.toBe(before);
    expect(dynamicStyle({ width: "147" })).toBe("");
    expect(dynamicStyle({ width: 147 })).not.toBe("");
  });
});
