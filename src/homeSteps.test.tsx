import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { markHomeStep, readHomeSteps, useHomeSteps } from "./homeSteps";
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
test("accepts only known boolean flags, scopes each account, and tolerates malformed settings", () => {
  localStorage.setItem("taskira.home.steps.a", JSON.stringify({ create: true, hidden: "true", invite: 1, other: true }));
  expect(readHomeSteps("a")).toEqual({ create: true });
  expect(readHomeSteps("b")).toEqual({});
  localStorage.setItem("taskira.home.steps.a", "broken");
  expect(readHomeSteps("a")).toEqual({});
});
test("updates mounted home and switches accounts without copying progress", () => {
  const { result, rerender } = renderHook(({ id }) => useHomeSteps(id), { initialProps: { id: "a" } });
  act(() => markHomeStep("a", "create"));
  expect(result.current).toEqual({ create: true });
  rerender({ id: "b" }); expect(result.current).toEqual({});
  act(() => markHomeStep("b", "hidden"));
  expect(readHomeSteps("a")).toEqual({ create: true });
  expect(result.current).toEqual({ hidden: true });
});
test("keeps UI progress in memory if storage writes are blocked", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  markHomeStep("private-mode", "create");
  markHomeStep("private-mode", "shortcuts");
  expect(readHomeSteps("private-mode")).toEqual({ create: true, shortcuts: true });
});
