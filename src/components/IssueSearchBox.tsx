import { useEffect, useId, useState } from "react";
import { useStore } from "../store";
import { useIssueSearch } from "../issueSearch";
import { useT } from "../i18n";
import type { Issue } from "../types";
import { IcSearch, IcX } from "../icons";

/**
 * Поиск задачи для выбора (связь, направление, родитель): поле ввода и список
 * результатов с сервера. Заменяет плоский `<select>` на весь список проекта.
 *
 * Все состояния объяснены текстом, а не пустотой:
 *  - поле пусто → «Недавно обновлённые» (список не пуст, есть из чего выбирать);
 *  - идёт запрос → скелет строк;
 *  - нет совпадений → «Ничего не найдено по «…»» и подсказка, что ввести;
 *  - в проекте нет других задач → отдельное сообщение;
 *  - ошибка → причина и «Повторить».
 * Клавиатура: ↑/↓ — выбор строки, Enter — подтвердить.
 */
export default function IssueSearchBox({
  onPick,
  excludeIds,
  ariaLabel,
  placeholder,
  autoFocus,
}: {
  onPick: (issue: Issue) => void;
  excludeIds?: readonly string[];
  ariaLabel: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { t } = useT();
  const { data } = useStore();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const search = useIssueSearch(data.currentProjectId || null, text, { excludeIds });
  const { results, status, isRecent, term } = search;

  useEffect(() => setActive(0), [results]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[active];
      if (picked) onPick(picked);
    }
  };

  const showSkeleton = status === "loading" && results.length === 0;

  return (
    <div className="w-full">
      <div className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 focus-within:border-accent">
        <IcSearch size={12} className="shrink-0 text-faint" />
        <input
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? t("picker.placeholder")}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
        />
        {text && (
          <button onClick={() => setText("")} className="text-faint hover:text-ink" aria-label={t("common.clear")}>
            <IcX size={11} />
          </button>
        )}
      </div>

      <div id={listId} role="listbox" aria-busy={status === "loading"} className="mt-1 max-h-[220px] overflow-y-auto">
        {status === "ready" && results.length > 0 && isRecent && (
          <p className="px-2 pb-0.5 pt-1 text-[11.5px] font-medium text-faint">{t("picker.recent")}</p>
        )}

        {showSkeleton && (
          <div className="space-y-1 px-1 py-1" aria-label={t("picker.searching")}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-6 w-full" />
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="px-2 py-2 text-[11.5px] text-danger">
            <p>{t("picker.error")}</p>
            <button onClick={search.retry} className="mt-1 font-semibold text-accent hover:underline">
              {t("common.retry")}
            </button>
          </div>
        )}

        {status !== "error" &&
          results.map((issue, i) => (
            <button
              key={issue.id}
              role="option"
              aria-selected={i === active}
              onClick={() => onPick(issue)}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                i === active ? "bg-accentsoft" : "hover:bg-hover"
              }`}
            >
              <span className="w-[62px] shrink-0 font-mono text-[10.5px] font-semibold text-faint">{issue.key}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{issue.title}</span>
            </button>
          ))}

        {status === "ready" && results.length === 0 && (
          <div className="px-2 py-2.5 text-[11.5px] leading-snug text-faint">
            {isRecent ? (
              <p>{t("picker.noIssues")}</p>
            ) : (
              <>
                <p className="font-medium text-sub">{t("picker.noResults", { q: term })}</p>
                <p className="mt-0.5">{t("picker.noResultsHint", { example: `${data.project.key}-15` })}</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
