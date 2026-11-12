import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

// The English dictionary chunk never loads in this file.
vi.mock("./en", () => { throw new Error("chunk failed to load"); });

import { I18nProvider, useT } from "./index";

afterEach(cleanup);

// Before: the choice was written to localStorage right away, so after a failed load the UI stayed in the old language
// but the next reload started in the new one, and the rejection went unhandled.
test("a language whose dictionary fails to load is neither applied nor remembered", async () => {
  localStorage.removeItem("taskira.lang");
  let ctx!: ReturnType<typeof useT>;
  function Probe() { ctx = useT(); return null; }
  render(<I18nProvider><Probe /></I18nProvider>);
  expect(ctx.lang).toBe("ru");
  act(() => ctx.setLang("en"));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
  expect(ctx.lang).toBe("ru");
  expect(localStorage.getItem("taskira.lang")).toBeNull();
});
