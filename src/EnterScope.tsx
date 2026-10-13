/** ADR-0035 (прототип): контейнер списка, в который добавляются элементы по ходу работы (комментарии и события ленты
 *  задачи, пункты чек-листа). Элемент с `data-enter-id` в списке `ids`, которого не было раньше, появляется
 *  пружиной (`enter` «rise»). Первые `SETTLE_MS` после показа (и после смены `resetKey` — другая задача, другая вкладка
 *  ленты) — «базовая линия»: подгруженное при открытии не анимируется, только то, что добавили потом. */
import { useLayoutEffect, useRef, type HTMLAttributes } from "react";
import { createEnterTracker, type EnterTracker } from "./listEnter";

const SETTLE_MS = 800;

type Props = HTMLAttributes<HTMLDivElement> & { ids: readonly string[]; resetKey: string };

export function EnterScope({ ids, resetKey, children, ...rest }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const state = useRef<{ key: string; at: number; track: EnterTracker } | null>(null);
  const sig = ids.join("\u0000");
  useLayoutEffect(() => {
    if (!state.current || state.current.key !== resetKey) state.current = { key: resetKey, at: Date.now(), track: createEnterTracker() };
    const s = state.current;
    s.track(ids, (id) => root.current?.querySelector<HTMLElement>(`[data-enter-id="${CSS.escape(id)}"]`), Date.now() - s.at < SETTLE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids сравниваем по подписи sig
  }, [sig, resetKey]);
  return (
    <div ref={root} {...rest}>
      {children}
    </div>
  );
}
