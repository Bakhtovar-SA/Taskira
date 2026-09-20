import { useEffect, useMemo, useRef, useState } from "react";
import { fmtDate, useStore } from "../store";
import type { Issue } from "../types";
import { TYPE_ORDER } from "../types";
import { freshRows, useDebounced, useIssueSet, useIssuesRevision, useLoadMoreSentinel, useOnRevision, type IssueSetQuery } from "../issuePages";
import type { IssueFilterParams } from "../api";
import { IcChevD, IcDots, IcFilter, IcInbox, IcSearch, IcTrash, IcX, PriorityIcon, TypeIcon } from "../icons";
import { AvatarStack, Chip, Dropdown, Empty, Lozenge, MenuItem, SkeletonRow } from "../ui";
import ImportTrelloModal from "./ImportTrelloModal";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";

type SortKey = "priority" | "due" | "updated" | "key";

/** Поиск уходит на сервер не на каждую букву. */
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MAX = 120; // = LIMITS сервера для q
const isEmptyText = (v: string) => v === "";

const selectCls =
  "h-8 rounded-md border border-line bg-panel px-2 text-[12.5px] text-ink outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/15";

function Row({ issue }: { issue: Issue }) {
  const { t, lang } = useT();
  const { idx, openIssue, deleteIssue, can } = useStore();
  // Ассоциированные сущности ищем по индексам из контекста, а не линейным
  // проходом по массивам в каждой строке списка (аудит PERF-02).
  const assignees = issue.assigneeIds.map((id) => idx.users.get(id)).filter((u): u is NonNullable<typeof u> => !!u);
  const epic = issue.epicId ? idx.issues.get(issue.epicId) : undefined;
  const status = idx.statuses.get(issue.statusId);

  return (
    <div
      onClick={() => openIssue(issue.id)}
      className="group flex cursor-pointer items-center gap-2.5 border-b border-linesoft bg-panel px-3 py-2 transition-colors last:border-0 hover:bg-accentsoft/50"
    >
      <TypeIcon type={issue.typeId} size={14} />
      <span className="w-14 shrink-0 font-mono text-[11px] font-semibold text-faint">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{issue.title}</span>
      {epic && (
        <span
          className="hidden items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10.5px] font-semibold lg:inline-flex"
          style={{ background: `${epic.color}1a`, color: epic.color ?? undefined }}
        >
          <span className="h-1.5 w-1.5 rounded-sm" style={{ background: epic.color ?? undefined }} />
          <span className="max-w-[110px] truncate">{epic.title}</span>
        </span>
      )}
      <span className="hidden gap-1 xl:flex">
        {issue.labels.slice(0, 2).map((l) => (
          <Chip key={l} text={l} />
        ))}
      </span>
      {issue.dueDate && (
        <span className="hidden shrink-0 font-mono text-[10.5px] text-faint md:inline">{fmtDate(issue.dueDate, lang)}</span>
      )}
      {status && (
        <span className="hidden shrink-0 sm:inline">
          <Lozenge status={status} size="sm" />
        </span>
      )}
      <PriorityIcon p={issue.priorityId} size={14} />
      <AvatarStack users={assignees} size={22} interactive />
      <div onClick={(e) => e.stopPropagation()}>
        <Dropdown
          align="right"
          width={190}
          button={() => (
            <button
              className="flex h-6 w-6 items-center justify-center rounded text-faint opacity-0 transition-all hover:bg-todosoft hover:text-ink group-hover:opacity-100"
              aria-label={t("common.actions")}
            >
              <IcDots size={14} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem onClick={() => { openIssue(issue.id); close(); }}>{t("backlog.openIssue")}</MenuItem>
              {can("delete") && (
                <>
                  <div className="my-1 border-t border-linesoft" />
                  <MenuItem danger onClick={() => { deleteIssue(issue.id); close(); }}>
                    <IcTrash size={13} /> {t("common.delete")}
                  </MenuItem>
                </>
              )}
            </>
          )}
        </Dropdown>
      </div>
    </div>
  );
}

