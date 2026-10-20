import type { Toast } from "../types";
import type { ExternalStore } from "./external";

/** One queue per provider. Pausing preserves the remaining lifetime, including keyboard focus on actions. */
export function createToastQueue(store: ExternalStore<Toast[]>, lifetime = 4200) {
  let sequence = 1;
  const timers = new Map<number, () => void>();
  let unsubscribe: (() => void) | undefined, connected = false;
  const prune = () => {
    const live = new Set(store.getState().map(item => item.id));
    for (const [id,cancel] of timers) if (!live.has(id)) { cancel(); timers.delete(id); }
  };
  const connect = () => {
    if (connected) return;
    connected = true; prune(); unsubscribe = store.subscribe(prune);
    for (const item of store.getState()) item.resume?.();
  };
  const push = (kind: Toast["kind"], text: string, action?: Toast["action"]) => {
    const id = sequence++;
    let timer: ReturnType<typeof setTimeout> | undefined, remaining = lifetime, started = 0;
    const pause = () => {
      if (timer === undefined) return;
      clearTimeout(timer); timer = undefined;
      remaining = Math.max(0, remaining - (performance.now() - started));
    };
    const dismiss = () => {
      pause(); timers.delete(id);
      store.setState(items => items.some(item => item.id === id) ? items.filter(item => item.id !== id) : items);
    };
    const resume = () => {
      if (!connected || timer !== undefined || !timers.has(id)) return;
      started = performance.now(); timer = setTimeout(dismiss, remaining);
    };
    timers.set(id, pause);
    store.setState(items => {
      for (const old of items.slice(0, Math.max(0, items.length - 3))) { timers.get(old.id)?.(); timers.delete(old.id); }
      return [...items.slice(-3), { id, kind, text, action, pause, resume, dismiss }];
    });
    resume();
  };
  return { push, connect, dispose: () => { unsubscribe?.(); unsubscribe = undefined; connected = false; for (const cancel of timers.values()) cancel(); } };
}
