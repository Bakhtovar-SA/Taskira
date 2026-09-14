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
import { LIMITS, sanitizeLabel, sanitizeLine } from "../validation";

/** Простой строковый хэш (djb2-подобный) — не криптографический, только
 *  чтобы дать двум разным именам списков разные 4-значные суффиксы. */
function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 4).padStart(4, "0");
}

/** Префикс метки списка Trello — LIMITS.label.max (30) на весь префиксованный
 *  ярлык оставляет имени списка лишь ~23 символа. Простое усечение по этому
 *  бюджету (не важно, до или после добавления префикса — итоговый бюджет для
 *  имени один и тот же) схлопывало бы два РАЗНЫХ списка с общим 23-символьным
 *  началом в одну и ту же метку (ревью PR #48: "Sprint 24 — Design Review
 *  Backlog" vs "…Done"). Если имя не влезает в бюджет целиком, отрезаем под
 *  него ещё и хэш-суффикс полного (неусечённого) имени — коллизия остаётся
 *  теоретически возможной (4 base-36 символа), но два конкретных примера из
 *  ревью, различающихся уже после точки усечения, гарантированно расходятся. */
const TRELLO_LABEL_PREFIX = "trello:";
function trelloListLabel(listName: string): string {
  const clean = sanitizeLabel(listName);
  const budget = Math.max(0, LIMITS.label.max - TRELLO_LABEL_PREFIX.length);
  if (clean.length <= budget) return `${TRELLO_LABEL_PREFIX}${clean}`;
  const suffix = `~${shortHash(listName)}`;
  const nameBudget = Math.max(0, budget - suffix.length);
  return `${TRELLO_LABEL_PREFIX}${clean.slice(0, nameBudget)}${suffix}`;
}

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
    const labels = [...new Set([...(listName ? [trelloListLabel(listName)] : []), ...trelloLabels].map(sanitizeLabel).filter(Boolean))];

    // "" (пустая строка вместо null для незаданного срока — встречается у
    // некоторых экспортёров/Power-Up'ов) иначе уходит на сервер как
    // dueDate: "", а тот требует /^\d{4}-\d{2}-\d{2}$/ — карточка без срока
    // падала бы неотличимо от карточки с реально плохими данными (ревью PR #48).
    const dueDate = isString(card.due) && card.due.trim() !== "" ? card.due.slice(0, 10) : null;

    items.push({
      title,
      description: isString(card.desc) ? card.desc : "",
      labels,
      dueDate,
      closed: card.closed === true,
    });
  }

  // Как и у названия карточки (title) выше — пустое/пробельное имя доски не
  // должно проскакивать как есть (модалка рендерила бы заголовок «»); в
  // отличие от карточки, доска не пропускается целиком, а падает на дефолт.
  const boardName = (isString(board.name) ? sanitizeLine(board.name) : "") || "Trello-доска";
  return { boardName, items, skipped };
}
