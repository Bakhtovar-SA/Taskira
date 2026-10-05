import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cssVars } from "../cssVars";
import { localToday } from "../calendarLayout";
import QuickCreate from "./QuickCreateIssue";
import AssigneePicker from "./AssigneePicker";
import { GROUP_MODES, groupListRows, readListGroup, type GroupMode } from "../listGroups";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { canTransition, fmtDate, relTime } from "../store/mappers";
import type { CustomFieldDef, Issue } from "../types";
import { PRIORITY_ORDER, TYPE_ORDER } from "../types";
import { NO_ISSUE_FILTERS, freshRows, useDebounced, useEpics, useIssueCounts, useIssueSet, useIssuesRevision, useLoadMoreSentinel, useOnRevision, type IssueSetQuery } from "../issuePages";
import { LIMITS } from "../validation";
import { savedViewsApi, type IssueEpic, type IssueFilterParams, type SavedViewInput, type ServerSavedView } from "../api";
import { DueRing, IcBacklog, IcCalendar, IcCheck, IcChevD, IcDisplay, IcDots, IcFilter, IcInbox, IcPencil, IcPlus, IcStar, IcTrash, IcX, PriorityIcon, StatusGlyph, TypeIcon } from "../icons";
import { directionColor, labelTone } from "../ui";
import { UserAvatarGroup } from "./UserAvatar";
import { Button } from "../ds/Button";
import { DatePicker } from "../ds/DatePicker";
import { Checkbox } from "../ds/Field";
import { EmptyState, Skeleton, Tag } from "../ds/Display";
import { Menu, Popover } from "../ds/Overlay";
import { Presence } from "../ds/Presence";
import BulkBar from "./BulkBar";
import { IssueFilterSummary } from "./IssueFilterSummary";
import { WorkspaceControls, WorkspaceSearch, WorkspaceQuickFilters } from "./WorkspaceControls";
import { useT, type TKey } from "../i18n";
import { statusTone, workflowStatusName } from "../workflowStatus";
import { EMPTY_FILTERS, customFieldCondition, filtersFromSearch, searchFromFilters, projectIssueSearch, type FilterState, pathForIssue, pathForView } from "../router";
import { COLUMNS, LEFT, gridTemplate, tableMinWidth, readColumns, writeColumns, type ColumnId, type SortKey } from "../listColumns";

const ImportModal = lazy(() => import("./ImportModal"));


/** Поиск уходит на сервер не на каждую букву. */
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MAX = 120; // = LIMITS сервера для q
const isEmptyText = (v: string) => v === "";

const selectCls =
  "h-8 rounded-lg border border-linesoft bg-sunken px-2 text-[12.5px] font-medium text-ink outline-none transition-[border-color,box-shadow] hover:border-line focus:border-accent focus:shadow-focus";

