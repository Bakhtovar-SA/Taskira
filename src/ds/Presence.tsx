import { Fragment, useEffect, useState, type ReactNode } from "react";

/** Страховка Dialog: сколько ждать animationend при закрытии (уход — --dur-2, 200 мс). Живёт здесь, а не в Dialog.tsx,
 *  чтобы App.tsx во входном чанке не тянул Dialog ради одной константы. */
export const DIALOG_EXIT_MS = 300;

/** Окно, которое родитель монтирует по условию (`{open && <X/>}`), при закрытии снималось бы сразу, без анимации
 *  ухода. `Presence` держит его смонтированным, пока `Dialog` доигрывает закрытие, и передаёт `open` дальше:
 *  `<Presence show={createOpen}>{(open) => <CreateIssueModal open={open} />}</Presence>`. Каждое новое открытие —
 *  новый экземпляр (свежая форма), даже если прошлое ещё уходит. Без анимаций (jsdom, reduced motion) — снимает сразу. */
export function Presence({ show, children }: { show: boolean; children: (open: boolean) => ReactNode }) {
  const [prev, setPrev] = useState(show);
  const [gen, setGen] = useState(0);
  const [mounted, setMounted] = useState(show);
  if (show !== prev) {
    setPrev(show);
    if (show) {
      setGen((g) => g + 1);
      setMounted(true);
    }
  }
  useEffect(() => {
    if (show || !mounted) return;
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof Element.prototype.getAnimations !== "function") {
      setMounted(false);
      return;
    }
    const timer = setTimeout(() => setMounted(false), DIALOG_EXIT_MS + 20); // Dialog успевает снять себя первым
    return () => clearTimeout(timer);
  }, [show, mounted]);
  return mounted ? <Fragment key={gen}>{children(show)}</Fragment> : null;
}
