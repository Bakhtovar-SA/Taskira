import { useCallback, useEffect, useRef, useState } from "react";
import { issuesApi } from "./api";
import { mapIssue } from "./store";
import { useDebounced } from "./issuePages";
import type { Issue } from "./types";

/**
 * Серверный поиск задач для пикеров (связи, направление, родитель) — вместо
 * плоского `<select>` на весь список проекта, который при десятках тысяч задач
 * нежизнеспособен (PERF-06).
 *
 * Пустой запрос НЕ даёт пустого списка: показываются последние обновлённые
 * задачи (`isRecent = true`), чтобы пользователь сразу видел, что выбирать есть
 * из чего. Пустота допустима только как объяснённое состояние: «нет совпадений»
 * (по введённому тексту) или «в проекте нет других задач».
 *
 * Для строки поиска (Topbar) пустое поле — не повод что-то показывать:
 * `emptyMode: "none"` не отправляет запрос и возвращает пустой готовый результат.
 */

export const ISSUE_SEARCH_DEBOUNCE_MS = 250;
export const ISSUE_SEARCH_LIMIT = 8;
const SEARCH_MAX = 120; // = LIMITS сервера для q

export type IssueSearchStatus = "loading" | "ready" | "error";

export interface IssueSearchState {
  results: Issue[];
  status: IssueSearchStatus;
  error: string | null;
  /** Результаты — «недавно обновлённые» (запрос пуст), а не совпадения с текстом. */
  isRecent: boolean;
  /** Текст, по которому получены results (для сообщения «ничего не найдено по …»). */
  term: string;
  retry: () => void;
}

const isEmptyText = (v: string) => v === "";

export function useIssueSearch(
  projectId: string | null,
  rawTerm: string,
  options: { excludeIds?: readonly string[]; limit?: number; emptyMode?: "recent" | "none" } = {},
): IssueSearchState {
  const limit = options.limit ?? ISSUE_SEARCH_LIMIT;
  const emptyMode = options.emptyMode ?? "recent";
  const term = useDebounced(rawTerm.trim().slice(0, SEARCH_MAX), ISSUE_SEARCH_DEBOUNCE_MS, isEmptyText);
  const excludeRef = useRef(options.excludeIds ?? []);
  excludeRef.current = options.excludeIds ?? [];
  const excludeKey = (options.excludeIds ?? []).join(",");

  const [state, setState] = useState<{ key: string; results: Issue[]; status: IssueSearchStatus; error: string | null }>({
    key: "",
    results: [],
    status: "loading",
    error: null,
  });
  const [tick, setTick] = useState(0);
  const gen = useRef(0);
  const idle = !projectId || (emptyMode === "none" && term === "");
  const key = idle ? "" : JSON.stringify([projectId, term, limit, excludeKey]);

  useEffect(() => {
    const my = ++gen.current;
    if (idle || !projectId) return;
    setState((prev) => ({ ...prev, key, status: "loading", error: null }));
    // Исключённые (сама задача, уже связанные) отфильтровываются на клиенте, поэтому
    // просим с запасом на их число: страница не должна опустеть из-за исключений.
    const ask = Math.min(50, limit + excludeRef.current.length);
    issuesApi
      .page(projectId, term ? { q: term, limit: ask } : { sort: "updated", dir: "desc", limit: ask })
      .then(
        (page) => {
          if (gen.current !== my) return;
          const skip = new Set(excludeRef.current);
          const results = page.items
            .filter((d) => !skip.has(d.id))
            .slice(0, limit)
            .map((d) => mapIssue(d));
          setState({ key, results, status: "ready", error: null });
        },
        (e: unknown) => {
          if (gen.current !== my) return;
          setState((prev) => ({ ...prev, key, results: [], status: "error", error: e instanceof Error ? e.message : String(e) }));
        },
      );
    return () => {
      gen.current++;
    };
  }, [key, tick, projectId, term, limit, idle]);

  const retry = useCallback(() => setTick((n) => n + 1), []);
  const current = state.key === key;
  return {
    results: idle ? [] : state.results,
    // между сменой текста и ответом сервера — «загрузка», а не устаревший «готово»
    status: idle ? "ready" : current ? state.status : "loading",
    error: current ? state.error : null,
    isRecent: term === "",
    term,
    retry,
  };
}
