import { useCallback, useLayoutEffect, useRef } from "react";
import { markPendingEl, type PendingTarget } from "./pending";

/** Every caller owns its element(s), and scope/unmount cancels every delayed mark. */
export function usePendingMarks(scope: string | null | undefined) {
  const active = useRef(new Set<() => void>());
  useLayoutEffect(() => () => { for (const clear of active.current) clear(); active.current.clear(); }, [scope]);
  return useCallback(async <T,>(targets: readonly PendingTarget[], action: () => Promise<T>): Promise<T> => {
    const clear = () => clears.forEach(stop => stop());
    const clears = targets.map(target => markPendingEl(target));
    active.current.add(clear);
    try { return await action(); }
    finally { clear(); active.current.delete(clear); }
  }, []);
}
