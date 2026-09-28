import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Hint } from "./Hint";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { fmtDate, relTime } from "../store/mappers";
import type { Issue } from "../types";
import { PRIORITY_ORDER, TYPE_ORDER } from "../types";
import { freshRows, useDebounced, useEpics, useIssueSet, useIssuesRevision, useLoadMoreSentinel, useOnRevision, type IssueSetQuery } from "../issuePages";
import { LIMITS } from "../validation";
import { ApiError, savedViewsApi, type IssueEpic, type IssueFilterParams, type SavedViewInput, type ServerSavedView } from "../api";
import { DueRing, IcBacklog, IcChevD, IcDisplay, IcDots, IcFilter, IcInbox, IcPencil, IcSearch, IcStar, IcTrash, IcX, PriorityIcon, TypeIcon } from "../icons";
import { AvatarStack, Chip, Dropdown, Lozenge, MenuItem, Modal, SkeletonRow, directionColor } from "../ui";
import { Button, EmptyState } from "../ds";
import ImportTrelloModal from "./ImportTrelloModal";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";
import { EMPTY_FILTERS, filtersFromSearch, searchFromFilters, type FilterState } from "../router";
import { COLUMNS, LEFT, gridTemplate, readColumns, writeColumns, type ColumnId, type SortKey } from "../listColumns";


/** Поиск уходит на сервер не на каждую букву. */
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MAX = 120; // = LIMITS сервера для q
const isEmptyText = (v: string) => v === "";

const selectCls =
  "h-8 rounded-lg border border-linesoft bg-sunken px-2 text-[12.5px] font-medium text-ink outline-none transition-[border-color,box-shadow] hover:border-line focus:border-accent focus:shadow-focus";

function HeadCell({ id, sortKey, sortDir, onSort, compact }: { id: ColumnId | "key"; sortKey: SortKey; sortDir: "asc" | "desc"; onSort: (k: SortKey) => void; compact?: boolean }) {
  const { t } = useT();
  const def = id === "key" ? { label: "backlog.sort.key" as const, sort: "key" as SortKey } : COLUMNS.find((c) => c.id === id)!;
  const label = t(def.label);
  const on = def.sort && def.sort === sortKey;
  const text = compact ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>;
  return (
    <span role="columnheader" data-col={id} aria-sort={on ? (sortDir === "asc" ? "ascending" : "descending") : undefined} className="flex min-w-0 items-center">
      {def.sort ? (
        <button type="button" onClick={() => onSort(def.sort!)} title={label} className={`ds-focus -mx-1 flex min-w-0 items-center gap-1 rounded px-1 hover:text-ink ${on ? "text-ink" : ""}`}>
          {compact && !on ? <IcFilter size={11} className="shrink-0 opacity-60" /> : null}
          {text}
          {on && <IcChevD size={10} className={`shrink-0 ${sortDir === "asc" ? "rotate-180" : ""}`} />}
        </button>
      ) : (
        text
      )}
    </span>
  );
}