export default function Backlog() {
  const { t } = useT();
  const { data, idx, can } = useStore();
  const [importOpen, setImportOpen] = useState(false);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fAssignee, setFAssignee] = useState(""); // "" | "none" | userId
  const [fType, setFType] = useState("");
  const [fOverdue, setFOverdue] = useState(false);
  // Закрытые по умолчанию скрыты (аудит LIFE-02): раньше вью открывался со
  // смесью живого и архивного, и счётчик считал их наравне.
  const [showDone, setShowDone] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const sortLabels: Record<SortKey, string> = {
    priority: t("field.priority"),
    due: t("field.dueDate"),
    updated: t("backlog.sort.updated"),
    key: t("backlog.sort.key"),
  };

  const pickSort = (k: SortKey) => {
    setSortKey(k);
    setSortDir(k === "updated" ? "desc" : "asc");
  };

  // Поле поиска отвечает мгновенно, а запрос к серверу — после паузы в наборе.
  const qDebounced = useDebounced(q.trim().slice(0, SEARCH_MAX), SEARCH_DEBOUNCE_MS, isEmptyText);

  // Фильтры, сортировка и поиск — на сервере (PERF-05): клиент видит лишь часть
  // набора, и фильтр «по загруженному» искал бы только в ней. Явно выбранный
  // статус важнее общего переключателя: выбрав «Готово», человек хочет закрытые.
  const query = useMemo<IssueSetQuery | null>(() => {
    if (!data.currentProjectId) return null;
    const filters: IssueFilterParams = {
      status: fStatus || undefined,
      assignee: fAssignee || undefined,
      type: fType || undefined,
      q: qDebounced || undefined,
      overdue: fOverdue ? "1" : undefined,
      closed: !showDone && !fStatus ? "hide" : undefined,
    };
    return { projectId: data.currentProjectId, filters, sort: sortKey, dir: sortDir };
  }, [data.currentProjectId, fStatus, fAssignee, fType, qDebounced, fOverdue, showDone, sortKey, sortDir]);

  const set = useIssueSet(query);

  // Правки задач (в т. ч. из модалки) живут в сторе; строки показывают свежую
  // версию оттуда, а набор перечитывается, чтобы состав (фильтр, удаление,
  // новые задачи) не устарел. Пока стор держит все задачи, это дёшево.
  const rows = useMemo(() => freshRows(set.items, idx.issues, data.issues.length > 0), [set.items, idx.issues, data.issues.length]);
  useOnRevision(useIssuesRevision(), set.revalidate);

  // Подгрузка при прокрутке к концу списка; кнопка «Показать ещё» — запасной путь.
  const { hasMore, loading, loadingMore, loadMore } = set;
  const sentinelRef = useLoadMoreSentinel(loadMore, hasMore && !loading && !loadingMore, rows.length);

  const filterActive = !!(q || fStatus || fAssignee || fType || fOverdue || showDone);
  const resetFilters = () => {
    setQ("");
    setFStatus("");
    setFAssignee("");
    setFType("");
    setFOverdue(false);
    setShowDone(false);
  };

  return (
    <div className="flex h-full flex-col">
      {/* шапка */}
      <div className="border-b border-line bg-panel/70 px-4 py-3.5 sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-2">
            <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">{t("backlog.title")}</h1>
            <p className="mt-0.5 text-[11.5px] text-faint">
              {set.total === null
                ? t("common.loading")
                : t(showDone || fStatus ? "backlog.countAll" : "backlog.countActive", { shown: rows.length, total: set.total })}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {can("create") && (
              <button
                onClick={() => setImportOpen(true)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 text-[12.5px] font-medium text-sub transition-colors hover:border-accent hover:text-accent"
              >
                <IcInbox size={13} /> {t("backlog.importTrello")}
              </button>
            )}
            <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-panel px-2.5">
              <IcSearch size={13} className="text-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("backlog.searchPlaceholder")}
                className="w-44 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
              />
              {q && (
                <button onClick={() => setQ("")} className="text-faint hover:text-ink" aria-label={t("common.clear")}>
                  <IcX size={12} />
                </button>
              )}
            </div>

            {/* сортировка */}
            <Dropdown
              align="right"
              width={180}
              button={(open) => (
                <button className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium ${open ? "border-accent" : "border-line"} bg-panel text-sub`}>
                  <IcFilter size={12} className="text-faint" />
                  {sortLabels[sortKey]}
                  <IcChevD size={11} className="text-faint" />
                </button>
              )}
            >
              {(close) => (
                <>
                  {(Object.keys(sortLabels) as SortKey[]).map((k) => (
                    <MenuItem key={k} onClick={() => { pickSort(k); close(); }}>
                      {sortLabels[k]} {k === sortKey && <span className="ml-auto text-[10.5px] text-accent">✓</span>}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
            <button
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              title={t(sortDir === "asc" ? "backlog.sort.asc" : "backlog.sort.desc")}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-panel text-sub hover:text-ink"
              aria-label={t("backlog.sort.direction")}
            >
              <IcChevD size={13} className={sortDir === "asc" ? "rotate-180" : ""} />
            </button>
          </div>
        </div>

        {/* фильтры */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${selectCls} cursor-pointer`}>
            <option value="">{t("backlog.allStatuses")}</option>
            {data.workflow.statuses.map((s) => (
              <option key={s.id} value={s.id}>{workflowStatusName(s, t)}</option>
            ))}
          </select>
          <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} className={`${selectCls} cursor-pointer`}>
            <option value="">{t("backlog.anyAssignee")}</option>
            <option value="none">{t("createIssue.unassigned")}</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <select value={fType} onChange={(e) => setFType(e.target.value)} className={`${selectCls} cursor-pointer`}>
            <option value="">{t("issueType.allShort")}</option>
            {TYPE_ORDER.map((ty) => (
              <option key={ty} value={ty}>{t(`issueType.${ty}`)}</option>
            ))}
          </select>
          <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 text-[12.5px] font-medium text-sub">
            <input
              id="backlog-overdue"
              type="checkbox"
              checked={fOverdue}
              onChange={(e) => setFOverdue(e.target.checked)}
            />
            {t("backlog.overdue")}
          </label>
          <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 text-[12.5px] font-medium text-sub">
            <input
              id="backlog-show-done"
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
            />
            {t("backlog.showClosed")}
          </label>
          {filterActive && (
            <button onClick={resetFilters} className="flex h-8 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-faint hover:text-ink">
              <IcX size={11} /> {t("common.reset")}
            </button>
          )}
        </div>
      </div>

      {/* список */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1060px] min-[1536px]:max-w-[1320px] min-[1920px]:max-w-[1600px] px-6 py-5">
          {set.loading ? (
            <div
              className="overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]"
              aria-busy="true"
              aria-label={t("common.loading")}
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : set.error && rows.length === 0 ? (
            <Empty
              icon={<IcInbox size={22} />}
              title={t("backlog.loadError")}
              sub={set.error}
              action={
                <button
                  onClick={set.reload}
                  className="h-8 rounded-md border border-line bg-panel px-3 text-[12.5px] font-medium text-sub hover:border-accent hover:text-accent"
                >
                  {t("common.retry")}
                </button>
              }
            />
          ) : rows.length > 0 ? (
            <>
              <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
                {rows.map((i) => (
                  <Row key={i.id} issue={i} />
                ))}
                {loadingMore && (
                  <div className="border-t border-linesoft" aria-busy="true" aria-label={t("backlog.loadingMore")}>
                    <SkeletonRow />
                  </div>
                )}
              </div>
              <div ref={sentinelRef} className="mt-3 flex min-h-8 items-center justify-center text-[12px] text-faint">
                {set.error ? (
                  <button onClick={loadMore} className="font-medium text-accent hover:underline">
                    {t("backlog.loadMoreFailed")}
                  </button>
                ) : hasMore ? (
                  !loadingMore && (
                    <button
                      onClick={loadMore}
                      className="h-8 rounded-md border border-line bg-panel px-3 font-medium text-sub hover:border-accent hover:text-accent"
                    >
                      {t("backlog.loadMore")}
                    </button>
                  )
                ) : (
                  <span>{t("backlog.allLoaded", { total: rows.length })}</span>
                )}
              </div>
            </>
          ) : (
            <Empty
              icon={<IcInbox size={22} />}
              title={t(filterActive ? "backlog.emptyFilteredTitle" : "backlog.emptyTitle")}
              sub={t(filterActive ? "backlog.emptyFilteredSub" : "backlog.emptySub")}
            />
          )}
        </div>
      </div>

      {importOpen && <ImportTrelloModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}
