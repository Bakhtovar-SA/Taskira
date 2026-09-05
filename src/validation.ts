/**
 * Валидация и санитизация пользовательского ввода (Этап 1).
 *
 * Принципы:
 *  - Лимиты и правила описаны ОДИН раз здесь; сервер зеркалит их zod-схемами
 *    (server/src/contract.ts). Клиентская проверка — только для UX,
 *    сервер повторяет каждую проверку.
 *  - React экранирует вывод автоматически (dangerouslySetInnerHTML в проекте нет),
 *    поэтому здесь боремся с мусором: управляющие символы, лишние пробелы, длина.
 */

export const LIMITS = {
  title: { min: 1, max: 250 },
  description: { max: 5000 },
  comment: { min: 1, max: 2000 },
  label: { max: 30 },
  labelsPerIssue: 10,
  points: { min: 0, max: 100 },
  goal: { max: 200 },
  username: { min: 3, max: 32 },
} as const;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/* Управляющие символы (кроме \n и \t, они нужны в описаниях) */
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Однострочный текст: убирает переводы строк и сжимает пробелы */
export const sanitizeLine = (s: string): string =>
  s.replace(CTRL, "").replace(/\s+/g, " ").trim();

/** Многострочный текст: нормализует \r\n, сжимает пустые строки, режет длину */
export const sanitizeText = (s: string, max: number): string =>
  s.replace(CTRL, "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);

/** Метка: lowercase, без пробелов по краям, максимум LIMITS.label */
export const sanitizeLabel = (s: string): string =>
  s.replace(CTRL, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, LIMITS.label.max);

export function validateTitle(raw: string): Result<string> {
  const v = sanitizeLine(raw).slice(0, LIMITS.title.max + 1);
  if (v.length < LIMITS.title.min) return { ok: false, error: "Название задачи не может быть пустым" };
  if (v.length > LIMITS.title.max)
    return { ok: false, error: `Название длиннее ${LIMITS.title.max} символов — сократите его` };
  return { ok: true, value: v };
}

export function validateDescription(raw: string): Result<string> {
  const v = sanitizeText(raw, LIMITS.description.max + 1);
  if (v.length > LIMITS.description.max)
    return { ok: false, error: `Описание длиннее ${LIMITS.description.max} символов` };
  return { ok: true, value: v };
}

export function validateComment(raw: string): Result<string> {
  const v = sanitizeText(raw, LIMITS.comment.max + 1);
  if (v.length < LIMITS.comment.min) return { ok: false, error: "Комментарий не может быть пустым" };
  if (v.length > LIMITS.comment.max)
    return { ok: false, error: `Комментарий длиннее ${LIMITS.comment.max} символов` };
  return { ok: true, value: v };
}

export function validateLabels(raw: string[]): Result<string[]> {
  const uniq = [...new Set(raw.map(sanitizeLabel).filter(Boolean))];
  if (uniq.length > LIMITS.labelsPerIssue)
    return { ok: false, error: `Не больше ${LIMITS.labelsPerIssue} меток на задачу` };
  return { ok: true, value: uniq };
}

export function validatePoints(raw: number | null): Result<number | null> {
  if (raw === null) return { ok: true, value: null };
  if (!Number.isFinite(raw) || !Number.isInteger(raw))
    return { ok: false, error: "Оценка должна быть целым числом" };
  if (raw < LIMITS.points.min || raw > LIMITS.points.max)
    return { ok: false, error: `Оценка — от ${LIMITS.points.min} до ${LIMITS.points.max} очков` };
  return { ok: true, value: raw };
}

export function validateGoal(raw: string): Result<string> {
  const v = sanitizeLine(raw).slice(0, LIMITS.goal.max);
  return { ok: true, value: v };
}