function Row({
  issue,
  epic,
  cols,
  selectMode,
  selected,
  onToggleSelect,
}: {
  issue: Issue;
  epic: Pick<IssueEpic, "id" | "title" | "color"> | undefined;
  cols: ColumnId[];
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const { t, lang } = useT();
  const { idx, openIssue, deleteIssue, can } = useStore();
  // Ассоциированные сущности ищем по индексам из контекста, а не линейным
  // проходом по массивам в каждой строке списка (аудит PERF-02).
  const assignees = issue.assigneeIds.map((id) => idx.users.get(id)).filter((u): u is NonNullable<typeof u> => !!u);
  const status = idx.statuses.get(issue.statusId);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !!issue.dueDate && status?.category !== "done" && issue.dueDate < today;

  const cell = (id: ColumnId) => {
    switch (id) {
      case "priority":
        return <PriorityIcon p={issue.priorityId} size={14} />;
      case "type":
        return <TypeIcon type={issue.typeId} size={14} />;
      case "direction":
        return epic ? (
          <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md px-1.5 py-px text-[11.5px] text-sub ring-1 ring-inset ring-linesoft">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: directionColor(epic.id, epic.color) }} />
            <span className="truncate">{epic.title}</span>
          </span>
        ) : null;
      case "labels":
        return (
          <span className="flex min-w-0 gap-1 overflow-hidden">
            {issue.labels.slice(0, 2).map((l) => (
              <Chip key={l} text={l} />
            ))}
            {issue.labels.length > 2 && <span className="text-[11.5px] tabular text-faint">+{issue.labels.length - 2}</span>}
          </span>
        );
      case "due":
        return issue.dueDate ? (
          <span className={`inline-flex items-center gap-1 text-[12px] tabular ${overdue ? "font-medium text-[var(--status-danger-fg)]" : "text-faint"}`} title={overdue ? t("board.quickChip.overdue") : undefined}>
            <DueRing due={issue.dueDate} today={today} done={status?.category === "done"} />
            {fmtDate(issue.dueDate, lang)}
          </span>
        ) : null;
      case "status":
        return status ? <Lozenge status={status} size="sm" /> : null;
      case "assignee":
        return <AvatarStack users={assignees} size={22} interactive />;
      case "updated":
        return <span className="text-[12px] tabular text-faint">{relTime(issue.updatedAt, lang)}</span>;
    }
  };

  return (
    <div
      role="row"
      onClick={() => openIssue(issue.id)}
      data-issue-id={issue.id}
      aria-selected={selectMode ? selected : undefined}
      className={`list-grid group h-11 cursor-pointer items-center gap-x-3 border-b border-linesoft/80 px-4 transition-colors last:border-0 hover:bg-hover/60 ${selected ? "bg-accentsoft/50" : "bg-panel"}`}
    >
      {/* ТЗ 3.3: чекбоксы появляются только в режиме выделения — не занимают
          места в обычном режиме просмотра списка. */}
      {selectMode && (
        <span role="cell" className="flex">
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect(issue.id)}
            className="shrink-0 cursor-pointer"
            aria-label={t("backlog.selectRow", { key: issue.key })}
          />
        </span>
      )}
      {LEFT.filter((id) => cols.includes(id)).map((id) => (
        <span key={id} role="cell" data-col={id} className="flex min-w-0 items-center">
          {cell(id)}
        </span>
      ))}
      <span role="cell" data-col="key" className="truncate font-mono text-[12px] tabular text-faint">
        {issue.key}
      </span>
      <span role="cell" className="min-w-0 text-[13.5px] font-medium text-ink">
        {/* На телефоне колонки ключа нет — ключ мелко над названием. */}
        <span aria-hidden className="block truncate font-mono text-[11px] font-normal leading-tight tabular text-faint sm:hidden">
          {issue.key}
        </span>
        <span className="block truncate">{issue.title}</span>
      </span>
      {COLUMNS.filter((c) => !LEFT.includes(c.id) && cols.includes(c.id)).map((c) => (
        <span key={c.id} role="cell" data-col={c.id} className="flex min-w-0 items-center">
          {cell(c.id)}
        </span>
      ))}
      <span role="cell" data-col="actions" className="flex justify-end" onClick={(e) => e.stopPropagation()}>
        <Dropdown
          align="right"
          width={190}
          button={() => (
            <button
              className="flex h-6 w-6 items-center justify-center rounded text-faint opacity-0 transition-all hover:bg-todosoft hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
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
      </span>
    </div>
  );
}

export default function Backlog() {
  const { t } = useT();
  const { data, idx, can, epicsRevision, bulkApplyIssueAction, setCreateOpen, toast } = useStore();
  const [path, navigate] = useLocation();
  const [importOpen, setImportOpen] = useState(false);
  const [q, setQ] = useState("");
  // Инициализируются из URL один раз при монтировании (переход по сохранённой
  // ссылке/вьюхе, перезагрузка страницы) — ТЗ 3.1 п.3/ТЗ 3.2. Дальше состояние
  // здесь ведущее, а useEffect ниже отражает его обратно в адресную строку
  // (та же «сравнить и подтолкнуть» модель, что useRouterSync.ts, только
  // локально для query-параметров одного вида, не для всего приложения).
  const [filters, setFilters] = useState<FilterState>(() => filtersFromSearch(location.search));
  const [fOverdue, setFOverdue] = useState(() => new URLSearchParams(location.search).get("overdue") === "1");
  // Закрытые по умолчанию скрыты (аудит LIFE-02): раньше вью открывался со
  // смесью живого и архивного, и счётчик считал их наравне.
  const [showDone, setShowDone] = useState(() => new URLSearchParams(location.search).get("done") === "1");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const { status: fStatus, assignee: fAssignee, type: fType, priority: fPriority, label: fLabel } = filters;
  const setField = (k: keyof FilterState) => (v: string) => setFilters((cur) => ({ ...cur, [k]: v }));

  // Состояние → URL: реплейсим (не пушим) — фильтр не должен плодить историю
  // на каждое изменение чекбокса/дропдауна, иначе «назад» листало бы прошлые
  // состояния фильтра, а не реальную навигацию (см. useRouterSync.ts). q — с
  // задержкой (qDebounced ниже уже есть для запроса; для URL берём то же).
  useEffect(() => {
    const next = searchFromFilters(location.search, filters, { overdue: fOverdue ? "1" : "", done: showDone ? "1" : "" });
    if (next !== location.search.replace(/^\?/, "")) {
      navigate(`${path}${next ? `?${next}` : ""}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- path/navigate стабильны для текущего вида; включать их
    // пересоздавало бы эффект на каждый чужой навигационный пуш и гоняло бы сравнение впустую.
  }, [filters, fOverdue, showDone]);
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
    const apiFilters: IssueFilterParams = {
      status: fStatus || undefined,
      assignee: fAssignee || undefined,
      type: fType || undefined,
      priority: fPriority || undefined,
      label: fLabel || undefined,
      q: qDebounced || undefined,
      overdue: fOverdue ? "1" : undefined,
      closed: !showDone && !fStatus ? "hide" : undefined,
    };
    return { projectId: data.currentProjectId, filters: apiFilters, sort: sortKey, dir: sortDir };
  }, [data.currentProjectId, fStatus, fAssignee, fType, fPriority, fLabel, qDebounced, fOverdue, showDone, sortKey, sortDir]);

  const set = useIssueSet(query);
  // Направления строк — справочник (один запрос на экран), а не поиск в списке всех задач.
  const epics = useEpics(data.currentProjectId || null, epicsRevision);

  // Правки задач (в т. ч. из модалки) живут в сторе; строки показывают свежую
  // версию оттуда, а набор перечитывается, чтобы состав (фильтр, удаление,
  // новые задачи) не устарел. Пока стор держит все задачи, это дёшево.
  const rows = useMemo(() => freshRows(set.items, idx.issues), [set.items, idx.issues]);
  useOnRevision(useIssuesRevision(), set.revalidate);

  // Подгрузка при прокрутке к концу списка; кнопка «Показать ещё» — запасной путь.
  const { hasMore, loading, loadingMore, loadMore } = set;
  const sentinelRef = useLoadMoreSentinel(loadMore, hasMore && !loading && !loadingMore, rows.length);

  const filterActive = !!(q || fStatus || fAssignee || fType || fPriority || fLabel || fOverdue || showDone);
  const resetFilters = () => {
    setQ("");
    setFilters(EMPTY_FILTERS);
    setFOverdue(false);
    setShowDone(false);
  };

  // ТЗ 3.2: сохранённые вьюхи — личные, тянутся заново при смене проекта.
  const [views, setViews] = useState<ServerSavedView[]>([]);
  const [savingView, setSavingView] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // Фильтр «по умолчанию» применяется сам при открытии списка — один раз на проект и только если в адресе нет
  // своих условий (ссылка, которой поделились, важнее личной привычки).
  const defaultApplied = useRef<string | null>(null);
  useEffect(() => {
    if (!data.currentProjectId) return;
    let cancelled = false;
    const pid = data.currentProjectId;
    void savedViewsApi.list(pid).then((items) => {
      if (cancelled) return;
      setViews(items);
      const def = items.find((v) => v.isDefault);
      const noConditions = !fStatus && !fAssignee && !fType && !fPriority && !fLabel && !q;
      if (def && noConditions && defaultApplied.current !== pid) applyView(def);
      defaultApplied.current = pid;
    }).catch(() => undefined); // тихо — панель просто пуста, не критично для доски/списка
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.currentProjectId]);

  const applyView = (v: ServerSavedView) => {
    setFilters({
      status: v.filter.status ?? "",
      assignee: v.filter.assignee ?? "",
      type: v.filter.type ?? "",
      priority: v.filter.priority ?? "",
      label: v.filter.label ?? "",
    });
    setQ(v.filter.q ?? "");
  };

  const saveCurrentAsView = async () => {
    const name = newViewName.trim();
    if (!name || !data.currentProjectId) return;
    // Пустая строка — не то же самое, что "условие не задано": сервер валидирует
    // status/assignee/sprintId как uuid и отклонил бы "" (SavedViewFilter, contract.ts).
    const body: SavedViewInput = {
      name,
      filter: {
        status: fStatus || undefined,
        assignee: fAssignee || undefined,
        type: fType || undefined,
        priority: fPriority || undefined,
        label: fLabel || undefined,
        q: q || undefined,
      },
      isDefault: false,
    };
    const created = await savedViewsApi.create(data.currentProjectId, body);
    setViews((prev) => [...prev, created]);
    setNewViewName("");
    setSavingView(false);
  };

  /** Переименовать или сделать «по умолчанию» (INVENTORY 1.2 №14): PATCH принимает фильтр целиком — отдаём тот же.
   *  «По умолчанию» у сервера один на человека и проект: остальные флаги он снимает сам, здесь — то же локально. */
  const patchView = async (v: ServerSavedView, change: { name?: string; isDefault?: boolean }) => {
    if (!data.currentProjectId) return;
    try {
      const updated = await savedViewsApi.update(data.currentProjectId, v.id, { name: change.name ?? v.name, filter: v.filter, isDefault: change.isDefault ?? v.isDefault });
      setViews((prev) => prev.map((x) => (x.id === v.id ? updated : updated.isDefault ? { ...x, isDefault: false } : x)));
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : t("backlog.viewSaveFailed"));
    }
  };
  const saveRename = (v: ServerSavedView) => {
    const name = renaming?.name.trim();
    setRenaming(null);
    if (name && name !== v.name) void patchView(v, { name });
  };

  const removeView = async (v: ServerSavedView) => {
    if (!data.currentProjectId) return;
    await savedViewsApi.remove(data.currentProjectId, v.id);
    setViews((prev) => prev.filter((x) => x.id !== v.id));
  };

  // ТЗ 3.3 (план v2 Трек 3): массовые операции — чекбоксы только в «режиме
  // выделения» (не занимают места в обычном просмотре). Права на КАЖДУЮ
  // задачу проверяет сервер при выполнении (частичный успех) — здесь только UI.
  // Колонки таблицы — личная настройка в этом браузере (listColumns.ts); ширины — CSS-переменные через CSSOM (ADR-0010).
  const [cols, setCols] = useState<ColumnId[]>(readColumns);
  const toggleCol = (id: ColumnId) =>
    setCols((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : COLUMNS.map((c) => c.id).filter((c) => c === id || prev.includes(c));
      writeColumns(next);
      return next;
    });
  const tableRef = useRef<HTMLDivElement>(null);
  // Клик по заголовку колонки: та же колонка — сменить направление; другая — как выбор в меню сортировки.
  const toggleSortBy = (k: SortKey) => (k === sortKey ? setSortDir((d) => (d === "asc" ? "desc" : "asc")) : pickSort(k));
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelection = () => setSelectedIds(new Set());
  useEffect(() => {
    if (!selectMode) clearSelection();
  }, [selectMode]);
  // Смена проекта/перезагрузка набора — старые id не должны молча пережить переход.
  useEffect(() => {
    clearSelection();
  }, [data.currentProjectId]);

  useLayoutEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    el.style.setProperty("--list-cols", gridTemplate(cols, selectMode));
    // Телефон: только название с ключом, статус и исполнитель (остальные ячейки скрывает index.css).
    el.style.setProperty("--list-cols-sm", gridTemplate(cols.filter((c) => c === "status" || c === "assignee"), selectMode, true));
  });

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const runBulk = async (body: Parameters<typeof bulkApplyIssueAction>[0]) => {
    setBulkBusy(true);
    try {
      await bulkApplyIssueAction(body);
    } finally {
      setBulkBusy(false);
      clearSelection();
      setConfirmDelete(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* шапка */}
      <div className="px-4 pb-3 pt-5 sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-2">
            <h1 className="font-disp text-[20px] font-semibold tracking-[-0.02em] text-ink">{t("backlog.title")}</h1>
            <p className="mt-0.5 text-[11.5px] text-faint">
              {set.total === null
                ? t("common.loading")
                : t(showDone || fStatus ? "backlog.countAll" : "backlog.countActive", { shown: rows.length, total: set.total })}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* ТЗ 3.3: режим выделения — чекбоксы появляются в строках только пока он включён. */}
            <button
              onClick={() => setSelectMode((v) => !v)}
              className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium transition-colors ${selectMode ? "border-accent text-accent" : "border-line text-sub hover:border-accent hover:text-accent"}`}
            >
              {t("backlog.selectMode")}
            </button>
            {can("create") && (
              <button
                onClick={() => setImportOpen(true)}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel shadow-e1 px-2.5 text-[12.5px] font-medium text-sub transition-colors hover:bg-hover hover:text-ink"
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

            {/* колонки таблицы (ТЗ 5.12 e) */}
            <Dropdown
              align="right"
              width={230}
              button={(open) => (
                <button className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium ${open ? "border-accent" : "border-line"} bg-panel text-sub`}>
                  <IcDisplay size={12} className="text-faint" />
                  {t("backlog.columns")}
                  <IcChevD size={11} className="text-faint" />
                </button>
              )}
            >
              {() => (
                <div className="p-1">
                  {COLUMNS.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink hover:bg-hover/70">
                      <input type="checkbox" checked={cols.includes(c.id)} onChange={() => toggleCol(c.id)} className="cursor-pointer" />
                      {t(c.label)}
                    </label>
                  ))}
                  <p className="border-t border-linesoft px-2 pb-1 pt-1.5 text-[11px] leading-snug text-faint">{t("backlog.columnsHint")}</p>
                </div>
              )}
            </Dropdown>

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
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel shadow-e1 text-sub hover:text-ink"
              aria-label={t("backlog.sort.direction")}
            >
              <IcChevD size={13} className={sortDir === "asc" ? "rotate-180" : ""} />
            </button>
          </div>
        </div>

        {/* фильтры */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <select aria-label={t("field.status")} value={fStatus} onChange={(e) => setField("status")(e.target.value)} className={`${selectCls} cursor-pointer`}>
            <option value="">{t("backlog.allStatuses")}</option>
            {data.workflow.statuses.map((s) => (
              <option key={s.id} value={s.id}>{workflowStatusName(s, t)}</option>
            ))}
          </select>
          <select aria-label={t("field.assignee")} value={fAssignee} onChange={(e) => setField("assignee")(e.target.value)} className={`${selectCls} cursor-pointer`}>
            <option value="">{t("backlog.anyAssignee")}</option>
            <option value="none">{t("createIssue.unassigned")}</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <select aria-label={t("field.type")} value={fType} onChange={(e) => setField("type")(e.target.value)} className={`${selectCls} cursor-pointer`}>
            <option value="">{t("issueType.allShort")}</option>
            {TYPE_ORDER.map((ty) => (
              <option key={ty} value={ty}>{t(`issueType.${ty}`)}</option>
            ))}
          </select>
          {/* ТЗ 3.2: приоритет и метка — та же серверная пара условий, что status/assignee/type. */}
          <select aria-label={t("field.priority")} value={fPriority} onChange={(e) => setField("priority")(e.target.value)} className={`${selectCls} cursor-pointer`}>
            <option value="">{t("backlog.anyPriority")}</option>
            {PRIORITY_ORDER.map((p) => (
              <option key={p} value={p}>{t(`priority.${p}`)}</option>
            ))}
          </select>
          <input
            value={fLabel}
            onChange={(e) => setField("label")(e.target.value)}
            placeholder={t("backlog.labelPlaceholder")}
            className={`${selectCls} w-28`}
          />
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

          {/* ТЗ 3.2: сохранённые вьюхи — личные, применяют/сохраняют текущий набор условий. */}
          <Dropdown
            align="left"
            width={240}
            button={(open) => (
              <button className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium ${open ? "border-accent" : "border-line"} bg-panel text-sub`}>
                <IcStar size={12} className="text-faint" />
                {t("backlog.savedViews")}
                {views.length > 0 && <span className="text-[10.5px] text-faint">({views.length})</span>}
                <IcChevD size={11} className="text-faint" />
              </button>
            )}
          >
            {(close) => (
              <>
                {views.length === 0 && (
                  <div className="px-2.5 py-1.5 text-[12px] text-faint">{t("backlog.noSavedViews")}</div>
                )}
                {views.map((v) =>
                  renaming?.id === v.id ? (
                    <div key={v.id} className="flex items-center gap-1.5 px-2.5 py-1">
                      <input
                        autoFocus
                        value={renaming.name}
                        maxLength={LIMITS.savedView.name.max}
                        aria-label={t("backlog.renameView", { name: v.name })}
                        onChange={(e) => setRenaming({ id: v.id, name: e.target.value })}
                        onBlur={() => saveRename(v)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRename(v);
                          if (e.key === "Escape") {
                            e.stopPropagation();
                            setRenaming(null);
                          }
                        }}
                        className="h-7 min-w-0 flex-1 rounded border border-accent bg-panel px-2 text-[12px] outline-none shadow-focus"
                      />
                    </div>
                  ) : (
                  <div key={v.id} className="group flex items-center">
                    <MenuItem onClick={() => { applyView(v); close(); }}>
                      {v.name}
                    </MenuItem>
                    <button
                      onClick={(e) => { e.stopPropagation(); void patchView(v, { isDefault: !v.isDefault }); }}
                      aria-pressed={v.isDefault}
                      aria-label={t(v.isDefault ? "backlog.unsetDefaultView" : "backlog.setDefaultView", { name: v.name })}
                      title={t(v.isDefault ? "backlog.unsetDefaultView" : "backlog.setDefaultView", { name: v.name })}
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-opacity hover:bg-hover ${v.isDefault ? "text-accent" : "text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
                    >
                      <IcStar size={12} filled={v.isDefault} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenaming({ id: v.id, name: v.name }); }}
                      aria-label={t("backlog.renameView", { name: v.name })}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity hover:bg-hover hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <IcPencil size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); void removeView(v); }}
                      aria-label={t("backlog.deleteView")}
                      className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity hover:bg-todosoft hover:text-danger group-hover:opacity-100"
                    >
                      <IcTrash size={12} />
                    </button>
                  </div>
                  ),
                )}
                <div className="my-1 border-t border-linesoft" />
                {savingView ? (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                    <input
                      autoFocus
                      value={newViewName}
                      onChange={(e) => setNewViewName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void saveCurrentAsView(); if (e.key === "Escape") setSavingView(false); }}
                      placeholder={t("backlog.viewNamePlaceholder")}
                      className="h-7 min-w-0 flex-1 rounded border border-line bg-panel px-2 text-[12px] outline-none focus:border-accent focus:shadow-focus"
                    />
                    <button onClick={() => void saveCurrentAsView()} className="text-[11px] font-semibold text-accent hover:underline">
                      {t("common.save")}
                    </button>
                  </div>
                ) : (
                  <MenuItem onClick={() => setSavingView(true)}>{t("backlog.saveAsView")}</MenuItem>
                )}
              </>
            )}
          </Dropdown>
        </div>
        <Hint id="saved-views" className="mt-2.5">{t("hint.savedViews")}</Hint>

        {/* ТЗ 3.3: панель массовых действий — видна только при непустом выделении.
            Права проверяет сервер на каждую задачу; результат — тост «Изменено N из M». */}
        {selectMode && selectedIds.size > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accentsoft/40 px-2.5 py-2">
            <span className="text-[12.5px] font-semibold text-ink">{t("backlog.selectedCount", { n: selectedIds.size })}</span>
            <Dropdown
              align="left"
              width={180}
              button={() => (
                <button disabled={bulkBusy} className="flex h-7 items-center gap-1 rounded-md border border-line bg-panel px-2 text-[12px] font-medium text-sub disabled:opacity-50">
                  {t("field.status")} <IcChevD size={10} className="text-faint" />
                </button>
              )}
            >
              {(close) => (
                <>
                  {data.workflow.statuses.map((s) => (
                    <MenuItem key={s.id} onClick={() => { close(); void runBulk({ action: "status", issueIds: [...selectedIds], statusId: s.id }); }}>
                      {workflowStatusName(s, t)}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
            <Dropdown
              align="left"
              width={200}
              button={() => (
                <button disabled={bulkBusy} className="flex h-7 items-center gap-1 rounded-md border border-line bg-panel px-2 text-[12px] font-medium text-sub disabled:opacity-50">
                  {t("field.assignee")} <IcChevD size={10} className="text-faint" />
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem onClick={() => { close(); void runBulk({ action: "assignee", issueIds: [...selectedIds], assigneeId: "none" }); }}>
                    {t("createIssue.unassigned")}
                  </MenuItem>
                  {data.users.map((u) => (
                    <MenuItem key={u.id} onClick={() => { close(); void runBulk({ action: "assignee", issueIds: [...selectedIds], assigneeId: u.id }); }}>
                      {u.name}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
            <Dropdown
              align="left"
              width={160}
              button={() => (
                <button disabled={bulkBusy} className="flex h-7 items-center gap-1 rounded-md border border-line bg-panel px-2 text-[12px] font-medium text-sub disabled:opacity-50">
                  {t("field.priority")} <IcChevD size={10} className="text-faint" />
                </button>
              )}
            >
              {(close) => (
                <>
                  {PRIORITY_ORDER.map((p) => (
                    <MenuItem key={p} onClick={() => { close(); void runBulk({ action: "priority", issueIds: [...selectedIds], priorityId: p }); }}>
                      {t(`priority.${p}`)}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
            {can("delete") && (
              <button
                disabled={bulkBusy}
                onClick={() => setConfirmDelete(true)}
                className="flex h-7 items-center gap-1 rounded-md border border-danger/40 px-2 text-[12px] font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                <IcTrash size={12} /> {t("common.delete")}
              </button>
            )}
            <button onClick={clearSelection} className="ml-auto text-[11.5px] font-medium text-faint hover:text-ink">
              {t("common.clear")}
            </button>
          </div>
        )}
      </div>

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)} w={420} title={t("backlog.confirmBulkDeleteTitle")}>
          <div className="p-5">
            <p className="text-[13px] text-sub">{t("backlog.confirmBulkDeleteBody", { n: selectedIds.size })}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} className="h-8 rounded-md border border-line px-3 text-[12.5px] font-medium text-sub hover:text-ink">
                {t("common.cancel")}
              </button>
              <button
                disabled={bulkBusy}
                onClick={() => void runBulk({ action: "delete", issueIds: [...selectedIds] })}
                className="h-8 rounded-md bg-danger px-3 text-[12.5px] font-semibold text-onaccent hover:opacity-90 disabled:opacity-50"
              >
                {t("common.delete")}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* список */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1060px] min-[1536px]:max-w-[1320px] min-[1920px]:max-w-[1600px] px-6 py-5">
          {set.loading ? (
            <div
              className="overflow-hidden surface-raised rounded-xl ring-1 ring-inset ring-line/70"
              aria-busy="true"
              aria-label={t("common.loading")}
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : set.error && rows.length === 0 ? (
            <EmptyState
              icon={<IcBacklog size={22} tone="indigo" />}
              title={t("backlog.loadError")}
              sub={set.error}
              action={<Button size="sm" variant="secondary" onClick={set.reload}>{t("common.retry")}</Button>}
            />
          ) : rows.length > 0 ? (
            <>
              {/* ТЗ 5.12 e: таблица — одна сетка на заголовок и строки; заголовок прилипает при прокрутке.
                  overflow-clip, а не hidden: hidden сделал бы таблицу контейнером прокрутки и сломал sticky. */}
              <div role="table" ref={tableRef} aria-label={t("backlog.title")} aria-rowcount={set.total ?? undefined} className="overflow-clip surface-raised rounded-xl ring-1 ring-inset ring-line/70">
                <div role="row" className="list-grid list-head sticky top-0 z-10 h-9 items-center gap-x-3 border-b border-linesoft px-4 text-[11.5px] font-semibold text-faint">
                  {selectMode && (
                    <span role="columnheader" className="flex">
                      <input
                        type="checkbox"
                        aria-label={t("backlog.selectAll")}
                        checked={rows.length > 0 && rows.every((r) => selectedIds.has(r.id))}
                        onChange={(e) => setSelectedIds(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                        className="cursor-pointer"
                      />
                    </span>
                  )}
                  {LEFT.filter((id) => cols.includes(id)).map((id) => (
                    <HeadCell key={id} id={id} sortKey={sortKey} sortDir={sortDir} onSort={toggleSortBy} compact />
                  ))}
                  <HeadCell id="key" sortKey={sortKey} sortDir={sortDir} onSort={toggleSortBy} />
                  <span role="columnheader">{t("backlog.col.title")}</span>
                  {COLUMNS.filter((c) => !LEFT.includes(c.id) && cols.includes(c.id)).map((c) => (
                    <HeadCell key={c.id} id={c.id} sortKey={sortKey} sortDir={sortDir} onSort={toggleSortBy} />
                  ))}
                  <span role="columnheader" data-col="actions" aria-label={t("common.actions")} />
                </div>
                {rows.map((i) => (
                  <Row
                    key={i.id}
                    issue={i}
                    epic={i.epicId ? epics.byId.get(i.epicId) : undefined}
                    cols={cols}
                    selectMode={selectMode}
                    selected={selectedIds.has(i.id)}
                    onToggleSelect={toggleSelect}
                  />
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
                      className="h-8 rounded-lg border border-line bg-panel shadow-e1 px-3 font-medium text-sub hover:bg-hover hover:text-ink"
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
            <EmptyState
              icon={<IcBacklog size={22} tone="indigo" />}
              title={t(filterActive ? "backlog.emptyFilteredTitle" : "backlog.emptyTitle")}
              sub={t(filterActive ? "backlog.emptyFilteredSub" : "backlog.emptySub")}
              action={
                filterActive ? (
                  <Button size="sm" variant="secondary" onClick={resetFilters}>{t("common.reset")}</Button>
                ) : can("create") ? (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>{t("home.createIssue")}</Button>
                ) : undefined
              }
            />
          )}
        </div>
      </div>

      {importOpen && <ImportTrelloModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}
