import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createEnterTracker, LIST_ENTER_CAP } from "../listEnter";
import { motionReduced, stopMotion } from "../motion";

type Ready = (ids: readonly string[], loading: boolean) => void;
/** One disclosure per user expansion; initial URL/filter loads and pagination are baselines. */
export function BoardDoneTail({ id, animate, children }: { id: string; animate: boolean; children: (ready: Ready) => ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  const initialIntent = useRef(animate);
  const focused = useRef<HTMLElement | null>(null);
  const revealed = useRef(false);
  const entries = useRef(createEnterTracker());
  const [rows, setRows] = useState<{ ids: readonly string[]; loading: boolean }>({ ids: [], loading: true });
  const [animating, setAnimating] = useState(false);
  const ready = useCallback<Ready>((ids, loading) => {
    if (focused.current && !focused.current.isConnected && document.activeElement === document.body) {
      document.getElementById(id + "-toggle")?.focus({ preventScroll: true });
    }
    // One overflow ID is enough to enforce the cap; never retain a growing paginated history.
    const next = ids.length > LIST_ENTER_CAP + 1 ? ids.slice(0, LIST_ENTER_CAP + 1) : ids;
    setRows(previous => previous.loading === loading && previous.ids.length === next.length && previous.ids.every((value, index) => value === next[index])
      ? previous : { ids: next, loading });
  }, [id]);
  useLayoutEffect(() => {
    if (revealed.current || rows.loading || !rows.ids.length || !body.current) return;
    revealed.current = true;
    if (!initialIntent.current || motionReduced()) return;
    setAnimating(true);
    const find = (issueId: string) => body.current?.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(issueId)}"]`);
    entries.current([], find, true);
    entries.current(rows.ids, find, false);
  }, [rows, id]);
  useLayoutEffect(() => {
    const root = body.current, host = root?.parentElement;
    const finish = (event: Event) => { if (event.target === host) setAnimating(false); };
    host?.addEventListener("animationend", finish); host?.addEventListener("animationcancel", finish);
    return () => {
      host?.removeEventListener("animationend", finish); host?.removeEventListener("animationcancel", finish);
      for (const row of root?.querySelectorAll<HTMLElement>("[data-issue-id]") ?? []) stopMotion(row);
    };
  }, []);
  return <div id={id} data-done-tail onFocusCapture={event => { focused.current = event.target as HTMLElement; }} className={"board-done-tail" + (animating ? " anim-done-tail" : "")}>
    <div ref={body} className="board-done-tail-body">{children(ready)}</div>
  </div>;
}
