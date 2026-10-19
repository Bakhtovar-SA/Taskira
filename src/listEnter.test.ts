import { expect, test, vi } from "vitest";
import { createEnterTracker } from "./listEnter";
import { enter, motionReduced, MOTION_CAPS } from "./motion";
vi.mock("./motion", async importOriginal => ({ ...(await importOriginal<typeof import("./motion")>()), enter: vi.fn(), motionReduced: vi.fn(() => false) }));

for (const count of [MOTION_CAPS.enter, MOTION_CAPS.enter + 1]) test("entry ceiling: " + count, () => {
  vi.mocked(enter).mockClear();
  const track = createEnterTracker(), el = document.createElement('div');
  track(['first'], () => el, true);
  const ids = ['first', ...Array.from({ length: count }, (_, i) => String(i))];
  expect(track(ids, () => el, false)).toBe(count <= MOTION_CAPS.enter ? count : 0);
  expect(enter).toHaveBeenCalledTimes(count <= MOTION_CAPS.enter ? count : 0);
});

test("reduced motion and filter baselines suppress entry", () => {
  vi.mocked(enter).mockClear();
  const track = createEnterTracker(), el = document.createElement('div');
  track(['a'], () => el, true);
  vi.mocked(motionReduced).mockReturnValue(true);
  expect(track(['a', 'b'], () => el, false)).toBe(0);
  vi.mocked(motionReduced).mockReturnValue(false);
  expect(track(['c'], () => el, true)).toBe(0);
  expect(enter).not.toHaveBeenCalled();
});

test("tracking above 200 clears the entry baseline and a smaller list rebases", () => {
  vi.mocked(enter).mockClear();
  const track = createEnterTracker(), el = document.createElement('div'), find = vi.fn(() => el);
  track(['a'], find, true); find.mockClear();
  expect(track(Array.from({ length: MOTION_CAPS.track + 1 }, (_, i) => String(i)), find, false)).toBe(0);
  expect(find).not.toHaveBeenCalled();
  expect(track(['small'], find, false)).toBe(0);
  expect(track(['small', 'new'], find, false)).toBe(1);
});

test("entry history is bounded even when short lists are repeatedly replaced", () => {
  vi.mocked(enter).mockClear();
  const track = createEnterTracker(), el = document.createElement('div');
  track(['first'], () => el, true);
  for (let i = 0; i < MOTION_CAPS.track - 1; i++) expect(track([String(i)], () => el, false)).toBe(1);
  expect(track(['rebase'], () => el, false)).toBe(0);
  expect(track(['rebase', 'next'], () => el, false)).toBe(1);
});
