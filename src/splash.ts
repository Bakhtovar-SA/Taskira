/** Снять стартовую заставку (`#splash` в index.html, стили — index.css). Зовётся сразу после первого рендера:
 *  дальше загрузку показывает уже оболочка (скелетоны). Знак успевает дорисоваться — ждём до ~320 мс от начала
 *  навигации (`performance.now()` считается от неё), на медленной сети это ожидание нулевое. При reduced-motion —
 *  сразу, без анимации (ТЗ 5.13 п.4). */
const DRAWN_MS = 320;

export function dismissSplash(): void {
  const el = document.getElementById("splash");
  if (!el) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    el.remove();
    return;
  }
  setTimeout(() => {
    el.setAttribute("data-out", "");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400); // анимации нет (вкладка в фоне, старый браузер) — не оставить заставку
  }, Math.max(0, DRAWN_MS - performance.now()));
}
