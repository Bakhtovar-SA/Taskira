/** Соседние задачи текущего представления — для `J`/`K` в открытой панели задачи (ADR-0013 §3:
 *  «следующая / предыдущая задача текущего представления без закрытия панели»).
 *  Порядок берётся из разметки представления (`data-issue-id` у карточек Доски и строк Списка
 *  внутри `<main>`): это ровно то, что видит человек — колонки слева направо, карточки сверху
 *  вниз, с учётом фильтров, сортировки и подгруженных страниц — без второго источника правды. */
export function neighborIssue(id: string, dir: 1 | -1): string | null {
  const ids = [...document.querySelectorAll<HTMLElement>("main [data-issue-id]")].map((el) => el.dataset.issueId!);
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return ids[i + dir] ?? null;
}

/** Прокрутить представление к задаче, открытой через J/K, — чтобы под панелью было видно, где ты. */
export function revealIssue(id: string): void {
  document.querySelector<HTMLElement>(`main [data-issue-id="${CSS.escape(id)}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}
