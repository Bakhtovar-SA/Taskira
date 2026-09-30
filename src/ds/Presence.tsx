import { Fragment, useEffect, useState, type ReactNode } from "react";

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
    if (reduce || typeof Element.prototype.getAnimations !== "function") return setMounted(false);
    const timer = setTimeout(() => setMounted(false), 320); // чуть дольше страховки Dialog (300 мс)
    return () => clearTimeout(timer);
  }, [show, mounted]);
  return mounted ? <Fragment key={gen}>{children(show)}</Fragment> : null;
}
