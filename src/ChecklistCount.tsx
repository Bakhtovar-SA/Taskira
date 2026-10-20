/** D-16: acknowledge checking the last item, without flashing initial data or removals. */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { flash } from "./motion";

export function ChecklistCount({ issueId, done, total, children }: { issueId: string; done: number; total: number; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef({ issueId, done, total });
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { issueId, done, total };
    if (before.issueId === issueId && before.total > 0 && before.done < before.total && total > 0 && done === total && done > before.done && ref.current) flash(ref.current);
  }, [issueId, done, total]);
  return <span ref={ref} className="rounded-md">{children}</span>;
}
