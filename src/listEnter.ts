/** ADR-0035 (Accepted, прототип): пружинное появление строк, которые добавились в уже показанный список (новая задача
 *  в списке задач, новое событие во Входящих). Первый показ, смена фильтра/запроса, догрузка страницы — «базовая
 *  линия»: строки просто запоминаются. Больше `cap` новых строк разом — мгновенно (VDI, не сотни WAAPI сразу, как
 *  `MAX_ANIMATED` у доски). Ни одного состояния React: вызывается из layout-эффекта, анимация — `enter()` (WAAPI). */
import { enter, motionReduced } from "./motion";

export const LIST_ENTER_CAP = 8;

export type EnterTracker = (ids: readonly string[], find: (id: string) => HTMLElement | null | undefined, baseline: boolean) => number;

/** Возвращает функцию «после коммита»: ей передают id строк в порядке показа, поиск элемента строки и признак базовой
 *  линии; она проигрывает `enter` для новых строк и возвращает их число (0, если ничего не анимировалось). */
export function createEnterTracker(cap = LIST_ENTER_CAP): EnterTracker {
  let seen: Set<string> | null = null;
  return (ids, find, baseline) => {
    if (baseline || !seen) {
      seen = new Set(ids);
      return 0;
    }
    const fresh = ids.filter((id) => !seen!.has(id));
    for (const id of fresh) seen.add(id);
    if (!fresh.length || fresh.length > cap || motionReduced()) return 0;
    let n = 0;
    for (const id of fresh) {
      const el = find(id);
      if (el) {
        enter(el, "rise");
        n++;
      }
    }
    return n;
  };
}
