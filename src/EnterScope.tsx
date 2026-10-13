/** ADR-0035 (прототип): контейнер списка, в который добавляются элементы по ходу работы (комментарии и события ленты
 *  задачи, пункты чек-листа). Элемент с `data-enter-id` в списке `ids`, которого не было раньше, появляется
 *  пружиной (`enter` «rise»). «Базовая линия» — первый непустой набор после показа (и после смены `resetKey` — другая
 *  задача, другая вкладка ленты): то, что подгрузилось при открытии, не анимируется — как бы медленно ни пришёл ответ
 *  сервера. Анимируется только добавленное после него. Известный пробел прототипа: у задачи без комментариев (вкладка
 *  пуста) или с пустым чек-листом первый добавленный элемент сам становится базовой линией и не анимируется — флага
 *  «ответ сервера пришёл» у карточки нет (деталь грузится отдельно от списка), а выводить его из пустоты нельзя. */
import { useLayoutEffect, useRef, type HTMLAttributes } from "react";
import { createEnterTracker, type EnterTracker } from "./listEnter";

type Props = HTMLAttributes<HTMLDivElement> & { ids: readonly string[]; resetKey: string };

export function EnterScope({ ids, resetKey, children, ...rest }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const state = useRef<{ key: string; primed: boolean; track: EnterTracker } | null>(null);
  const sig = ids.join("\u0000");
  useLayoutEffect(() => {
    if (!state.current || state.current.key !== resetKey) state.current = { key: resetKey, primed: false, track: createEnterTracker() };
    const s = state.current;
    s.track(ids, (id) => root.current?.querySelector<HTMLElement>(`[data-enter-id="${CSS.escape(id)}"]`), !s.primed);
    if (ids.length) s.primed = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids сравниваем по подписи sig
  }, [sig, resetKey]);
  return (
    <div ref={root} {...rest}>
      {children}
    </div>
  );
}
