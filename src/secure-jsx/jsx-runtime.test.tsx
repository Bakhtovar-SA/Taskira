import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { jsx, jsxs } from "./jsx-runtime";

/** UI-01: статичные дети (`jsxs`) раньше уходили в React массивом в props.children, и dev-сборка требовала `key` у каждого —
 *  предупреждения «unique key» были почти на каждом экране. Проверяем по консоли, а не по устройству кода. */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const keyWarnings = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((args: unknown[]) => args.some((a: unknown) => typeof a === "string" && a.includes("key"))).length;

test("статичные дети через jsxs — без предупреждения о key, порядок сохранён", () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const { container } = render(jsxs("p", { children: [createElement("b", null, "1"), createElement("i", null, "2")] }));
  expect(container.innerHTML).toBe("<p><b>1</b><i>2</i></p>");
  expect(keyWarnings(err)).toBe(0);
});

test("настоящий список через jsx по-прежнему требует key — предупреждение не заглушено", () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  render(jsx("ul", { children: [createElement("li", null, "a"), createElement("li", null, "b")] }));
  expect(keyWarnings(err)).toBeGreaterThan(0);
});

test("production factory preserves CSP styles, keys and static children", () => {
  vi.stubEnv("PROD", true);
  const el = jsxs("div", {
    style: { maxWidth: 312 },
    className: "original",
    children: [jsx("b", { children: "1" }), jsx("i", { children: "2" })],
  }, "item");
  expect(el.key).toBe("item");
  const { container } = render(el);
  const box = container.firstElementChild!;
  expect(box.hasAttribute("style")).toBe(false);
  expect(box.classList.contains("original")).toBe(true);
  expect(box.classList.length).toBe(2);
  expect(box.innerHTML).toBe("<b>1</b><i>2</i>");
});
