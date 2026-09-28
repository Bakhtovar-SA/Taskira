/** Онбординг (ТЗ 5.11, миграция 20260927T1800): прогресс «Начала работы» и закрытые подсказки — по
 *  пользователю, на сервере. Шаги отмечаются сервером от реальных действий (открыл свою задачу, сменил
 *  статус, оставил комментарий, сохранил уведомления) — markStep() вызывают сами маршруты после успеха. */
import { one, q } from "../db.js";
import { ONBOARDING_STEPS, LIMIT_DISMISSED_HINTS, type OnboardingDto, type OnboardingStep } from "../contract.js";

/* Отмеченное в этом процессе — чтобы горячие маршруты (открытие задачи, комментарий) не ходили в БД
 * повторно за уже отмеченным шагом. Потеря кэша (рестарт, другой инстанс) безопасна: запрос идемпотентен. */
const marked = new Set<string>();
const MARKED_MAX = 50_000;

/** Отметить шаг. Никогда не бросает в запрос: онбординг не должен ломать настоящее действие. */
export async function markStep(userId: string, step: OnboardingStep): Promise<void> {
  const k = `${userId}:${step}`;
  if (marked.has(k)) return;
  try {
    await q(
      `INSERT INTO user_onboarding (user_id, done) VALUES ($1, ARRAY[$2]::text[])
       ON CONFLICT (user_id) DO UPDATE
         SET done = array_append(user_onboarding.done, $2), updated_at = now()
         WHERE NOT ($2 = ANY(user_onboarding.done))`,
      [userId, step],
    );
    if (marked.size >= MARKED_MAX) marked.clear();
    marked.add(k);
  } catch (e) {
    console.warn("[onboarding] не удалось отметить шаг", step, e);
  }
}

export async function getOnboarding(userId: string): Promise<OnboardingDto> {
  const row = await one<{ done: string[]; hidden: boolean; hints: string[] }>(
    `SELECT done, hidden, hints FROM user_onboarding WHERE user_id = $1`,
    [userId],
  );
  const known = new Set<string>(ONBOARDING_STEPS);
  return {
    done: (row?.done ?? []).filter((s): s is OnboardingStep => known.has(s)),
    hidden: row?.hidden ?? false,
    hints: row?.hints ?? [],
  };
}

export async function hideOnboarding(userId: string): Promise<void> {
  await q(
    `INSERT INTO user_onboarding (user_id, hidden) VALUES ($1, true)
     ON CONFLICT (user_id) DO UPDATE SET hidden = true, updated_at = now()`,
    [userId],
  );
}

/** Закрыть подсказку навсегда. Старые id вытесняются, если их накопилось больше лимита. */
export async function dismissHint(userId: string, hintId: string): Promise<void> {
  await q(
    `INSERT INTO user_onboarding (user_id, hints) VALUES ($1, ARRAY[$2]::text[])
     ON CONFLICT (user_id) DO UPDATE
       SET hints = (array_append(array_remove(user_onboarding.hints, $2), $2))[
                     greatest(1, cardinality(user_onboarding.hints) + 2 - $3) :],
           updated_at = now()`,
    [userId, hintId, LIMIT_DISMISSED_HINTS],
  );
}
