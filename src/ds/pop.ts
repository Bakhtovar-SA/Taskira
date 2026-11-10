/** Открытие и закрытие элемента с атрибутом `popover` без `@floating-ui/dom`: модулям входного чанка (тосты в
 *  `ui.tsx`) нужны только эти две функции, а позиционирование (`floating.ts`) приходит ленивым чанком. */
/** showPopover/hidePopover бросают, если состояние уже такое; в jsdom их нет вовсе. */
export const showPop = (el: HTMLElement | null) => {
  try {
    if (el && !el.matches(":popover-open")) el.showPopover?.();
  } catch {
    /* уже открыт или API нет (jsdom) */
  }
};
export const hidePop = (el: HTMLElement | null) => {
  try {
    if (el?.matches(":popover-open")) el.hidePopover?.();
  } catch {
    /* уже закрыт или API нет */
  }
};
