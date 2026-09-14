/** Импорт из Trello (JSON-экспорт доски — «Меню → Ещё → Печать и экспорт →
 *  Экспортировать как JSON»). Публичный, стабильный, однофайловый формат —
 *  выбран из трёх обсуждавшихся (Trello/Jira/Asana) как единственный, чей
 *  парсер можно честно покрыть тестами на заранее известной схеме без
 *  доступа к реальному экспорту из живого аккаунта. Импорт из Jira/Asana —
 *  свой формат и свой парсер каждый, за рамками этой ветки.
 *
 *  Разбор — чистые функции без побочных эффектов: сам импорт (создание
 *  задач через уже существующий POST /issues, со всеми его правами и
 *  валидацией) делает store.importIssues(), не этот модуль. */
import { sanitizeLabel, sanitizeLine } from "../validation";

export interface TrelloImportItem {
  title: string;
  description: string;
  labels: string[];
  /** YYYY-MM-DD или null. */
  dueDate: string | null;
  /** Карточка была архивирована в Trello (поле closed). */
  closed: boolean;
}

export interface TrelloParseResult {
  boardName: string;
  items: TrelloImportItem[];
  /** Карточки без валидного name — пропущены, но не должны молча исчезать. */
  skipped: number;
}

interface TrelloList {
  id: string;
  name: string;
}

interface TrelloLabel {
  name?: string;
  color?: string;
}

interface TrelloCard {
  id: string;
  name?: string;
  desc?: string;
  idList?: string;
  closed?: boolean;
  due?: string | null;
  labels?: TrelloLabel[];
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

/** Бросает Error с понятным текстом, а не наступает на undefined ниже —
 *  файл может быть JSON-экспортом чего угодно, не только доски Trello. */
export function parseTrelloExport(raw: unknown): TrelloParseResult {
  if (!raw || typeof raw !== "object") throw new Error("Файл не похож на экспорт Trello — это не JSON-объект");
  const board = raw as Record<string, unknown>;

  const rawLists = board.lists;
  const rawCards = board.cards;
  if (!Array.isArray(rawLists) || !Array.isArray(rawCards)) {
    throw new Error('Файл не похож на экспорт доски Trello — нет полей "lists"/"cards"');
  }

  const listNameById = new Map<string, string>();
  for (const l of rawLists as unknown[]) {
    if (!l || typeof l !== "object") continue;
    const list = l as Record<string, unknown>;
    if (isString(list.id) && isString(list.name)) listNameById.set(list.id, list.name);
  }

  const items: TrelloImportItem[] = [];
  let skipped = 0;

  for (const c of rawCards as unknown[]) {
    if (!c || typeof c !== "object") {
      skipped++;
      continue;
    }
    const card = c as TrelloCard;
    const title = isString(card.name) ? sanitizeLine(card.name) : "";
    if (!title) {
      skipped++;
      continue;
    }

    const listName = card.idList ? listNameById.get(card.idList) : undefined;
    const trelloLabels = Array.isArray(card.labels)
      ? card.labels.map((l) => l?.name).filter((n): n is string => isString(n) && n.trim().length > 0)
      : [];
    const labels = [...new Set([...(listName ? [`trello:${listName}`] : []), ...trelloLabels].map(sanitizeLabel).filter(Boolean))];

    const dueDate = isString(card.due) ? card.due.slice(0, 10) : null;

    items.push({
      title,
      description: isString(card.desc) ? card.desc : "",
      labels,
      dueDate,
      closed: card.closed === true,
    });
  }

  const boardName = isString(board.name) ? board.name : "Trello-доска";
  return { boardName, items, skipped };
}
