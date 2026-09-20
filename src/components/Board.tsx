import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { canTransition, fmtDate, useStore } from "../store";
import type { Issue, Status, User } from "../types";
import { IcArchive, IcCalendar, IcCheck, IcEye, IcInbox, IcMove, IcPlus, IcSearch, IcX, PRIORITY_COLOR, PriorityIcon, TypeIcon } from "../icons";
import { Avatar, AvatarStack, BOARD_COLUMN_SHELL, Chip, SkeletonCard, catColor, DROPDOWN_OPEN_EVT } from "../ui";
import { useT, type TKey } from "../i18n";
import { workflowStatusName } from "../workflowStatus";
import { issuesApi, type IssueFilterParams } from "../api";
import {
  ISSUE_PAGE_SIZE,
  NO_ISSUE_FILTERS,
  freshRows,
  useDebounced,
  useIssueCounts,
  useIssueSet,
  useIssuesRevision,
  useLoadMoreSentinel,
  useOnRevision,
  type IssueSetQuery,
} from "../issuePages";
import {
  DONE_WINDOW_DAYS,
  boardFilterParams,
  columnFilterParams,
  columnTotal,
  hasBoardFilters,
  hiddenDoneCount,
  openTotal,
  type QuickChip,
} from "../boardFilters";

/** Поиск уходит на сервер не на каждую букву; пустой — сразу. */
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MAX = 120; // = LIMITS сервера для q
const isEmptyText = (v: string) => v === "";

// Быстрые фильтры-чипы над доской (round4 §3.3). Фильтры серверные
// (`boardFilters.ts`): окно «Готово» (DONE_WINDOW_DAYS) — там же; закрытое
// дальше окна прячется за строку «Ранее закрыто», а через ARCHIVE_AFTER_DAYS
// (настройка сервера) уходит в архив и перестаёт грузиться вовсе.
const QUICK_CHIPS: { id: QuickChip; labelKey: TKey }[] = [
  { id: "mine", labelKey: "board.quickChip.mine" },
  { id: "overdue", labelKey: "board.quickChip.overdue" },
  { id: "unassigned", labelKey: "board.quickChip.unassigned" },
];

/** Карточка доски.
 *
 *  Ассоциированные сущности приходят СВЕРХУ уже найденными, а не ищутся здесь
 *  через data.users.find / data.issues.find: раньше каждая карточка линейно
 *  проходила оба массива, что давало квадратичную сложность на весь экран
 *  (аудит PERF-02). Плюс memo — чтобы тик счётчика уведомлений в общем контексте
 *  не перерисовывал все карточки разом (PERF-01).
 */
