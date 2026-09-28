/** Движение (ТЗ 5.13, ADR-0015): переходы навигации через View Transitions и FLIP на WAAPI — без библиотеки.
 *  Всё прерываемо (новый startViewTransition отменяет прежний, новая WAAPI-анимация на том же свойстве —
 *  предыдущую), всё уважает prefers-reduced-motion. */
import { flushSync } from "react-dom";

export const reducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
};

type VTDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

/** Смена представления или открытие задачи полной страницей: короткое перекрёстное затухание (--dur-2,
 *  правила — `html.vt-nav` в index.css). Нет API, reduced-motion или вкладка скрыта — мгновенно. */
export function viewTransition(update: () => void): void {
  const doc = document as VTDoc;
  if (!doc.startViewTransition || reducedMotion() || document.visibilityState !== "visible") {
    update();
    return;
  }
  const root = document.documentElement;
  root.classList.add("vt-nav");
  doc
    .startViewTransition(() => flushSync(update))
    .finished.finally(() => root.classList.remove("vt-nav"))
    .catch(() => undefined);
}

/** FLIP: элемент уже на новом месте; анимируем его из старой точки (left/top во viewport) — --dur-4, ease-out. */
export function flipFrom(el: HTMLElement, left: number, top: number): void {
  if (reducedMotion() || typeof el.animate !== "function") return;
  const last = el.getBoundingClientRect();
  const dx = left - last.left;
  const dy = top - last.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(1.035)` }, { transform: "none" }], {
    duration: 300,
    easing: "cubic-bezier(0.16, 1, 0.3, 1)",
  });
}
