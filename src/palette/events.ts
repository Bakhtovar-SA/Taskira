/** Открыть командную палитру из любого места (кнопка в шапке) — событие на
 *  window, а не поле стора: изменение стора перерисовало бы всё дерево. */
export const OPEN_PALETTE_EVT = "taskira:palette";
export const openPalette = () => window.dispatchEvent(new Event(OPEN_PALETTE_EVT));

/** «⌘K» на Mac, «Ctrl K» на остальных — подпись в подсказках. */
export const paletteShortcut = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K";