const Card = memo(function Card({
  issue,
  assignees,
  epic,
  doneCat,
  onDragStart,
  onDragEnd,
  onDropOn,
  onOver,
  onMove,
  flash,
  draggable,
  moveTargets,
}: {
  issue: Issue;
  assignees: User[];
  epic: Issue | undefined;
  doneCat: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: (e: React.DragEvent) => void;
  onOver: () => void;
  onMove: (issueId: string, statusId: string) => void;
  flash: boolean;
  draggable: boolean;
  moveTargets: Status[];
}) {
  const { t, lang } = useT();
  const { openIssue } = useStore();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const overdue = !!issue.dueDate && !doneCat && issue.dueDate < new Date().toISOString().slice(0, 10);

  // Своё меню, не <Dropdown> (открывается ещё и с клавиатуры, см. onKeyDown
  // ниже) — но без этих двух эффектов оно вело себя как БАГ, а не как
  // дропдаун: не закрывалось по клику мимо и не закрывало другие такие же
  // меню на соседних карточках — на доске можно было открыть сразу несколько
  // одновременно, и они просто зависали открытыми до explicit-выбора пункта.
  useEffect(() => {
    if (!menu) return;
    const onOtherOpen = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== menuId) setMenu(false);
    };
    const onOutside = (e: PointerEvent) => {
      if (menuRef.current && !e.composedPath().includes(menuRef.current)) setMenu(false);
    };
    window.addEventListener(DROPDOWN_OPEN_EVT, onOtherOpen);
    document.addEventListener("pointerdown", onOutside, true);
    return () => {
      window.removeEventListener(DROPDOWN_OPEN_EVT, onOtherOpen);
      document.removeEventListener("pointerdown", onOutside, true);
    };
  }, [menu, menuId]);

  const toggleMenu = () => {
    setMenu((v) => {
      const next = !v;
      if (next) window.dispatchEvent(new CustomEvent(DROPDOWN_OPEN_EVT, { detail: menuId }));
      return next;
    });
  };

  return (
    <article
      draggable={draggable}
      tabIndex={0}
      aria-label={`${issue.key}: ${issue.title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openIssue(issue.id);
        }
        // «m» / «ь» — открыть список переходов с клавиатуры: перетаскивание
        // мышью было единственным способом сменить статус на доске (UX-02).
        if (draggable && (e.key.toLowerCase() === "m" || e.key === "ь")) {
          e.preventDefault();
          toggleMenu();
        }
        if (e.key === "Escape" && menu) {
          e.preventDefault();
          setMenu(false);
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", issue.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOver();
      }}
      onDrop={onDropOn}
      onClick={() => openIssue(issue.id)}
      className={`group relative cursor-pointer overflow-hidden rounded-lg border border-line bg-panel p-2.5 pt-3 shadow-[0_1px_2px_rgba(20,35,64,0.06)] transition-all duration-150 hover:-translate-y-px hover:border-line2 hover:shadow-[0_6px_18px_rgba(20,35,64,0.12)] active:scale-[0.99] ${flash ? (doneCat ? "anim-drop-done" : "anim-drop") : ""}`}
    >
      {/* цветной якорь сверху: цвет направления, иначе — приоритета (round4 §3.1) */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: epic?.color ?? PRIORITY_COLOR[issue.priorityId] }}
      />

      {/* тип + ключ */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <TypeIcon type={issue.typeId} size={14} />
        <span className="font-mono text-[11px] font-semibold tracking-tight text-faint">{issue.key}</span>
      </div>

      <h4 className="text-[13.5px] font-medium leading-snug text-ink">{issue.title}</h4>

      {/* направление + метки */}
      {(epic || issue.labels.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {epic && (
            <span
              className="inline-flex max-w-[130px] items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: `${epic.color}1f`, color: epic.color }}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-sm" style={{ background: epic.color }} />
              <span className="truncate">{epic.title}</span>
            </span>
          )}
          {issue.labels.slice(0, 3).map((l) => (
            <Chip key={l} text={l} />
          ))}
        </div>
      )}

      {/* приоритет с подписью · срок · исполнитель */}
      <div className="mt-2.5 flex items-center gap-2">
        <span className="flex items-center gap-1 text-[10.5px] font-bold" style={{ color: PRIORITY_COLOR[issue.priorityId] }}>
          <PriorityIcon p={issue.priorityId} size={12} />
          {t(`priority.${issue.priorityId}`)}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {issue.dueDate && (
            <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${overdue ? "text-danger" : "text-faint"}`}>
              <IcCalendar size={11} />
              {fmtDate(issue.dueDate, lang)}
            </span>
          )}
          <AvatarStack users={assignees} size={22} interactive />
        </span>
      </div>

      {/* Перемещение без мыши. Кнопка видна при наведении и при фокусе с
          клавиатуры, список — только разрешённые схемой переходы. */}
      {draggable && (
        <div className="absolute right-1 top-1" ref={menuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMenu();
            }}
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={t("board.moveAria", { key: issue.key })}
            className="flex h-5 w-5 items-center justify-center rounded text-faint opacity-0 transition-opacity hover:bg-canvas hover:text-ink focus:opacity-100 focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100"
          >
            <IcMove size={12} />
          </button>
          {menu && (
            <div
              role="menu"
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-6 z-20 min-w-[168px] rounded-lg border border-line bg-panel p-1 shadow-[0_8px_24px_rgba(12,22,38,0.18)]"
            >
              {moveTargets.length === 0 && (
                <p className="px-2 py-1.5 text-[11.5px] text-faint">{t("board.noAllowedTransitions")}</p>
              )}
              {moveTargets.map((target) => (
                <button
                  key={target.id}
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    onMove(issue.id, target.id);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-canvas"
                >
                  <span className="h-1.5 w-1.5 rounded-sm" style={{ background: catColor(target.category).dot }} />
                  {target.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
});

function QuickCreate({ status, onDone }: { status: Status; onDone: () => void }) {
  const { t } = useT();
  const { createIssue } = useStore();
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return onDone();
    createIssue({
      title: text,
      description: "",
      typeId: "task",
      priorityId: "medium",
      assigneeIds: [],
      epicId: null,
      labels: [],
      complexity: null,
      statusId: status.id,
    });
    setText("");
  };
  return (
    <div className="anim-fadeup rounded-lg border border-accent bg-panel p-2 shadow-[0_0_0_3px_rgba(11,95,217,0.1)]">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onDone();
        }}
        placeholder={t("board.quickCreatePlaceholder", { status: workflowStatusName(status, t) })}
        rows={2}
        className="w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-faint"
      />
      <div className="flex items-center gap-1.5">
        <button onClick={submit} className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-accentdeep">
          <IcCheck size={12} /> {t("board.addButton")}
        </button>
        <button onClick={onDone} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-canvas hover:text-ink" aria-label={t("common.cancel")}>
          <IcX size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * Карточки одной колонки: собственный постраничный набор (первые
 * ISSUE_PAGE_SIZE, дальше — по прокрутке или кнопке), независимый от соседних.
 * Число в заголовке колонки берётся из счётчика сервера, а не из числа
 * загруженных карточек.
 */
function ColumnCards({
  projectId,
  filters,
  revision,
  renderCard,
}: {
  projectId: string;
  filters: IssueFilterParams;
  revision: string;
  renderCard: (issue: Issue) => React.ReactNode;
}) {
  const { t } = useT();
  const { data, idx } = useStore();
  const query = useMemo<IssueSetQuery>(() => ({ projectId, filters, sort: "rank", dir: "asc" }), [projectId, filters]);
  const set = useIssueSet(query, { withCounts: false });
  useOnRevision(revision, set.revalidate);
  const rows = useMemo(() => freshRows(set.items, idx.issues, data.issues.length > 0), [set.items, idx.issues, data.issues.length]);

  const { hasMore, loading, loadingMore, loadMore } = set;
  const sentinelRef = useLoadMoreSentinel(loadMore, hasMore && !loading && !loadingMore, rows.length, "200px");

  return (
    <>
      {loading && rows.length === 0 && (
        <div aria-busy="true" aria-label={t("common.loading")} className="space-y-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {set.error && rows.length === 0 && !loading && (
        <button onClick={set.reload} className="w-full rounded-lg border border-dashed border-danger px-3 py-3 text-[11.5px] font-medium text-danger hover:bg-dangersoft">
          {t("board.columnLoadError")}
        </button>
      )}
      {rows.map((i) => renderCard(i))}
      {loadingMore && <SkeletonCard />}
      <div ref={sentinelRef}>
        {set.error && rows.length > 0 ? (
          <button onClick={loadMore} className="w-full px-3 py-1.5 text-[11.5px] font-medium text-accent hover:underline">
            {t("board.loadMoreFailed")}
          </button>
        ) : hasMore && !loadingMore ? (
          <button
            onClick={loadMore}
            className="w-full rounded-lg px-3 py-1.5 text-[11.5px] font-medium text-faint transition-colors hover:text-accent"
          >
            {t("board.loadMore")}
          </button>
        ) : !hasMore && rows.length > ISSUE_PAGE_SIZE ? (
          <p className="px-3 py-1.5 text-center text-[11px] text-faint">{t("board.allLoaded", { n: rows.length })}</p>
        ) : null}
      </div>
    </>
  );
}

export default function Board() {
  const { t, tn } = useT();
  const { data, ui, moveStatus, can } = useStore();
  const canMove = can("transition");
  const canCreate = can("create");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [filterUser, setFilterUser] = useState<string | null | "none">(null);
  const [q, setQ] = useState("");
  const [chips, setChips] = useState<Set<QuickChip>>(new Set());
  const [quickFor, setQuickFor] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);

  const toggleChip = (id: QuickChip) =>
    setChips((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Показывать ли в «Готово» всё закрытое или только свежее (см. DONE_WINDOW_DAYS).
  const [showAllDone, setShowAllDone] = useState(false);

  const doneStatusId = data.workflow.statuses.find((s) => s.category === "done")?.id;
  const doneIds = useMemo(
    () => new Set(data.workflow.statuses.filter((s) => s.category === "done").map((s) => s.id)),
    [data.workflow.statuses],
  );

  // Индексы вместо линейного поиска в каждой карточке (аудит PERF-02).
  const usersById = useMemo(() => new Map(data.users.map((u) => [u.id, u])), [data.users]);
  const issuesById = useMemo(() => new Map(data.issues.map((i) => [i.id, i])), [data.issues]);
  const statusById = useMemo(
    () => new Map(data.workflow.statuses.map((st) => [st.id, st])),
    [data.workflow.statuses],
  );

  // Куда эту задачу разрешено двигать по схеме workflow (для меню на карточке).
  const targetsFor = useCallback(
    (statusId: string) => data.workflow.statuses.filter((st) => st.id !== statusId && canTransition(data.workflow, statusId, st.id)),
    [data.workflow],
  );
  // Быстрое создание («+») — только у первого столбца категории «todo» (по позиции):
  // накидывать задачи имеет смысл в начало потока, не в «В работе»/«Готово» (D3).
  const firstTodoId = data.workflow.statuses.find((s) => s.category === "todo")?.id;

  // Фильтры доски — на сервере (PERF-05): колонки видят только свои первые
  // страницы, и клиентский фильтр «по загруженному» искал бы лишь в них.
  const qDebounced = useDebounced(q.trim().slice(0, SEARCH_MAX), SEARCH_DEBOUNCE_MS, isEmptyText);
  const fState = useMemo(
    () => ({ filterUser, chips, q: qDebounced, currentUserId: data.currentUserId }),
    [filterUser, chips, qDebounced, data.currentUserId],
  );
  const baseFilters = useMemo(() => boardFilterParams(fState), [fState]);
  const filtersOn = hasBoardFilters(fState);
  const projectId = data.currentProjectId || null;
  const revision = useIssuesRevision();
  const hasDoneColumn = doneIds.size > 0;

  // Счётчики: один запрос на набор фильтров, а не на колонку и не на рендер.
  const filtered = useIssueCounts(projectId, baseFilters, revision);
  const unfiltered = useIssueCounts(projectId, filtersOn ? NO_ISSUE_FILTERS : null, revision);
  const olderFilters = useMemo(
    () => (hasDoneColumn && !showAllDone ? { ...baseFilters, closed: "older" as const, closedDays: DONE_WINDOW_DAYS } : null),
    [hasDoneColumn, showAllDone, baseFilters],
  );
  const older = useIssueCounts(projectId, olderFilters, revision);
  const projectCounts = filtersOn ? unfiltered.counts : filtered.counts;

  /** Задачи колонки: их получает `ColumnCards`. «Готово» по умолчанию — только
   *  закрытое за DONE_WINDOW_DAYS (аудит LIFE-02); остальное — в один клик по
   *  строке «Ранее закрыто». Задачи без doneAt (закрытые до миграции 016)
   *  считаются свежими, чтобы они не пропали из виду молча. */
  const totalOf = (sid: string) => columnTotal(filtered.counts, older.counts, sid, { isDone: doneIds.has(sid), showAllDone });
  const hiddenDone = (sid: string) => hiddenDoneCount(older.counts, sid, { isDone: doneIds.has(sid), showAllDone });

  // Полоска аватаров-фильтров: самые загруженные исполнители проекта (сервер), а
  // не «все, кого видно среди загруженных задач».
  const [topAssignees, setTopAssignees] = useState<string[]>([]);
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    issuesApi.assignees(projectId, 24).then(
      (r) => live && setTopAssignees(r.items.map((x) => x.userId)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [projectId]);
  const assignees = useMemo(() => {
    const ids = new Set(topAssignees);
    if (filterUser && filterUser !== "none") ids.add(filterUser);
    return [...ids].map((id) => usersById.get(id)).filter((u): u is User => !!u);
  }, [topAssignees, filterUser, usersById]);

  const dragged = dragId ? (issuesById.get(dragId) ?? null) : null;

  /** Проект, где не осталось ни одной незакрытой задачи (аудит LIFE-04).
   *  Для отдела, работающего волнами, это нормальное и частое состояние, а не
   *  крайний случай, — и показывать его надо как достижение, а не как пустой
   *  экран с надписью «перетащите задачи сюда». */
  const openCount = openTotal(projectCounts, doneIds);
  const poolTotal = projectCounts?.total ?? null;
  const allClear = poolTotal !== null && poolTotal > 0 && openCount === 0;
  const recentDone = useIssueCounts(projectId, allClear ? { closed: "recent", closedDays: 30 } : null, revision);
  const closedRecently = recentDone.counts?.total ?? 0;
  const canDropTo = (sid: string) => !dragged || dragged.statusId === sid || canTransition(data.workflow, dragged.statusId, sid);

  return (
    <div className="flex h-full flex-col">
      {/* шапка */}
      <div className="border-b border-line bg-panel/70 px-4 py-3.5 sm:px-6">
       <div className="flex flex-wrap items-center gap-3">
        <div className="mr-2">
          <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">{t("board.title")}</h1>
          <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-faint">
            <span>{data.project.name}</span>
            <span>·</span>
            <span>{poolTotal ?? "…"} {tn(poolTotal ?? 0, "noun.issue.one", "noun.issue.few", "noun.issue.many")}</span>
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center -space-x-1.5">
            {assignees.map((u) => (
              <button
                key={u.id}
                onClick={() => setFilterUser(filterUser === u.id ? null : u.id)}
                title={t("board.filterUserAria", { name: u.name })}
                className={`rounded-full transition-all ${filterUser === u.id ? "z-10 scale-110 ring-2 ring-accent" : "hover:z-10 hover:scale-105"} ${filterUser && filterUser !== u.id ? "opacity-40" : ""}`}
              >
                <Avatar user={u} size={26} ring />
              </button>
            ))}
            <button
              onClick={() => setFilterUser(filterUser === "none" ? null : "none")}
              title={t("board.unassignedFilter")}
              className={`rounded-full transition-all ${filterUser === "none" ? "z-10 scale-110 ring-2 ring-accent" : "hover:z-10 hover:scale-105"} ${filterUser && filterUser !== "none" ? "opacity-40" : ""}`}
            >
              <Avatar user={null} size={26} ring />
            </button>
          </div>
          <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-panel px-2.5">
            <IcSearch size={13} className="text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("board.searchPlaceholder")} className="w-32 bg-transparent text-[12.5px] outline-none placeholder:text-faint" />
            {q && (
              <button onClick={() => setQ("")} className="text-faint hover:text-ink" aria-label={t("common.reset")}>
                <IcX size={12} />
              </button>
            )}
          </div>
        </div>
       </div>

       {/* быстрые фильтры-чипы (round4 §3.3) */}
       <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
         {QUICK_CHIPS.map((c) => {
           const on = chips.has(c.id);
           return (
             <button
               key={c.id}
               onClick={() => toggleChip(c.id)}
               className={`flex h-7 items-center rounded-full border px-2.5 text-[12px] font-medium transition-colors ${
                 on ? "border-accent bg-accentsoft text-accent" : "border-line bg-panel text-sub hover:border-line2"
               }`}
             >
               {t(c.labelKey)}
             </button>
           );
         })}
         {chips.size > 0 && (
           <button
             onClick={() => setChips(new Set())}
             className="flex h-7 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-faint hover:text-ink"
           >
             <IcX size={11} /> {t("common.reset")}
           </button>
         )}
         <span className="ml-auto text-[11.5px] text-faint">{t("board.filteredOf", { visible: filtered.counts?.total ?? "…", total: poolTotal ?? "…" })}</span>
       </div>
      </div>

      {!canMove && (
        <div className="flex items-center gap-2 border-b border-line bg-warnsoft/60 px-6 py-1.5 text-[12px] font-medium text-warn">
          <IcEye size={14} className="shrink-0" />
          <span className="truncate">{t("board.readOnlyBanner")}</span>
        </div>
      )}

      {allClear && (
        <div className="border-b border-line bg-oksoft/50 px-6 py-3">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-ok">
            <IcCheck size={15} /> {t("board.allClearTitle")}
          </p>
          <p className="mt-0.5 text-[11.5px] text-sub">
            {closedRecently > 0
              ? t("board.closedRecently", { n: closedRecently, noun: tn(closedRecently, "noun.issueAcc.one", "noun.issueAcc.few", "noun.issueAcc.many") })
              : t("board.noOpenIssues")}
            {canCreate && t("board.canCreateSuffix")}
          </p>
        </div>
      )}

      {/* колонки. w-max + mx-auto: на широком экране группа колонок
          центрируется, а когда не влезает — просто прокручивается от левого края
          (ticket-board-columns-theme-fix §3). */}
      <div className="dotgrid flex-1 overflow-x-auto overflow-y-hidden">
        <div className="mx-auto flex h-full w-max items-start gap-4 px-4 py-4 sm:px-6">
          {data.workflow.statuses.map((st, ci) => {
            const total = totalOf(st.id);
            const colFilters = columnFilterParams(baseFilters, st.id, { isDone: doneIds.has(st.id), showAllDone });
            const c = catColor(st.category);
            const isOver = overCol === st.id;
            const ok = canDropTo(st.id);
            return (
              <section
                key={st.id}
                className={`anim-fadeup ${BOARD_COLUMN_SHELL}`}
                style={{ animationDelay: `${ci * 60}ms` }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverCol(st.id);
                }}
                onDragLeave={(e) => {
                  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOverCol(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  setOverCol(null);
                  setDragId(null);
                  dragRef.current = null;
                  if (id) moveStatus(id, st.id, null);
                }}
              >
                <header className="mb-1.5 flex items-center gap-2 px-1.5 pt-1">
                  <span className="h-2 w-2 rounded-sm" style={{ background: c.dot }} />
                  <h3 className="text-[12px] font-bold uppercase tracking-wider text-sub">{workflowStatusName(st, t)}</h3>
                  <span className="rounded-full bg-todosoft px-1.5 font-mono text-[10.5px] font-bold text-sub">{total ?? "…"}</span>
                  {canCreate && st.id === firstTodoId && (
                    <button
                      onClick={() => setQuickFor(st.id)}
                      className="ml-auto flex h-6 w-6 items-center justify-center rounded text-faint transition-colors hover:bg-todosoft hover:text-ink"
                      aria-label={t("board.addToStatusAria", { name: workflowStatusName(st, t) })}
                    >
                      <IcPlus size={14} />
                    </button>
                  )}
                </header>

                <div
                  className={`flex-1 space-y-2 overflow-y-auto rounded-lg border border-dashed p-1.5 transition-all duration-150 ${
                    isOver ? (ok ? "border-accent bg-accentsoft" : "border-danger bg-dangersoft") : "border-transparent bg-canvas"
                  }`}
                >
                  {quickFor === st.id && <QuickCreate status={st} onDone={() => setQuickFor(null)} />}
                  {projectId && (
                    <ColumnCards
                      projectId={projectId}
                      filters={colFilters}
                      revision={revision}
                      renderCard={(i) => (
                        <Card
                          key={i.id}
                          issue={i}
                          assignees={i.assigneeIds.map((id) => usersById.get(id)).filter((u): u is User => !!u)}
                          epic={i.epicId ? issuesById.get(i.epicId) : undefined}
                          doneCat={statusById.get(i.statusId)?.category === "done"}
                          moveTargets={targetsFor(i.statusId)}
                          onMove={(id, to) => moveStatus(id, to, null)}
                          flash={ui.lastEvent?.issueId === i.id && Date.now() - ui.lastEvent.ts < 1500}
                          onDragStart={() => {
                            setDragId(i.id);
                            dragRef.current = i.id;
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setOverCol(null);
                            dragRef.current = null;
                          }}
                          onDropOn={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const id = e.dataTransfer.getData("text/plain");
                            setOverCol(null);
                            setDragId(null);
                            if (id && id !== i.id) moveStatus(id, st.id, i.id);
                          }}
                          onOver={() => setOverCol(st.id)}
                          draggable={can("transition", i)}
                        />
                      )}
                    />
                  )}
                  {/* Свёрнутый «хвост» закрытого: данные на месте, в один клик. */}
                  {hiddenDone(st.id) > 0 && (
                    <button
                      onClick={() => setShowAllDone(true)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line2 px-3 py-2 text-[11.5px] font-medium text-faint transition-colors hover:border-accent hover:text-accent"
                    >
                      <IcArchive size={12} />
                      {t("board.hiddenDone", { n: hiddenDone(st.id) })}
                    </button>
                  )}
                  {showAllDone && doneIds.has(st.id) && (
                    <button
                      onClick={() => setShowAllDone(false)}
                      className="w-full rounded-lg px-3 py-1.5 text-[11px] font-medium text-faint transition-colors hover:text-ink"
                    >
                      {t("board.collapseDone", { days: DONE_WINDOW_DAYS })}
                    </button>
                  )}
                  {total === 0 && quickFor !== st.id && hiddenDone(st.id) === 0 && (
                    <div className={`rounded-lg border border-dashed px-3 py-6 text-center text-[11.5px] transition-colors ${isOver ? "border-accent text-accent" : "border-line2 text-faint"}`}>
                      {isOver ? (ok ? t("board.dropReleaseOk") : t("board.dropForbidden")) : t("board.dropHere")}
                    </div>
                  )}
                  {isOver && !ok && (
                    <p className="rounded bg-dangersoft px-2 py-1 text-center text-[11px] font-semibold text-danger">
                      {t("board.transitionOutOfSchema", {
                        from: dragged ? workflowStatusName(data.workflow.statuses.find((s) => s.id === dragged.statusId) ?? { name: "" }, t) : "",
                        to: workflowStatusName(st, t),
                      })}
                    </p>
                  )}
                </div>

                {st.id === doneStatusId && total !== null && total > 0 && (
                  <p className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-ok">
                    <IcInbox size={13} /> {t("board.closedCount", { n: total })}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
