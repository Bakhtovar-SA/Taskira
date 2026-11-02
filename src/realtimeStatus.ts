export type RealtimeState = "connecting" | "live" | "recovering" | "offline" | null;
let state: RealtimeState = null;
const listeners = new Set<() => void>();

export const getRealtimeState = (): RealtimeState => state;
export function setRealtimeState(next: RealtimeState): void {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener();
}
export function subscribeRealtimeState(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
