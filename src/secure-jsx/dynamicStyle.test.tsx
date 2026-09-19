import { render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

afterEach(() => { document.head.innerHTML = ""; });

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
});
