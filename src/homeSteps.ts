/** User-scoped UI preferences, independent of the server's five-step onboarding. */
import { useEffect, useState } from "react";
export type HomeStep = "profile" | "create" | "invite" | "shortcuts";
type Steps = Partial<Record<HomeStep | "hidden", boolean>>;
const event = "taskira:home-steps";
const key = (userId: string) => `taskira.home.steps.${userId}`;
const memory = new Map<string, Steps>();
export function readHomeSteps(userId: string): Steps {
  try {
    const stored = localStorage.getItem(key(userId));
    if (!stored) return memory.get(userId) ?? {};
    const value: unknown = JSON.parse(stored);
    if (value && typeof value === "object") return Object.fromEntries(["profile", "create", "invite", "shortcuts", "hidden"].filter(k => (value as Record<string, unknown>)[k] === true).map(k => [k, true]));
  } catch { /* Private mode: keep preferences for this session. */ }
  return memory.get(userId) ?? {};
}
export function markHomeStep(userId: string, step: HomeStep | "hidden") {
  if (!userId) return;
  const next = { ...readHomeSteps(userId), [step]: true };
  try { localStorage.setItem(key(userId), JSON.stringify(next)); memory.delete(userId); } catch { memory.set(userId, next); }
  window.dispatchEvent(new Event(event));
}
export function useHomeSteps(userId: string) {
  const [steps, setSteps] = useState(() => readHomeSteps(userId));
  useEffect(() => {
    const update = () => setSteps(readHomeSteps(userId));
    update();
    window.addEventListener(event, update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener(event, update); window.removeEventListener("storage", update); };
  }, [userId]);
  return steps;
}