function HeadCell({ id, sortKey, sortDir, onSort, compact }: { id: ColumnId | "key"; sortKey: SortKey; sortDir: "asc" | "desc"; onSort: (k: SortKey) => void; compact?: boolean }) {
  const { t, lang } = useT();
  const def = id === "key" ? { label: "backlog.sort.key" as const, sort: "key" as SortKey } : COLUMNS.find((c) => c.id === id)!;
  const label = t(def.label);
  const on = def.sort && def.sort === sortKey;
  const text = compact ? <span className="sr-only">{label}</span> : <span>{label}</span>;
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
  const { data, idx, openIssue, deleteIssue, updateIssue, moveStatus, can } = useStore();
  // Ассоциированные сущности ищем по индексам из контекста, а не линейным
  // проходом по массивам в каждой строке списка (аудит PERF-02).
  const assignees = issue.assigneeIds.map((id) => idx.users.get(id)).filter((u): u is NonNullable<typeof u> => !!u);
  const status = idx.statuses.get(issue.statusId);
  const today = localToday();
  const overdue = !!issue.dueDate && status?.category !== "done" && issue.dueDate < today;
  const days = issue.dueDate ? Math.round((Date.parse(issue.dueDate) - Date.parse(today)) / 864e5) : Infinity;
  const urgency = status?.category === "done" ? "done" : overdue ? "late" : days <= 3 ? "soon" : "normal";
  const statusAction = (iconOnly = false) => status && (can("transition", issue) ? <Menu
    label={t("field.status")} placement="bottom-end"
    trigger={p => <Button {...p} variant="ghost" size="sm" className="list-status-action" aria-label={t("backlog.changeStatus", { key: issue.key })}
      iconLeft={<StatusGlyph category={status.category} size={14} />}>{iconOnly ? <IcChevD size={10} /> : workflowStatusName(status, t)}</Button>}
    items={data.workflow.statuses.map(target => ({ id: target.id, label: workflowStatusName(target, t), icon: <StatusGlyph category={target.category} size={14} />,
      disabled: !canTransition(data.workflow, issue.statusId, target.id), onSelect: () => moveStatus(issue.id, target.id, null) }))} /> : <Tag size="sm" tone={statusTone(status.category)} dot strong>{workflowStatusName(status, t)}</Tag>);

  const cell = (id: ColumnId) => {
    switch (id) {
      case "priority":
        return <PriorityIcon p={issue.priorityId} size={14} />;
      case "type":
        return <TypeIcon type={issue.typeId} size={14} />;
      case "direction":
        return epic ? (
          <span className="list-direction">
            <i ref={cssVars({ "--direction-color": directionColor(epic.id, epic.color) })} />
            <span className="truncate">{epic.title}</span>
          </span>
        ) : null;
      case "labels":
        return (
          <span className="flex min-w-0 gap-1 overflow-hidden">
            {issue.labels.slice(0, 2).map((l) => (
              <Tag key={l} size="sm" tone={labelTone(l)}>
                {l}
              </Tag>
            ))}
            {issue.labels.length > 2 && <span className="text-[11.5px] tabular text-faint">+{issue.labels.length - 2}</span>}
          </span>
        );
      case "due":
        return issue.dueDate ? (
          <span className="list-due tabular" data-urgency={urgency} title={overdue ? t("board.quickChip.overdue") : undefined}>
            <DueRing due={issue.dueDate} today={today} done={status?.category === "done"} />
            {fmtDate(issue.dueDate, lang)}
          </span>
        ) : null;
      case "status":
        return statusAction();
      case "assignee":
        return can("edit", issue) ? <Popover label={t("field.assignee")} placement="bottom-end" className="w-[260px]"
          trigger={p => <button {...p} type="button" className="list-assignee-action ds-focus" aria-label={t("backlog.changeAssignees", { key: issue.key })}><UserAvatarGroup users={assignees} size={22} /></button>}>
          <AssigneePicker data={data} selected={issue.assigneeIds} onChange={ids => updateIssue(issue.id, { assigneeIds: ids })} />
        </Popover> : <UserAvatarGroup users={assignees} size={22} interactive />;
      case "updated":
        return <span className="text-[12px] tabular text-faint">{relTime(issue.updatedAt, lang)}</span>;
    }
  };

  return (
    <div
      role="row"
      onClick={() => openIssue(issue.id)}
      data-issue-id={issue.id}
      data-done={status?.category === "done" || undefined}
      aria-selected={selectMode ? selected : undefined}
      className={`list-grid group list-row cursor-pointer items-center gap-x-3 border-b border-linesoft/80 px-4 transition-colors last:border-0 hover:bg-hover/60 ${selected ? "bg-accentsoft/50" : "bg-panel"}`}
    >
      {/* ТЗ 3.3: чекбоксы появляются только в режиме выделения — не занимают
          места в обычном режиме просмотра списка. */}
      {selectMode && (
        <span role="cell" data-col="select" className="flex" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onChange={() => onToggleSelect(issue.id)} label={t("backlog.selectRow", { key: issue.key })} labelHidden />
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
      <span role="cell" data-col="title" className="list-title min-w-0 text-[14px] font-semibold text-ink">
        {/* На телефоне колонки ключа нет — ключ мелко над названием. */}
        <span aria-hidden className="block truncate font-mono text-[11px] font-normal leading-tight tabular text-faint sm:hidden">
          {issue.key}
        </span>
        <a href={pathForIssue(data.project.key, issue.key)} className="ds-focus block rounded hover:text-accenttext" title={issue.title}
          onClick={(e) => {
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault(); openIssue(issue.id);
          }}>{issue.title}</a>
        {!cols.includes("status") && can("transition", issue) && <span className="list-inline-status" onClick={e => e.stopPropagation()}>{statusAction(true)}</span>}
      </span>
      {COLUMNS.filter((c) => !LEFT.includes(c.id) && cols.includes(c.id)).map((c) => (
        <span key={c.id} role="cell" data-col={c.id} className="flex min-w-0 items-center" onClick={c.id === "status" || c.id === "assignee" ? e => e.stopPropagation() : undefined}>
          {cell(c.id)}
        </span>
      ))}
      {!cols.includes("status") && <span role="cell" data-col="status" className="list-mobile-status" onClick={e => e.stopPropagation()}>{statusAction()}</span>}
      <span role="cell" data-col="actions" className="flex justify-end" onClick={(e) => e.stopPropagation()}>
        <Menu
          label={t("common.actions")}
          placement="bottom-end"
          trigger={(p) => (
            <button
              {...p}
              type="button"
              className="list-actions ds-focus flex h-8 w-8 items-center justify-center rounded text-faint opacity-0 transition-all hover:bg-todosoft hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
              aria-label={t("common.actions")}
            >
              <IcDots size={14} />
            </button>
          )}
          items={[
            { id: "open", label: t("backlog.openIssue"), onSelect: () => openIssue(issue.id) },
            ...(can("delete", issue)
              ? [
                  { kind: "sep" as const, id: "sep" },
                  { id: "delete", label: t("common.delete"), icon: <IcTrash size={13} />, danger: true, onSelect: () => deleteIssue(issue.id) },
                ]
              : []),
          ]}
        />
      </span>
    </div>
  );
}

export default function Backlog() {
  const { t, errText, lang } = useT();
  const { data, idx, can, epicsRevision, setCreateOpen, toast } = useStore();
  const [path, navigate] = useLocation();
  const initialSearch = projectIssueSearch(data.project.key, location.pathname, location.search);
  const [importOpen, setImportOpen] = useState(false);
  const [q, setQ] = useState(() => new URLSearchParams(initialSearch).get("q") ?? "");
  // Инициализируются из URL один раз при монтировании (переход по сохранённой
  // ссылке/вьюхе, перезагрузка страницы) — ТЗ 3.1 п.3/ТЗ 3.2. Дальше состояние
  // здесь ведущее, а useEffect ниже отражает его обратно в адресную строку
  // (та же «сравнить и подтолкнуть» модель, что useRouterSync.ts, только
  // локально для query-параметров одного вида, не для всего приложения).
  const [filters, setFilters] = useState<FilterState>(() => filtersFromSearch(initialSearch));
  const [fOverdue, setFOverdue] = useState(() => new URLSearchParams(initialSearch).get("overdue") === "1");
  // Закрытые по умолчанию скрыты (аудит LIFE-02): раньше вью открывался со
  // смесью живого и архивного, и счётчик считал их наравне.
  const [showDone, setShowDone] = useState(() => new URLSearchParams(initialSearch).get("done") === "1");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [group, setGroup] = useState(() => readListGroup(initialSearch));
  const [createGroup, setCreateGroup] = useState<string | null>(null);
  const groupKeys: Record<GroupMode, TKey> = { none: "workspace.noGrouping", status: "field.status", epic: "field.direction", assignee: "field.assignee" };
  const groupLabel = t("workspace.grouping", { name: t(groupKeys[group]).toLocaleLowerCase(lang) });
  const { status: fStatus, assignee: fAssignee, type: fType, priority: fPriority, label: fLabel, sprintId: fSprint, dueFrom: fDueFrom, dueTo: fDueTo } = filters;
  const sprintsOn = !!data.projects.find((pr) => pr.id === data.currentProjectId)?.sprintsEnabled;
  const setField = (k: keyof FilterState) => (v: string) => setFilters((cur) => ({ ...cur, [k]: v }));
  // Условие по своему полю — один объект; мемо по его частям, чтобы запрос не пересобирался на каждый рендер.
  const { cf, cfValue, cfFrom, cfTo, cfEmpty } = filters;
  const cfCond = useMemo(() => customFieldCondition({ ...EMPTY_FILTERS, cf, cfValue, cfFrom, cfTo, cfEmpty }), [cf, cfValue, cfFrom, cfTo, cfEmpty]);

  useEffect(() => {
    const restore = () => {
      const p = new URLSearchParams(location.search);
      setFilters(filtersFromSearch(location.search)); setQ(p.get("q") ?? "");
      setFOverdue(p.get("overdue") === "1"); setShowDone(p.get("done") === "1");
      setGroup(readListGroup(location.search)); setCreateGroup(null);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

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

  // Состояние → URL: реплейсим (не пушим) — фильтр не должен плодить историю
  // на каждое изменение чекбокса/дропдауна, иначе «назад» листало бы прошлые
  // состояния фильтра, а не реальную навигацию (см. useRouterSync.ts). q — с
  // задержкой (qDebounced ниже уже есть для запроса; для URL берём то же).
  useEffect(() => {
    if (path !== pathForView(data.project.key, "backlog")) return;
    const next = searchFromFilters(location.search, filters, { overdue: fOverdue ? "1" : "", done: showDone ? "1" : "", q: qDebounced, group });
    if (next !== location.search.replace(/^\?/, "")) {
      navigate(`${path}${next ? `?${next}` : ""}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- path/navigate стабильны для текущего вида; включать их
    // пересоздавало бы эффект на каждый чужой навигационный пуш и гоняло бы сравнение впустую.
  }, [filters, fOverdue, showDone, qDebounced, group, path, data.project.key]);

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
      sprintId: (sprintsOn && fSprint) || undefined,
      dueFrom: fDueFrom || undefined,
      dueTo: fDueTo || undefined,
      ...cfCond,
      q: qDebounced || undefined,
      overdue: fOverdue ? "1" : undefined,
      closed: !showDone && !fStatus ? "hide" : undefined,
    };
    return { projectId: data.currentProjectId, filters: apiFilters, sort: sortKey, dir: sortDir };
  }, [data.currentProjectId, fStatus, fAssignee, fType, fPriority, fLabel, fSprint, fDueFrom, fDueTo, cfCond, sprintsOn, qDebounced, fOverdue, showDone, sortKey, sortDir]);

  const set = useIssueSet(query);
  // Направления строк — справочник (один запрос на экран), а не поиск в списке всех задач.
  const epics = useEpics(data.currentProjectId || null, epicsRevision);

  // Правки задач (в т. ч. из модалки) живут в сторе; строки показывают свежую
  // версию оттуда, а набор перечитывается, чтобы состав (фильтр, удаление,
  // новые задачи) не устарел. Пока стор держит все задачи, это дёшево.
  const rows = useMemo(() => freshRows(set.items, idx.issues), [set.items, idx.issues]);
  const revision = useIssuesRevision();
  useOnRevision(revision, set.revalidate);
  const pool = useIssueCounts(data.currentProjectId || null, NO_ISSUE_FILTERS, revision);
  const overdueFilters = useMemo(() => query ? { ...query.filters, overdue: "1" as const } : null, [query]);
  const overdueCounts = useIssueCounts(data.currentProjectId || null, overdueFilters, revision);
  const groups = useMemo(() => groupListRows(rows, group, data.workflow.statuses.map(st => st.id)), [rows, group, data.workflow.statuses]);

  // Подгрузка при прокрутке к концу списка; кнопка «Показать ещё» — запасной путь.
  const { hasMore, loading, loadingMore, loadMore } = set;
  const sentinelRef = useLoadMoreSentinel(loadMore, hasMore && !loading && !loadingMore, rows.length);

  const filterActive = !!(q || fStatus || fAssignee || fType || fPriority || fLabel || fSprint || fDueFrom || fDueTo || cfCond || fOverdue || showDone);
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
      const noConditions = !fStatus && !fAssignee && !fType && !fPriority && !fLabel && !fSprint && !fDueFrom && !fDueTo && !cfCond && !q;
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
      sprintId: v.filter.sprintId ?? "",
      dueFrom: v.filter.dueFrom ?? "",
      dueTo: v.filter.dueTo ?? "",
      cf: v.filter.cf ?? "",
      cfValue: v.filter.cfValue ?? "",
      cfFrom: v.filter.cfFrom ?? "",
      cfTo: v.filter.cfTo ?? "",
      cfEmpty: v.filter.cfEmpty ?? "",
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
        sprintId: (sprintsOn && fSprint) || undefined,
        dueFrom: fDueFrom || undefined,
        dueTo: fDueTo || undefined,
        ...cfCond,
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
      toast("error", errText(e, t("backlog.viewSaveFailed")));
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
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
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
    el.style.setProperty("--list-min", `${tableMinWidth(cols, selectMode)}px`);
    el.style.setProperty("--list-title-start", selectMode ? "2" : "1");
    el.style.setProperty("--list-status-end", cols.includes("assignee") ? "-3" : "-2");
    // Телефон: только название с ключом, статус и исполнитель (остальные ячейки скрывает index.css).
    el.style.setProperty("--list-cols-sm", gridTemplate(cols.filter((c) => c === "status" || c === "assignee"), selectMode, true));
  });

  return (
    <div className="list-view flex h-full min-w-0 flex-col">
      {/* шапка */}
      <div className="workspace-view-header px-4 pb-3 pt-3.5 sm:px-[18px]">
        <WorkspaceControls selectionMode={selectMode} compact
          summary={t("board.filteredOf", { visible: rows.length, total: pool.counts?.total ?? "…" })}
          quickFilters={<WorkspaceQuickFilters active={id => id === "overdue" ? fOverdue : fAssignee === (id === "mine" ? data.currentUserId : "none")} onToggle={id => id === "overdue" ? setFOverdue(!fOverdue) : setField("assignee")(fAssignee === (id === "mine" ? data.currentUserId : "none") ? "" : id === "mine" ? data.currentUserId : "none")} overdue={overdueCounts.counts?.total} />}
          grouping={<Menu label={groupLabel} placement="bottom-end" trigger={p => <Button {...p} size="sm" className="workspace-grouping" iconRight={<IcChevD size={12} />}>{groupLabel}</Button>}
            items={GROUP_MODES.map(id => ({ id, label: t(groupKeys[id]), icon: group === id ? <IcCheck size={13} /> : undefined, onSelect: () => { setGroup(id); setCreateGroup(null); } }))} />}
          count={Object.values(filters).filter(Boolean).length + Number(fOverdue) + Number(showDone) + Number(!!q)}
          search={<WorkspaceSearch value={q} onChange={setQ} />}
          filters={<div className="workspace-filters-body flex flex-wrap items-center gap-2">
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
            aria-label={t("field.labels")}
            value={fLabel}
            onChange={(e) => setField("label")(e.target.value)}
            placeholder={t("backlog.labelPlaceholder")}
            className={`${selectCls} w-28`}
          />
          {sprintsOn && data.sprints.length > 0 && (
            <select aria-label={t("backlog.sprintFilter")} value={fSprint} onChange={(e) => setField("sprintId")(e.target.value)} className={`${selectCls} cursor-pointer`}>
              <option value="">{t("backlog.anySprint")}</option>
              {data.sprints.map((sp) => (
                <option key={sp.id} value={sp.id}>{sp.name}</option>
              ))}
            </select>
          )}
          <DueRangeFilter
            from={fDueFrom}
            to={fDueTo}
            onChange={(from, to) => setFilters((cur) => ({ ...cur, dueFrom: from, dueTo: to }))}
          />
          {data.customFields.length > 0 && (
            <CustomFieldFilter
              fields={data.customFields}
              value={filters}
              onChange={(next) => setFilters((cur) => ({ ...cur, ...next }))}
            />
          )}
          <span className="flex h-8 items-center rounded-md border border-line bg-panel px-2.5">
            <Checkbox checked={fOverdue} onChange={setFOverdue} label={t("backlog.overdue")} />
          </span>
          <span className="flex h-8 items-center rounded-md border border-line bg-panel px-2.5">
            <Checkbox checked={showDone} onChange={setShowDone} label={t("backlog.showClosed")} />
          </span>


          {/* ТЗ 3.2: сохранённые вьюхи — личные, применяют/сохраняют текущий набор условий. */}
          <Popover
            label={t("backlog.savedViews")}
            className="w-[240px]"
            trigger={(p, open) => (
              <Button size="sm" {...p} type="button" className={open ? "border-accent" : undefined}>
                <IcStar size={12} className="text-faint" />
                {t("backlog.savedViews")}
                {views.length > 0 && <span className="text-[10.5px] text-faint">({views.length})</span>}
                <IcChevD size={11} className="text-faint" />
              </Button>
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
                            // отменить переименование, не закрывая список (preventDefault гасит и закрытие popover)
                            e.preventDefault();
                            e.stopPropagation();
                            setRenaming(null);
                          }
                        }}
                        className="h-7 min-w-0 flex-1 rounded border border-accent bg-panel px-2 text-[12px] outline-none shadow-focus"
                      />
                    </div>
                  ) : (
                  <div key={v.id} className="group flex items-center">
                    <MenuButton className="min-w-0 flex-1" onClick={() => { applyView(v); close(); }}>
                      <span className="truncate">{v.name}</span>
                    </MenuButton>
                    <button
                      onClick={(e) => { e.stopPropagation(); void patchView(v, { isDefault: !v.isDefault }); }}
                      aria-pressed={v.isDefault}
                      aria-label={t(v.isDefault ? "backlog.unsetDefaultView" : "backlog.setDefaultView", { name: v.name })}
                      title={t(v.isDefault ? "backlog.unsetDefaultView" : "backlog.setDefaultView", { name: v.name })}
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-opacity hover:bg-hover ${v.isDefault ? "text-accenttext" : "text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
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
                <div role="separator" className="ds-menu-sep" />
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
                    <button onClick={() => void saveCurrentAsView()} className="text-[11px] font-semibold text-accenttext hover:underline">
                      {t("common.save")}
                    </button>
                  </div>
                ) : (
                  <MenuButton onClick={() => setSavingView(true)}>{t("backlog.saveAsView")}</MenuButton>
                )}
              </>
            )}
          </Popover>
          </div>}
          options={<div className="workspace-options-body flex flex-wrap items-center gap-2">
            {/* ТЗ 3.3: режим выделения — чекбоксы появляются в строках только пока он включён. */}
            <Button size="sm"
              aria-pressed={selectMode}
              onClick={() => setSelectMode((v) => !v)}
              className={selectMode ? "border-accent text-accenttext" : undefined}
            >
              {t("backlog.selectMode")}
            </Button>
            {can("create") && (
              <Button size="sm"
                onClick={() => setImportOpen(true)}
              >
                <IcInbox size={13} /> {t("import.title")}
              </Button>
            )}


            {/* колонки таблицы (ТЗ 5.12 e) */}
            <Popover
              label={t("backlog.columns")}
              placement="bottom-end"
              className="w-[230px]"
              trigger={(p, open) => (
                <Button size="sm" {...p} type="button" className={open ? "border-accent" : undefined}>
                  <IcDisplay size={12} className="text-faint" />
                  {t("backlog.columns")}
                  <IcChevD size={11} className="text-faint" />
                </Button>
              )}
            >
              <div className="flex flex-col gap-0.5 p-1">
                {COLUMNS.map((c) => (
                  <Checkbox key={c.id} checked={cols.includes(c.id)} onChange={() => toggleCol(c.id)} label={t(c.label)} />
                ))}
                <p className="mt-1 border-t border-linesoft px-1 pb-0.5 pt-1.5 text-[11px] leading-snug text-faint">{t("backlog.columnsHint")}</p>
              </div>
            </Popover>

            {/* сортировка */}
            <Menu
              label={t("backlog.sort.label")}
              placement="bottom-end"
              trigger={(p, open) => (
                <Button size="sm" {...p} type="button" className={open ? "border-accent" : undefined}>
                  <IcFilter size={12} className="text-faint" />
                  {sortLabels[sortKey]}
                  <IcChevD size={11} className="text-faint" />
                </Button>
              )}
              items={(Object.keys(sortLabels) as SortKey[]).map((k) => ({
                id: k,
                label: sortLabels[k],
                hint: k === sortKey ? <IcCheck size={12} className="text-accenttext" /> : undefined,
                onSelect: () => pickSort(k),
              }))}
            />
            <button
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              title={t(sortDir === "asc" ? "backlog.sort.asc" : "backlog.sort.desc")}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel shadow-e1 text-sub hover:text-ink"
              aria-label={t("backlog.sort.direction")}
            >
              <IcChevD size={13} className={sortDir === "asc" ? "rotate-180" : ""} />
            </button>
            </div>}
        />
        {filterActive && (<IssueFilterSummary filters={filters}>
            {fOverdue && <span>{t("backlog.overdue")}</span>}
            {showDone && <span>{t("backlog.showClosed")}</span>}
            <button onClick={resetFilters} className="ds-focus rounded px-2 py-1 font-medium hover:text-ink"><IcX size={12} className="inline" /> {t("common.reset")}</button>
          </IssueFilterSummary>
        )}

        {/* ТЗ 3.3: панель массовых действий — видна только при непустом выделении (общая с доской, ROUTE-03). */}
        {selectMode && selectedIds.size > 0 && <BulkBar selectedIds={selectedIds} onDone={clearSelection} className="mt-2.5" />}
      </div>

      {/* Full-width table; intermediate desktop widths scroll within the list. */}
      <div className="list-scroll min-h-0 flex-1 overflow-auto">
        <div className="list-table-wrap">
          {set.loading ? (
            <div
              className="overflow-hidden surface-raised rounded-xl ring-1 ring-inset ring-line/70"
              aria-busy="true"
              aria-label={t("common.loading")}
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <ListSkeletonRow key={i} />
              ))}
            </div>
          ) : set.error && rows.length === 0 ? (
            <EmptyState
              icon={<IcBacklog size={22} tone="indigo" />}
              title={t("backlog.loadError")}
              sub={errText(set.error, "")}
              action={<Button size="sm" variant="secondary" onClick={set.reload}>{t("common.retry")}</Button>}
            />
          ) : rows.length > 0 ? (
            <>
              {/* One grid for the header and rows; the list-scroll container owns both scroll axes. */}
              <div role="table" ref={tableRef} aria-label={t("backlog.title")} className="list-table rounded-lg border border-line bg-panel">
                <div role="row" className="list-grid list-head sticky top-0 z-10 items-center gap-x-3 border-b border-linesoft px-4 text-[12px] font-semibold text-faint">
                  {selectMode && (
                    <span role="columnheader" data-col="select" className="flex">
                      <Checkbox
                        label={t("backlog.selectAll")}
                        labelHidden
                        checked={allSelected}
                        indeterminate={!allSelected && rows.some((r) => selectedIds.has(r.id))}
                        onChange={(on) => setSelectedIds(on ? new Set(rows.map((r) => r.id)) : new Set())}
                      />
                    </span>
                  )}
                  {LEFT.filter((id) => cols.includes(id)).map((id) => (
                    <HeadCell key={id} id={id} sortKey={sortKey} sortDir={sortDir} onSort={toggleSortBy} compact />
                  ))}
                  <HeadCell id="key" sortKey={sortKey} sortDir={sortDir} onSort={toggleSortBy} />
                  <span role="columnheader" data-col="title">{t("backlog.col.title")}</span>
                  {COLUMNS.filter((c) => !LEFT.includes(c.id) && cols.includes(c.id)).map((c) => (
                    <HeadCell key={c.id} id={c.id} sortKey={sortKey} sortDir={sortDir} onSort={toggleSortBy} />
                  ))}
                  <span role="columnheader" data-col="actions"><span className="sr-only">{t("common.actions")}</span></span>
                </div>
                {groups.map(section => {
                  const st = group === "status" ? idx.statuses.get(section.id) : undefined;
                  const epic = group === "epic" ? epics.byId.get(section.id) : undefined;
                  const name = group === "status" ? st ? workflowStatusName(st, t) : t("field.status") : group === "epic" ? epic?.title ?? t("createIssue.noDirection") : section.id ? section.id.split("|").map(id => idx.users.get(id)?.name ?? t("createIssue.unassigned")).join(", ") : t("createIssue.unassigned");
                  const total = st ? set.counts?.byStatus[st.id] ?? section.items.length : section.items.length;
                  return <div key={section.id} role="rowgroup" aria-label={group === "none" ? undefined : name}>
                    {group !== "none" && <div role="row" className="list-group-head">
                      <div role="cell" aria-colspan={cols.length + 3 + Number(selectMode)} className="list-group-label">
                        {st && <StatusGlyph category={st.category} size={14} />}
                        <span className="truncate" title={name}>{name}</span>
                        <span className="list-group-count tabular" title={t("backlog.groupLoaded", { n: section.items.length })}>{section.items.length < total ? `${section.items.length}/${total}` : total}</span>
                        {st && can("create") && <button type="button" className="ds-focus list-group-add" data-create-status={st.id} aria-label={t("board.addToStatusAria", { name })} onClick={() => setCreateGroup(createGroup === st.id ? null : st.id)}><IcPlus size={14} /></button>}
                      </div>
                    </div>}
                    {st && createGroup === st.id && <div role="row" className="list-group-create"><div role="cell" aria-colspan={cols.length + 3 + Number(selectMode)}><QuickCreate status={st} onDone={() => { setCreateGroup(null); tableRef.current?.querySelector<HTMLButtonElement>(`[data-create-status="${CSS.escape(st.id)}"]`)?.focus(); }} /></div></div>}
                    {section.items.map(i => (
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
                  </div>;
                })}
                {loadingMore && (
                  <div className="border-t border-linesoft" aria-busy="true" aria-label={t("backlog.loadingMore")}>
                    <ListSkeletonRow />
                  </div>
                )}
              </div>
              <div ref={sentinelRef} className="mt-3 flex min-h-8 items-center justify-center text-[12px] text-faint">
                {set.error ? (
                  <button onClick={loadMore} className="font-medium text-accenttext hover:underline">
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

      <Presence show={importOpen}>{(open) => <Suspense fallback={null}><ImportModal open={open} onClose={() => setImportOpen(false)} /></Suspense>}</Presence>
    </div>
  );
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDaysLocal = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** «Срок»: готовые периоды считаются от сегодняшнего дня в момент выбора и дальше живут как обычные даты «с … по …»
 *  (так их можно сохранить в фильтр и поделиться ссылкой); «Свои даты» — два поля. */
function DueRangeFilter({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t, lang } = useT();
  const today = new Date();
  const monday = addDaysLocal(today, -((today.getDay() + 6) % 7));
  const presets: { key: string; from: string; to: string }[] = [
    { key: "backlog.due.today", from: isoDay(today), to: isoDay(today) },
    { key: "backlog.due.thisWeek", from: isoDay(monday), to: isoDay(addDaysLocal(monday, 6)) },
    { key: "backlog.due.next7", from: isoDay(today), to: isoDay(addDaysLocal(today, 7)) },
    { key: "backlog.due.thisMonth", from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDay(new Date(today.getFullYear(), today.getMonth() + 1, 0)) },
  ];
  const fmt = (s: string) => fmtDate(s, lang);
  const active = !!(from || to);
  const label = !active ? t("backlog.due.any") : from && to && from === to ? fmt(from) : `${from ? fmt(from) : "…"} – ${to ? fmt(to) : "…"}`;
  return (
    <Popover
      label={t("field.dueDate")}
      className="w-[250px]"
      trigger={(p, open) => (
        <Button size="sm"
          {...p}
          type="button"
          aria-label={`${t("field.dueDate")}: ${label}`}
          className={(open || active) ? "border-accent" : undefined}
        >
          <IcCalendar size={12} className="text-faint" />
          <span className="tabular">{active ? label : t("field.dueDate")}</span>
          <IcChevD size={11} className="text-faint" />
        </Button>
      )}
    >
      {(close) => (
        <>
          {presets.map((p) => (
            <MenuButton key={p.key} onClick={() => { onChange(p.from, p.to); close(); }}>
              {t(p.key as never)}
              {from === p.from && to === p.to && <IcCheck size={12} className="ml-auto text-accenttext" />}
            </MenuButton>
          ))}
          <div role="separator" className="ds-menu-sep" />
          <div className="grid grid-cols-2 gap-1.5 px-2.5 py-1.5">
            <div className="text-[11px] font-medium text-faint">
              {t("backlog.due.from")}
              <DatePicker block label={t("backlog.due.from")} placeholder={t("date.empty")} lang={lang} markOverdue={false} value={from || null} max={to || undefined} onChange={(v) => onChange(v ?? "", to)} />
            </div>
            <div className="text-[11px] font-medium text-faint">
              {t("backlog.due.to")}
              <DatePicker block label={t("backlog.due.to")} placeholder={t("date.empty")} lang={lang} markOverdue={false} value={to || null} min={from || undefined} onChange={(v) => onChange(from, v ?? "")} />
            </div>
          </div>
          {active && (
            <MenuButton onClick={() => { onChange("", ""); close(); }}>{t("backlog.due.clear")}</MenuButton>
          )}
        </>
      )}
    </Popover>
  );
}

/** Заглушка строки таблицы на время загрузки — из ds-примитивов, по форме строки (флажок/тип, ключ, название, поле, исполнитель). */
function ListSkeletonRow() {
  return (
    <div className="flex items-center gap-3 border-b border-linesoft px-3.5 py-3 last:border-0">
      <Skeleton.Line w="14px" h={14} />
      <Skeleton.Line w="56px" h={12} />
      <span className="min-w-0 max-w-[320px] flex-1">
        <Skeleton.Line h={12} />
      </span>
      <span className="hidden sm:block">
        <Skeleton.Line w="64px" h={16} />
      </span>
      <Skeleton.Circle size={16} />
    </div>
  );
}

/** Пункт внутри Popover (там, где кроме пунктов есть поля и Menu не подходит) — вид пункта ds-меню. */
function MenuButton({ onClick, className = "", children }: { onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`ds-menu-item ${className}`}>
      {children}
    </button>
  );
}

type CfPart = Pick<FilterState, "cf" | "cfValue" | "cfFrom" | "cfTo" | "cfEmpty">;
const CF_CLEAR: CfPart = { cf: "", cfValue: "", cfFrom: "", cfTo: "", cfEmpty: "" };

/** Условие по своему полю проекта (ROUTE-02): сначала поле, потом условие по его типу. Одно поле на набор — как
 *  остальные условия списка; смысл значений считает сервер (buildIssueFilter). */
function CustomFieldFilter({ fields, value, onChange }: { fields: CustomFieldDef[]; value: CfPart; onChange: (next: CfPart) => void }) {
  const { t, lang } = useT();
  const field = fields.find((f) => f.id === value.cf);
  const set = (part: Partial<CfPart>) => onChange({ ...CF_CLEAR, cf: value.cf, ...part });
  const fmt = (v: string) => (field?.fieldType === "date" ? fmtDate(v, lang) : v);
  const summary = !field
    ? ""
    : value.cfEmpty
      ? t("backlog.cf.empty")
      : field.fieldType === "checkbox"
        ? value.cfValue === "true"
          ? t("backlog.cf.checked")
          : value.cfValue === "false"
            ? t("backlog.cf.unchecked")
            : ""
        : value.cfFrom || value.cfTo
          ? value.cfFrom && value.cfTo && value.cfFrom === value.cfTo
            ? fmt(value.cfFrom)
            : `${value.cfFrom ? fmt(value.cfFrom) : "…"} – ${value.cfTo ? fmt(value.cfTo) : "…"}`
          : value.cfValue;
  const active = !!(field && summary);
  const inputCls = "mt-0.5 h-7 w-full rounded border border-line bg-panel px-1.5 text-[12px] text-ink outline-none focus:border-accent";
  const check = (on: boolean) => (on ? <IcCheck size={12} className="ml-auto text-accenttext" /> : null);
  return (
    <Popover
      label={t("backlog.cf.button")}
      className="w-[250px]"
      trigger={(p, open) => (
        <Button size="sm"
          {...p}
          type="button"
          aria-label={active ? `${field!.name}: ${summary}` : t("backlog.cf.button")}
          className={(open || active) ? "border-accent" : undefined}
        >
          <IcFilter size={12} className="shrink-0 text-faint" />
          <span className="truncate">{active ? `${field!.name}: ${summary}` : t("backlog.cf.button")}</span>
          <IcChevD size={11} className="shrink-0 text-faint" />
        </Button>
      )}
    >
      {(close) =>
        !field ? (
          <>
            <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-faint">{t("backlog.cf.pick")}</div>
            {fields.map((f) => (
              <MenuButton key={f.id} onClick={() => onChange({ ...CF_CLEAR, cf: f.id })}>
                <span className="truncate">{f.name}</span>
              </MenuButton>
            ))}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-2.5 pb-1 pt-1.5">
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{field.name}</span>
              <button type="button" onClick={() => onChange(CF_CLEAR)} className="shrink-0 text-[11.5px] font-medium text-accenttext hover:underline">
                {t("backlog.cf.other")}
              </button>
            </div>
            {field.fieldType === "select" &&
              field.options.map((o) => (
                <MenuButton key={o} onClick={() => { set({ cfValue: o }); close(); }}>
                  <span className="truncate">{o}</span>
                  {check(!value.cfEmpty && value.cfValue === o)}
                </MenuButton>
              ))}
            {field.fieldType === "checkbox" && (
              <>
                <MenuButton onClick={() => { set({ cfValue: "true" }); close(); }}>
                  {t("backlog.cf.checked")}
                  {check(value.cfValue === "true")}
                </MenuButton>
                <MenuButton onClick={() => { set({ cfValue: "false" }); close(); }}>
                  {t("backlog.cf.unchecked")}
                  {check(value.cfValue === "false")}
                </MenuButton>
              </>
            )}
            {field.fieldType === "text" && (
              <label className="block px-2.5 py-1.5 text-[11px] font-medium text-faint">
                {t("backlog.cf.contains")}
                <input
                  autoFocus
                  value={value.cfEmpty ? "" : value.cfValue}
                  maxLength={500}
                  onChange={(e) => set({ cfValue: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && close()}
                  className={inputCls}
                />
              </label>
            )}
            {(field.fieldType === "number" || field.fieldType === "date") && (
              <div className="grid grid-cols-2 gap-1.5 px-2.5 py-1.5">
                <label className="text-[11px] font-medium text-faint">
                  {t("backlog.cf.from")}
                  <input
                    type={field.fieldType === "date" ? "date" : "number"}
                    value={value.cfFrom}
                    max={field.fieldType === "date" ? value.cfTo || undefined : undefined}
                    onChange={(e) => set({ cfFrom: e.target.value, cfTo: value.cfTo })}
                    className={`${inputCls} tabular`}
                  />
                </label>
                <label className="text-[11px] font-medium text-faint">
                  {t("backlog.cf.to")}
                  <input
                    type={field.fieldType === "date" ? "date" : "number"}
                    value={value.cfTo}
                    min={field.fieldType === "date" ? value.cfFrom || undefined : undefined}
                    onChange={(e) => set({ cfFrom: value.cfFrom, cfTo: e.target.value })}
                    className={`${inputCls} tabular`}
                  />
                </label>
              </div>
            )}
            {field.fieldType !== "checkbox" && (
              <MenuButton onClick={() => { set({ cfEmpty: "1" }); close(); }}>
                {t("backlog.cf.empty")}
                {check(!!value.cfEmpty)}
              </MenuButton>
            )}
            {active && (
              <>
                <div role="separator" className="ds-menu-sep" />
                <MenuButton onClick={() => { onChange(CF_CLEAR); close(); }}>{t("backlog.cf.clear")}</MenuButton>
              </>
            )}
          </>
        )
      }
    </Popover>
  );
}
