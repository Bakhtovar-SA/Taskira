/** Открыть командную палитру из любого места (кнопка в шапке) — событие на
 *  window, а не поле стора: изменение стора перерисовало бы всё дерево. */
export const OPEN_PALETTE_EVT = "taskira:palette";
export const openPalette = () => window.dispatchEvent(new Event(OPEN_PALETTE_EVT));

/** «⌘K» на Mac, «Ctrl K» на остальных — подпись в подсказках. */
export const paletteShortcut = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K";

/** Мастер создания проекта (ТЗ 5.10) — тоже событием: открывают его «Отделы и проекты», дерево проектов и палитра. */
export const OPEN_PROJECT_WIZARD_EVT = "taskira:project-wizard";
export const openProjectWizard = (departmentId?: string) => window.dispatchEvent(new CustomEvent(OPEN_PROJECT_WIZARD_EVT, { detail: { departmentId } }));
