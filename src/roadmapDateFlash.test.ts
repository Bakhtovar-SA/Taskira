import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { RoadmapProjectDto } from "../server/src/contract";
import { flash } from "./motion";
import { beginRoadmapDateFlash, clearRoadmapDateFlash, flashConfirmedRoadmapDates, ROADMAP_FLASH_TTL_MS } from "./roadmapDateFlash";
vi.mock("./motion", () => ({ flash: vi.fn() }));
const dates = { startDate: '2026-09-01', targetDate: '2026-11-20' };
let viewport: HTMLElement, bar: HTMLElement;
const project = (over: Partial<RoadmapProjectDto> = {}) => ({ id: 'p1', ...dates, ...over }) as RoadmapProjectDto;
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
beforeEach(() => {
  vi.useFakeTimers(); clearRoadmapDateFlash();
  viewport = document.createElement('div'); viewport.innerHTML = '<div class="roadmap-timeline-row" data-project-id="p1"><button class="roadmap-bar"></button></div>';
  bar = viewport.querySelector('button')!; document.body.appendChild(viewport);
  viewport.getBoundingClientRect = () => rect(0, 0, 600, 400); bar.getBoundingClientRect = () => rect(20, 40, 200, 44);
});
afterEach(() => { clearRoadmapDateFlash(); viewport.remove(); vi.useRealTimers(); vi.clearAllMocks(); });
const show = (projects = [project()], user = 'u1', scope = 'p1') => flashConfirmedRoadmapDates(user, scope, projects, viewport);

test('load alone and unacknowledged save never flash', () => { show(); beginRoadmapDateFlash('u1', 'p1', dates); show(); expect(flash).not.toHaveBeenCalled(); });
test('one acknowledged matching edit flashes only its visible bar once', () => {
  const confirm = beginRoadmapDateFlash('u1', 'p1', dates); confirm(); confirm();
  show([project(), project({ id: 'p2' })]); show(); expect(flash).toHaveBeenCalledExactlyOnceWith(bar);
  expect(vi.getTimerCount()).toBe(0);
});
test('clear on session/project invalidation also rejects in-flight confirmation', () => {
  const confirm = beginRoadmapDateFlash('u1', 'p1', dates); clearRoadmapDateFlash(); confirm(); show(); expect(flash).not.toHaveBeenCalled();
});
test('a newer failed save invalidates an older success and old async confirmation', () => {
  const old = beginRoadmapDateFlash('u1', 'p1', dates); old(); beginRoadmapDateFlash('u1', 'p1', { ...dates, targetDate: '2026-11-21' }); old(); show(); expect(flash).not.toHaveBeenCalled();
});
for (const [user, scope] of [['u2', 'p1'], ['u1', 'p2']]) test(`foreign scope ${user}/${scope} consumes without flashing`, () => {
  beginRoadmapDateFlash('u1', 'p1', dates)(); show(undefined, user, scope); show(); expect(flash).not.toHaveBeenCalled();
});
test('different server dates consume without flashing a later matching revalidation', () => {
  beginRoadmapDateFlash('u1', 'p1', dates)(); show([project({ targetDate: '2026-11-22' })]); show(); expect(flash).not.toHaveBeenCalled();
});
test('virtualized row consumes without flashing when scrolling later mounts it', () => {
  beginRoadmapDateFlash('u1', 'p1', dates)(); bar.remove(); show(); viewport.firstElementChild!.appendChild(bar); show(); expect(flash).not.toHaveBeenCalled();
});
test('rendered overscan row outside clip does not flash later on scroll or zoom', () => {
  beginRoadmapDateFlash('u1', 'p1', dates)(); bar.getBoundingClientRect = () => rect(20, 500, 200, 44); show();
  bar.getBoundingClientRect = () => rect(20, 40, 200, 44); show(); expect(flash).not.toHaveBeenCalled();
});
test('TTL removes the marker and its sole timer', () => {
  beginRoadmapDateFlash('u1', 'p1', dates)(); expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(ROADMAP_FLASH_TTL_MS); show(); expect(flash).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
