import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { markPendingEl, PENDING_DELAY_MS } from "./pending";
import { usePendingMarks } from "./usePendingMarks";

afterEach(() => { cleanup(); document.body.replaceChildren(); vi.useRealTimers(); });
function node() { const el = document.createElement("div"); document.body.append(el); return el; }
function marked(el: HTMLElement) { return el.hasAttribute("data-pending"); }

test("a fast response clears the timer without ever touching DOM attributes", () => {
  vi.useFakeTimers(); const el = node(); const mutations: MutationRecord[] = [];
  const observer = new MutationObserver(records => mutations.push(...records)); observer.observe(el, { attributes: true });
  const clear = markPendingEl(el); vi.advanceTimersByTime(PENDING_DELAY_MS - 1); clear();
  vi.advanceTimersByTime(600); mutations.push(...observer.takeRecords()); observer.disconnect();
  expect(mutations).toEqual([]); expect(marked(el)).toBe(false); expect(el.hasAttribute("aria-busy")).toBe(false);
});
test("a slow request shows a static scoped mark after 150ms and clears idempotently", () => {
  vi.useFakeTimers(); const el = node(); const sibling = node(); const clear = markPendingEl(el);
  vi.advanceTimersByTime(149); expect(marked(el)).toBe(false);
  vi.advanceTimersByTime(1); expect(marked(el)).toBe(true); expect(el.getAttribute("aria-busy")).toBe("true");
  expect(marked(sibling)).toBe(false); clear(); clear();
  expect(marked(el)).toBe(false); expect(el.hasAttribute("aria-busy")).toBe(false);
});
test("a caller's pre-existing attributes survive the mark", () => {
  vi.useFakeTimers(); const el = node(); el.setAttribute("aria-busy", "true"); el.setAttribute("data-pending", "owned");
  const clear = markPendingEl(el); vi.advanceTimersByTime(150); clear();
  expect(el.getAttribute("aria-busy")).toBe("true"); expect(el.getAttribute("data-pending")).toBe("owned");
});
test("detached elements never receive a delayed mark, and a marked detached element is cleaned", () => {
  vi.useFakeTimers(); const first = node(); const cancel = markPendingEl(first); first.remove(); vi.advanceTimersByTime(150);
  expect(marked(first)).toBe(false); cancel();
  const second = node(); const clear = markPendingEl(second); vi.advanceTimersByTime(150); second.remove(); clear();
  expect(marked(second)).toBe(false); document.body.append(second); expect(marked(second)).toBe(false);
});
test("a newer owner is not cleared by an older request finishing", () => {
  vi.useFakeTimers(); const el = node(); const old = markPendingEl(el); vi.advanceTimersByTime(150);
  const next = markPendingEl(el); vi.advanceTimersByTime(150); old(); expect(marked(el)).toBe(true);
  next(); expect(marked(el)).toBe(false); expect(el.hasAttribute("aria-busy")).toBe(false);
});
test("a deferred target is resolved at paint time, preserving board card replacement behavior", () => {
  vi.useFakeTimers(); const first = node(); const replacement = node(); let current = first;
  const clear = markPendingEl(() => current); current = replacement; vi.advanceTimersByTime(150);
  expect(marked(first)).toBe(false); expect(marked(replacement)).toBe(true); clear(); expect(marked(replacement)).toBe(false);
});

test("scope change and unmount clear both queued and visible marks, while a late response cannot clear a new scope", async () => {
  vi.useFakeTimers(); let finish: () => void = () => undefined;
  const action = () => new Promise<void>(resolve => { finish = resolve; });
  function Probe({ scope }: { scope: string }) {
    const mark = usePendingMarks(scope);
    return <button onClick={event => { void mark([event.currentTarget], action); }}>write</button>;
  }
  const screen = render(<Probe scope="first" />); const el = screen.getByRole("button");
  fireEvent.click(el); act(() => { vi.advanceTimersByTime(150); }); expect(marked(el)).toBe(true);
  screen.rerender(<Probe scope="next" />); expect(marked(el)).toBe(false);
  const previous = finish; fireEvent.click(el); act(() => { vi.advanceTimersByTime(150); });
  await act(async () => { previous(); }); expect(marked(el)).toBe(true);
  screen.unmount(); expect(marked(el)).toBe(false); await act(async () => { finish(); });
  const queued = render(<Probe scope="queued" />); const queuedNode = queued.getByRole("button"); fireEvent.click(queuedNode); queued.unmount();
  act(() => { vi.advanceTimersByTime(600); }); expect(marked(queuedNode)).toBe(false); await act(async () => { finish(); });
});

test("a rejected operation also clears all its scoped marks", async () => {
  vi.useFakeTimers(); let reject: (error: Error) => void = () => undefined;
  let result: Promise<unknown> | undefined;
  function Probe() { const mark = usePendingMarks("q"); return <button onClick={event => { result = mark([event.currentTarget], () => new Promise((_, fail) => { reject = fail; })); }}>write</button>; }
  const screen = render(<Probe />); const el = screen.getByRole("button"); fireEvent.click(el);
  const caught = result!.catch(error => error.message); act(() => { vi.advanceTimersByTime(150); }); expect(marked(el)).toBe(true);
  await act(async () => { reject(new Error("server")); await caught; }); expect(await caught).toBe("server"); expect(marked(el)).toBe(false);
});
