import { afterEach, expect, test } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { I18nProvider, registerRuLazy, useT } from "./index";
import ruLazy from "./ruLazy";

afterEach(cleanup);

// Effects across the app depend on `t` / `errText`. When the lazy part of the Russian dictionary arrived, a new `t` re-ran
// them all (the realtime subscription restarted). Consumers must re-render, but with the same functions.
test("t, tn and errText keep their identity when the lazy dictionary arrives", () => {
  const seen: ReturnType<typeof useT>[] = [];
  function Probe() { seen.push(useT()); return null; }
  render(<I18nProvider><Probe /></I18nProvider>);
  const before = seen.at(-1)!;
  const renders = seen.length;
  act(() => registerRuLazy({ ...ruLazy }));
  const after = seen.at(-1)!;
  expect(seen.length).toBeGreaterThan(renders); // consumers were re-rendered
  expect(after.t).toBe(before.t);
  expect(after.tn).toBe(before.tn);
  expect(after.errText).toBe(before.errText);
});
