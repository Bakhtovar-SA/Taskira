/** Онбординг на клиенте (ТЗ 5.11): прогресс «Начала работы» и закрытые подсказки.
 *
 *  Источник правды — сервер (`/api/me/onboarding`): шаги он отмечает сам по реальным действиям. Клиент только
 *  перечитывает прогресс после этих действий (`refreshOnboardingSoon()` из стора) и сообщает единственный шаг,
 *  которого сервер не видит, — смену темы. Внешнее хранилище (ADR-0011): подписаны только карточка и подсказки,
 *  остальное дерево от обновлений прогресса не перерисовывается. */
import type { OnboardingDto, OnboardingStep } from "../server/src/contract";
import { onboardingApi } from "./api";
import { createExternalStore, useExternalStore } from "./store/external";

export const STEPS: readonly OnboardingStep[] = ["open_issue", "change_status", "comment", "notifications", "theme"];

const store = createExternalStore<OnboardingDto | null>(null);

const allDone = (o: OnboardingDto) => STEPS.every((s) => o.done.includes(s));

export function loadOnboarding(): void {
  onboardingApi.get().then(
    (o) => store.setState(() => o),
    () => undefined, // онбординг необязателен — без него интерфейс просто не показывает карточку и подсказки
  );
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Перечитать прогресс после действия, которое может отметить шаг. Ничего не делает, если карточка скрыта
 *  или всё пройдено — лишних запросов после онбординга нет. */
export function refreshOnboardingSoon(): void {
  const o = store.getState();
  if (!o || o.hidden || allDone(o)) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    loadOnboarding();
  }, 400);
}

export function markThemeStep(): void {
  const o = store.getState();
  if (!o || o.done.includes("theme")) return;
  onboardingApi.markTheme().then(
    (next) => store.setState(() => next),
    () => undefined,
  );
}

export function hideOnboarding(): void {
  store.setState((o) => (o ? { ...o, hidden: true } : o));
  void onboardingApi.hide().catch(() => undefined);
}

/** Закрыть подсказку навсегда — сразу в интерфейсе, на сервере — в фоне. */
export function dismissHint(id: string): void {
  store.setState((o) => (o && !o.hints.includes(id) ? { ...o, hints: [...o.hints, id] } : o));
  void onboardingApi.dismissHint(id).catch(() => undefined);
}

export function resetOnboarding(): void {
  store.setState(() => null);
}

export const useOnboarding = () => useExternalStore(store);
/** Показывать ли подсказку: только когда прогресс загружен (иначе мигнёт и исчезнет у тех, кто её уже закрыл). */
export const useHintVisible = (id: string) => useExternalStore(store, (o) => !!o && !o.hints.includes(id));
