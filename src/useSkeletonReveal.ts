/** D-03: only a skeletonLate that actually started can introduce its content.
 * No JS delay: CSS owns the skeleton threshold. One reveal belongs to one
 * query/loading cycle; ordinary data revalidation does not create another one. */
import { useLayoutEffect, useRef, useState, type AnimationEvent as ReactAnimationEvent } from "react";
import { motionReduced } from "./motion";

type Cycle = { scope: string; pending: boolean; token: object; reveal: boolean };
export function useSkeletonReveal(scope: string, pending: boolean, hasContent: boolean) {
  const seen = useRef<object | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [previous, setCycle] = useState<Cycle>(() => ({ scope, pending, token: {}, reveal: false }));
  let cycle = previous;
  if (previous.scope !== scope || pending && !previous.pending) {
    cycle = { scope, pending, token: {}, reveal: false };
  } else if (previous.pending && !pending) {
    cycle = { ...previous, pending, reveal: seen.current === previous.token && hasContent && !motionReduced() };
  }
  // Adjust on the input transition before committing children (no extra painted frame).
  if (cycle !== previous) setCycle(cycle);
  const token = cycle.token;
  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    if (!cycle.reveal) { node.classList.remove("anim-view"); return; }
    const finish = (event: AnimationEvent) => {
      if (event.target !== node || event.animationName !== "viewIn") return;
      setCycle(current => current.token === token && current.reveal ? { ...current, reveal: false } : current);
    };
    // Cancel matters when reduce changes during the fade: do not replay it later.
    node.addEventListener("animationend", finish);
    node.addEventListener("animationcancel", finish);
    node.classList.add("anim-view");
    return () => { node.removeEventListener("animationend", finish); node.removeEventListener("animationcancel", finish); node.classList.remove("anim-view"); };
  }, [token, cycle.reveal]);
  return {
    contentRef,
    onSkeletonAnimationStart: (event: ReactAnimationEvent<HTMLDivElement>) => {
      if (pending && event.target === event.currentTarget && event.animationName === "skeletonLate" && !motionReduced()) seen.current = token;
    },
  };
}
