/** A delayed, static acknowledgement. Fast requests never paint a pending mark. */
export const PENDING_DELAY_MS = 150;
export type PendingTarget = HTMLElement | null | (() => HTMLElement | null);
const owners = new WeakMap<HTMLElement, () => void>();
export function markPendingEl(target: PendingTarget, delay = PENDING_DELAY_MS): () => void {
  let marked: HTMLElement | null = null, pending: string | null = null, busy: string | null = null;
  const clear = () => {
    window.clearTimeout(timer);
    if (!marked || owners.get(marked) !== clear) return;
    owners.delete(marked);
    if (pending === null) marked.removeAttribute("data-pending"); else marked.setAttribute("data-pending", pending);
    if (busy === null) marked.removeAttribute("aria-busy"); else marked.setAttribute("aria-busy", busy);
    marked = null;
  };
  const timer = window.setTimeout(() => {
    const node = typeof target === "function" ? target() : target;
    if (!node?.isConnected) return;
    owners.get(node)?.();
    marked = node;
    pending = node.getAttribute("data-pending");
    busy = node.getAttribute("aria-busy");
    owners.set(node, clear);
    node.setAttribute("data-pending", "");
    node.setAttribute("aria-busy", "true");
  }, delay);
  return clear;
}
