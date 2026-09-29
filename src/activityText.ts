/** Строка истории задачи на языке интерфейса (трек E). Событие (`ActivityEvent` из contract.ts) рисуется через
 *  словарь; запись без события — сделанная до трека E — показывается своим русским текстом, а в английском интерфейсе
 *  разбирается по известным фразам (те же, что пишет `server/src/services/activity.ts`). Незнакомая фраза остаётся как
 *  есть — это честная история, а не ошибка. Имена людей и статусов — данные, не переводятся. */
import type { ActivityEvent } from "../server/src/contract";
import type { TKey } from "./i18n";
import { fmtDate } from "./store/mappers";
import { workflowStatusName } from "./workflowStatus";

type T = (key: TKey, params?: Record<string, string | number>) => string;
const PRIORITY_IDS = ["critical", "high", "medium", "low"] as const;
const COMPLEXITY_IDS = ["simple", "medium", "hard"] as const;

export function activityLine(event: ActivityEvent | null, text: string, t: T, lang: "ru" | "en"): string {
  if (event) return eventLine(event, t, lang);
  return lang === "ru" ? text : legacyLine(text, t, lang);
}

function eventLine(e: ActivityEvent, t: T, lang: "ru" | "en"): string {
  const bulk = (b?: boolean) => (b ? t("activity.bulkSuffix") : "");
  const date = (d: string | null) => (d ? fmtDate(d, lang) : t("activity.none"));
  const status = (name: string) => workflowStatusName({ name }, t);
  switch (e.kind) {
    case "created":
      return t("activity.created");
    case "renamed":
      return t("activity.renamed");
    case "description":
      return t("activity.description");
    case "priority":
      return t("activity.priority", { from: t(`priority.${e.from}`), to: t(`priority.${e.to}`) }) + bulk(e.bulk);
    case "complexity":
      return t("activity.complexity", {
        from: e.from ? t(`complexity.${e.from}`) : t("activity.none"),
        to: e.to ? t(`complexity.${e.to}`) : t("activity.none"),
      });
    case "due":
      return t("activity.due", { from: date(e.from), to: date(e.to) });
    case "assigneeAdded":
      return t("activity.assigneeAdded", { name: e.name });
    case "assigneeRemoved":
      return t("activity.assigneeRemoved", { name: e.name });
    case "assigneeBulk":
      return t(e.cleared ? "activity.assigneeBulkCleared" : "activity.assigneeBulkSet") + t("activity.bulkSuffix");
    case "direction":
      return t("activity.direction");
    case "parent":
      return t(e.set ? "activity.parentSet" : "activity.parentUnset");
    case "labels":
      return t("activity.labels");
    case "status":
      return t("activity.status", { from: status(e.from), to: status(e.to) }) + bulk(e.bulk);
    case "checklistAdded":
      return t("activity.checklistAdded", { text: e.text });
    case "checklistRemoved":
      return t("activity.checklistRemoved");
    case "link":
      return t(e.type === "blocks" ? "activity.linkBlocks" : e.type === "blocked_by" ? "activity.linkBlockedBy" : "activity.linkRelates", { key: e.key });
  }
}

/** Русские названия приоритета и сложности из старых фраз → id, чтобы подставить перевод. */
const RU_PRIORITY: Record<string, (typeof PRIORITY_IDS)[number]> = { Критичный: "critical", Высокий: "high", Средний: "medium", Низкий: "low" };
const RU_COMPLEXITY: Record<string, (typeof COMPLEXITY_IDS)[number]> = { Простая: "simple", Средняя: "medium", Сложная: "hard" };
const BULK_RU = " (массовая операция)";

/** Запись до трека E: по фразе восстанавливаем событие и рисуем его, иначе — текст как есть. */
function legacyLine(raw: string, t: T, lang: "ru" | "en"): string {
  const isBulk = raw.endsWith(BULK_RU);
  const text = isBulk ? raw.slice(0, -BULK_RU.length) : raw;
  const e = legacyEvent(text, isBulk);
  return e ? eventLine(e, t, lang) : raw;
}

function legacyEvent(text: string, bulk: boolean): ActivityEvent | null {
  const exact: Record<string, ActivityEvent> = {
    "создал(а) задачу": { kind: "created" },
    "переименовал(а) задачу": { kind: "renamed" },
    "обновил(а) описание": { kind: "description" },
    "изменил(а) группу (эпик)": { kind: "direction" },
    "сделал(а) подзадачей другой задачи": { kind: "parent", set: true },
    "убрал(а) из подзадач": { kind: "parent", set: false },
    "обновил(а) метки": { kind: "labels" },
    "удалил(а) пункт чек-листа": { kind: "checklistRemoved" },
    "снял(а) исполнителя": { kind: "assigneeBulk", cleared: true },
    "назначил(а) исполнителя": { kind: "assigneeBulk", cleared: false },
  };
  if (exact[text]) return exact[text];
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^назначил\(а\) исполнителем (.+)$/))) return { kind: "assigneeAdded", name: m[1] };
  if ((m = text.match(/^снял\(а\) исполнителя (.+)$/))) return { kind: "assigneeRemoved", name: m[1] };
  if ((m = text.match(/^изменил\(а\) приоритет: (.+) → (.+)$/)) && RU_PRIORITY[m[1]] && RU_PRIORITY[m[2]])
    return { kind: "priority", from: RU_PRIORITY[m[1]], to: RU_PRIORITY[m[2]], bulk };
  if ((m = text.match(/^изменил\(а\) сложность: (.+) → (.+)$/)))
    return { kind: "complexity", from: RU_COMPLEXITY[m[1]] ?? null, to: RU_COMPLEXITY[m[2]] ?? null };
  if ((m = text.match(/^изменил\(а\) срок: (.+) → (.+)$/))) {
    const d = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
    return { kind: "due", from: d(m[1]), to: d(m[2]) };
  }
  if ((m = text.match(/^переместил\(а\) из «(.+)» в «(.+)»$/))) return { kind: "status", from: m[1], to: m[2], bulk };
  if ((m = text.match(/^добавил\(а\) пункт чек-листа «(.+)»$/))) return { kind: "checklistAdded", text: m[1] };
  if ((m = text.match(/^отметил\(а\), что задача блокирует (.+)$/))) return { kind: "link", type: "blocks", key: m[1] };
  if ((m = text.match(/^отметил\(а\), что задача заблокирована (.+)$/))) return { kind: "link", type: "blocked_by", key: m[1] };
  if ((m = text.match(/^связал\(а\) с (.+)$/))) return { kind: "link", type: "relates", key: m[1] };
  return null;
}
