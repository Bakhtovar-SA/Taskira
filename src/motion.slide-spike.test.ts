import { afterEach, expect, test, vi } from "vitest";
import { setReducedMotion, slide, stopMotion } from "./motion";
afterEach(() => { setReducedMotion(false); vi.unstubAllGlobals(); });
function grid() {
  vi.stubGlobal('matchMedia', () => ({ matches: false })); setReducedMotion(false);
  const node = document.createElement('div'), cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel, finished: new Promise<void>(() => undefined) } as unknown as Animation));
  node.animate = animate; return { node, animate, cancel };
}
for (const dir of [-1, 1] as const) test(`slide direction ${dir} is one bounded300ms animation`, () => {
  const { node, animate, cancel } = grid(); slide(node, dir);
  expect(animate).toHaveBeenCalledExactlyOnceWith([{ opacity: 0.4, transform: `translateX(${dir * 12}px)` }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' });
  stopMotion(node); expect(cancel).toHaveBeenCalledOnce();
});
test('reduced slide cancels the previous grid animation and creates no replacement', () => {
  const { node, animate, cancel } = grid(); slide(node, 1); setReducedMotion(true); slide(node, -1);
  expect(animate).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
});
