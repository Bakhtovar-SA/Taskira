import QuickCreate from "./QuickCreateIssue";
import { Suspense, lazy, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cssVars } from "../cssVars";
import { localToday } from "../calendarLayout";
import { flipFrom } from "../motion";
import { useLocation } from "wouter";
import { EMPTY_FILTERS, customFieldCondition, filtersFromSearch, searchFromFilters, projectIssueSearch, pathForView } from "../router";
import { Hint } from "./Hint";
import { IssueFilterSummary } from "./IssueFilterSummary";
import { WorkspaceControls, WorkspaceSearch, WorkspaceQuickFilters } from "./WorkspaceControls";
import { useStore } from "../store";
import { usePersonalBoardPhoto } from "../personalBoardPhoto";
import BoardBackgroundControl from "./BoardBackgroundControl";
import { createExternalStore, useExternalStore, type ExternalStore } from "../store/external";
import type { PermId } from "../permissions";
import { canTransition, fmtDate } from "../store/mappers";
import type { Issue, Status, User } from "../types";
import { DueRing, IcArchive, IcBoard, IcCheck, IcEye, IcMove, IcChevD, IcPlus, IcSubtasks, IcX, PriorityIcon, StatusGlyph } from "../icons";
import { BOARD_COLUMN_BODY, BOARD_COLUMN_SHELL, directionColor } from "../ui";
import { UserAvatar, UserAvatarGroup } from "./UserAvatar";
import { Checkbox } from "../ds/Field";
import { Menu } from "../ds/LazyOverlay";
import { Button } from "../ds/Button";
import { EmptyState, Skeleton } from "../ds/Display";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";
import { preloadIssueModal } from "../lazyModals";
import { boardMoveRows } from "../boardMoves";
import { issuesApi, type IssueEpic, type IssueFilterParams } from "../api";
import {
  ISSUE_PAGE_SIZE,
  NO_ISSUE_FILTERS,
  useDebounced,
  useEpics,
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
  usersById,
  epic,
  status,
  statusPos,
  onOpen: openIssue,
  onDragStart,
  onDragEnd,
  onDropOn,
  onOver,
  onMove,
  flash,
  draggable,
  moveTargets,
  selecting,
  selected,
  onToggleSelect,
}: {
  issue: Issue;
  /** Справочник пользователей (стабилен, пока не меняется `data.users`): исполнители
   *  карточки выбираются здесь, а не массивом сверху — новый массив на каждый рендер
   *  доски ломал memo (ADR-0011, шаг 0). */
  usersById: ReadonlyMap<string, User>;
  /** Направление карточки из справочника (`useEpics`), а не из списка задач в сторе. */
  epic: Pick<IssueEpic, "id" | "title" | "color"> | undefined;
  /** Статус карточки (стабильный объект из справочника) и его место в процессе 0…1 — для глифа. */
  status: Status | undefined;
  statusPos: number;
  /** Открыть задачу. Пропсом, а не `useStore()` внутри: подписка на контекст обходит memo. */
  onOpen: (id: string) => void;
  /** Все колбэки стабильны (useCallback в доске/колонке) и получают задачу аргументом,
   *  а не замыкают её: иначе memo(Card) не держит (ADR-0011, шаг 0). */
  onDragStart: (issue: Issue) => void;
  onDragEnd: () => void;
  onDropOn: (e: React.DragEvent, target: Issue) => void;
  onOver: () => void;
  onMove: (issueId: string, statusId: string) => void;
  flash: boolean;
  draggable: boolean;
  moveTargets: Status[];
  /** Режим выделения (ROUTE-03): клик и Enter/пробел отмечают карточку вместо открытия, перетаскивание выключено —
   *  так выделение не спорит с нативным drag&drop одной карточки (ADR-0007). */
  selecting: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const { t, lang } = useT();
  const assignees = useMemo(
    () => issue.assigneeIds.map((id) => usersById.get(id)).filter((u): u is User => !!u),
    [issue.assigneeIds, usersById],
  );
  const [menu, setMenu] = useState(false);
  // Приземление после переноса (ТЗ 5.13 п.3): карточка появилась на новом месте (ответ сервера) — доезжает туда
  // из точки, где отпустили «призрак». Только для только что брошенной карточки, не для чужих перемещений.
  const cardRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const l = landing;
    if (!l || l.id !== issue.id || l.statusId !== issue.statusId || performance.now() - l.at > 1500 || !cardRef.current) return;
    landing = null;
    flipFrom(cardRef.current, l.left, l.top);
  }, [issue.id, issue.statusId, issue.rank]);
  const doneCat = status?.category === "done";
  const today = localToday();
  const dueDays = issue.dueDate ? Math.round((Date.parse(issue.dueDate) - Date.parse(today)) / 864e5) : null;
  const overdue = !!issue.dueDate && !doneCat && issue.dueDate < today;

  // Перемещение без мыши (UX-02): меню открывается кнопкой и клавишей M на карточке, поэтому управляемое. Клик мимо,
  // Esc и «открыто только одно на доске» даёт сам Popover API (popover="auto"). Меню живёт внутри карточки в дереве
  // React, поэтому клики и клавиши из него не должны всплывать до карточки (иначе Enter по пункту открыл бы задачу).
  const moveButton = draggable && !selecting && (
    <span
      className="flex"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Глушим только то, что карточка поняла бы неверно: клавиши изнутри меню и Enter/Пробел на кнопке (иначе
        // открылась бы задача). M на кнопке и остальные клавиши (J/K, общие сочетания) идут дальше как обычно.
        if ((e.target as Element).closest("[popover]") || e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
    >
      <Menu
        open={menu}
        onOpenChange={setMenu}
        placement="bottom-end"
        label={t("board.moveAria", { key: issue.key })}
        trigger={(p, open) => (
          <button
            {...p}
            type="button"
            aria-label={t("board.moveAria", { key: issue.key })}
            className={`flex h-5 w-5 items-center justify-center rounded-md text-faint transition-opacity hover:bg-hover hover:text-ink focus:opacity-100 group-hover:opacity-100 ${open ? "opacity-100" : "opacity-0"}`}
          >
            <IcMove size={14} />
          </button>
        )}
        items={
          moveTargets.length === 0
            ? [{ kind: "label", id: "none", label: t("board.noAllowedTransitions") }]
            : moveTargets.map((target) => ({
                id: target.id,
                label: target.name,
                icon: <StatusGlyph category={target.category} size={15} />,
                onSelect: () => onMove(issue.id, target.id),
              }))
        }
      />
    </span>
  );

  return (
    <article
      ref={cardRef}
      draggable={draggable && !selecting}
      tabIndex={0}
      aria-label={`${issue.key}: ${issue.title}`}
      data-selected={selecting && selected ? "" : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (selecting) onToggleSelect(issue.id);
          else openIssue(issue.id);
        }
        // «m» / «ь» — открыть список переходов с клавиатуры: перетаскивание
        // мышью было единственным способом сменить статус на доске (UX-02).
        if (draggable && !selecting && (e.key.toLowerCase() === "m" || e.key === "ь")) {
          e.preventDefault();
          setMenu((v) => !v);
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", issue.id);
        e.dataTransfer.effectAllowed = "move";
        setDragGhost(e);
        onDragStart(issue);
      }}
      onDragEnd={(e) => {
        e.currentTarget.removeAttribute("data-dragging");
        onDragEnd();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOver();
      }}
      onDrop={(e) => onDropOn(e, issue)}
      onPointerEnter={preloadIssueModal}
      onFocus={preloadIssueModal}
      onClick={() => (selecting ? onToggleSelect(issue.id) : openIssue(issue.id))}
      data-issue-id={issue.id}
      data-priority={!doneCat && issue.priorityId === "critical" ? "critical" : undefined}
      data-done={doneCat || undefined}
      className={`board-card group relative flex cursor-pointer flex-col ${flash ? (doneCat ? "anim-drop-done" : "anim-drop") : ""}`}
    >
      <div className="board-card-title-row flex items-start gap-2">
        {selecting && (
          <span className="flex shrink-0" onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={selected} onChange={() => onToggleSelect(issue.id)} label={t("backlog.selectRow", { key: issue.key })} labelHidden tabIndex={-1} />
          </span>
        )}
        <h3 className="min-w-0 flex-1">{issue.title}</h3>
        {moveButton}
      </div>
      {epic && <div className="board-card-direction" title={epic.title}>
        <i ref={cssVars({ "--direction-color": directionColor(epic.id, epic.color) })} />
        <span>{epic.title}</span>
      </div>}
      <div className="board-card-meta">
        <PriorityIcon p={issue.priorityId} size={17} />
        <span className="board-card-key tabular">{issue.key}</span>
        {issue.dueDate && <span className="board-card-due tabular"
          data-urgency={doneCat ? "done" : overdue ? "late" : dueDays !== null && dueDays <= 3 ? "soon" : "later"}
          title={overdue ? t("board.quickChip.overdue") : undefined}
          aria-label={overdue ? t("board.overdueDate", { date: fmtDate(issue.dueDate, lang) }) : undefined}>
          <DueRing due={issue.dueDate} today={today} done={doneCat} size={14} />
          <span>{fmtDate(issue.dueDate, lang)}</span>
        </span>}
        <span className="board-card-assignees ml-auto flex items-center gap-2">
          {!!issue.subtasksSummary?.total && <span
            className="board-card-subtasks flex items-center gap-1 tabular"
            data-complete={issue.subtasksSummary.done === issue.subtasksSummary.total || undefined}
            title={t("board.subtasksTip", { done: issue.subtasksSummary.done, total: issue.subtasksSummary.total })}
            aria-label={t("board.subtasksTip", { done: issue.subtasksSummary.done, total: issue.subtasksSummary.total })}>
            <IcSubtasks size={14} />{issue.subtasksSummary.done}/{issue.subtasksSummary.total}
          </span>}
          {assignees.length > 0 && <UserAvatarGroup users={assignees} size={22} interactive />}
        </span>
      </div>
    </article>
  );
});

/** Заглушка повторяет порядок и размеры карточки. */
function BoardSkeletonCard() {
  return <div className="board-card flex flex-col" aria-hidden="true">
    <Skeleton.Line h={14} /><Skeleton.Line w="66%" h={14} />
    <div className="flex h-[22px] items-center gap-2">
      <Skeleton.Line w="64px" h={12} /><Skeleton.Line w="56px" h={20} />
      <span className="ml-auto"><Skeleton.Circle size={22} /></span>
    </div>
  </div>;
}


/**
 * Своё изображение перетаскиваемой карточки (ТЗ 5.13 п.3, ADR-0007 — нативный DnD):
 * копия карточки чуть под наклоном, с акцентной кромкой и тенью, а на исходном
 * месте — пунктирный силуэт (`data-dragging`). Атрибут и размеры пишутся через
 * DOM/CSSOM, не через состояние React: начало перетаскивания не перерисовывает
 * ни одной карточки (ADR-0011, шаг 0), а CSSOM разрешён CSP (ADR-0010).
 */
/** Где курсор взял карточку и куда её отпустили — для FLIP-приземления в Card (модульное состояние: перетаскивание
 *  одно на страницу, а через React оно перерисовало бы доску). */
let grab = { x: 0, y: 0 };
let landing: { id: string; statusId: string; left: number; top: number; at: number } | null = null;
const noteLanding = (id: string, statusId: string, e: React.DragEvent) => {
  landing = { id, statusId, left: e.clientX - grab.x, top: e.clientY - grab.y, at: performance.now() };
};

function setDragGhost(e: React.DragEvent<HTMLElement>) {
  const card = e.currentTarget;
  card.setAttribute("data-dragging", "");
  const rect = card.getBoundingClientRect();
  grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  if (typeof e.dataTransfer.setDragImage !== "function") return;
  const wrap = document.createElement("div");
  wrap.className = "drag-ghost";
  const clone = card.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-dragging");
  clone.removeAttribute("id");
  clone.style.width = `${rect.width}px`;
  wrap.appendChild(clone);
  document.body.appendChild(wrap);
  // Точка захвата — там же, где курсор взял карточку (+ поле обёртки под тень).
  e.dataTransfer.setDragImage(wrap, e.clientX - rect.left + 16, e.clientY - rect.top + 16);
  requestAnimationFrame(() => wrap.remove());
}


/**
 * Карточки одной колонки: собственный постраничный набор (первые
 * ISSUE_PAGE_SIZE, дальше — по прокрутке или кнопке), независимый от соседних.
 * Число в заголовке колонки берётся из счётчика сервера, а не из числа
 * загруженных карточек.
 */
const ColumnCards = memo(function ColumnCards({
  projectId,
  filters,
  revision,
  renderCard,
  moves,
  doneStatus,
  onMovesApplied,
}: {
  projectId: string;
  filters: IssueFilterParams;
  revision: string;
  renderCard: (issue: Issue) => React.ReactNode;
  moves: ReadonlyMap<string, string>;
  doneStatus: boolean;
  onMovesApplied: (ids: readonly string[]) => void;
}) {
  const { t } = useT();
  const { data, idx } = useStore();
  const query = useMemo<IssueSetQuery>(() => ({ projectId, filters, sort: "rank", dir: "asc" }), [projectId, filters]);
  const set = useIssueSet(query, { withCounts: false });
  useOnRevision(revision, set.revalidate);
  const rows = useMemo(() => boardMoveRows(set.items, idx.issues, filters.status!, moves, { overdueOnly: filters.overdue === "1", doneStatus }), [set.items, idx.issues, filters.status, filters.overdue, moves, doneStatus]);
  useEffect(() => {
    const applied: string[] = [];
    for (const [id, target] of moves) {
      const current = idx.issues.get(id);
      if (current && (current.statusId !== target || (target === filters.status && set.items.some(i => i.id === id && i.statusId === target && i.rank === current.rank)))) applied.push(id);
    }
    if (applied.length) onMovesApplied(applied);
  }, [moves, idx.issues, filters.status, set.items, onMovesApplied]);

  const { hasMore, loading, loadingMore, loadMore } = set;
  const sentinelRef = useLoadMoreSentinel(loadMore, hasMore && !loading && !loadingMore, rows.length, "200px");

  return (
    <>
      {loading && rows.length === 0 && (
        <div aria-busy="true" aria-label={t("common.loading")} className="skeleton-late space-y-2">
          <BoardSkeletonCard />
          <BoardSkeletonCard />
        </div>
      )}
      {set.error && rows.length === 0 && !loading && (
        <button onClick={set.reload} className="w-full rounded-lg border border-dashed border-danger px-3 py-3 text-[13px] font-medium text-danger hover:bg-dangersoft">
          {t("board.columnLoadError")}
        </button>
      )}
      {rows.map((i) => renderCard(i))}
      {loadingMore && <BoardSkeletonCard />}
      <div ref={sentinelRef}>
        {set.error && rows.length > 0 ? (
          <button onClick={loadMore} className="w-full px-3 py-1.5 text-[13px] font-medium text-accent hover:underline">
            {t("board.loadMoreFailed")}
          </button>
        ) : hasMore && !loadingMore ? (
          <button
            onClick={loadMore}
            className="w-full rounded-lg px-3 py-1.5 text-[13px] font-medium text-faint transition-colors hover:text-accent"
          >
            {t("board.loadMore")}
          </button>
        ) : !hasMore && rows.length > ISSUE_PAGE_SIZE ? (
          <p className="px-3 py-1.5 text-center text-[12px] text-faint">{t("board.allLoaded", { n: rows.length })}</p>
        ) : null}
      </div>
    </>
  );
});

/** Стабильный пустой список переходов (новый `[]` на каждый рендер ломал бы memo карточки). */
const NO_TARGETS: Status[] = [];
const NO_SELECTION: ReadonlySet<string> = new Set();
const NO_MOVES: ReadonlyMap<string, string> = new Map();
/** Панель массовых действий — отдельный чанк: нужна только в режиме выделения, первый экран доски без неё. */
const BulkBar = lazy(() => import("./BulkBar"));

/**
 * Колонка доски — отдельный memo-компонент (ADR-0011): подписка на hoverStore обновляет
 * только прежнюю и новую колонку под курсором. Memo-список карточек не обходится заново
 * при смене подсветки; начало перетаскивания обновляет доступность переходов во всех колонках.
 */
const BoardColumn = memo(function BoardColumn({
  moves,
  onMovesApplied,
  st,
  total,
  hiddenDone,
  colFilters,
  hoverStore,
  ok,
  draggedStatusId,
  isDone,
  showAllDone,
  setShowAllDone,
  canCreate,
  isFirstTodo,
  quickOpen,
  setQuickFor,
  projectId,
  revision,
  usersById,
  statusById,
  posById,
  epicsById,
  targetsByStatus,
  lastEvent,
  can,
  moveStatus,
  onOpen,
  onMove,
  onCardDragStart,
  onCardDragEnd,
  setOverCol,
  setDragId,
  dragRef,
  selecting,
  selectedIds,
  onToggleSelect,
}: {
  moves: ReadonlyMap<string, string>;
  onMovesApplied: (ids: readonly string[]) => void;
  st: Status;
  total: number | null;
  hiddenDone: number;
  colFilters: IssueFilterParams;
  hoverStore: ExternalStore<string | null>;
  ok: boolean;
  /** Статус перетаскиваемой задачи — только колонке под курсором (текст «переход вне схемы»). */
  draggedStatusId: string | null;
  isDone: boolean;
  showAllDone: boolean;
  setShowAllDone: (v: boolean) => void;
  canCreate: boolean;
  isFirstTodo: boolean;
  quickOpen: boolean;
  setQuickFor: (id: string | null) => void;
  projectId: string | null;
  revision: string;
  usersById: ReadonlyMap<string, User>;
  statusById: ReadonlyMap<string, Status>;
  /** Место статуса в процессе 0…1 (для заполнения глифа статуса). */
  posById: ReadonlyMap<string, number>;
  epicsById: ReadonlyMap<string, IssueEpic>;
  targetsByStatus: ReadonlyMap<string, Status[]>;
  lastEvent: { issueId: string; ts: number } | null;
  can: (perm: PermId, issue?: Issue) => boolean;
  moveStatus: (issueId: string, toStatus: string, beforeId?: string | null) => void;
  onOpen: (id: string) => void;
  onMove: (issueId: string, statusId: string) => void;
  onCardDragStart: (issue: Issue) => void;
  onCardDragEnd: () => void;
  setOverCol: (id: string | null) => void;
  setDragId: (id: string | null) => void;
  dragRef: { current: string | null };
  /** Режим выделения доски (ROUTE-03) и выделенные задачи — из любых колонок. */
  selecting: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (id: string) => void;
}) {
  const { t } = useT();
  const isOver = useExternalStore(hoverStore, (id) => id === st.id);
  const statusPos = posById.get(st.id) ?? 0.5;
  const onOver = useCallback(() => setOverCol(st.id), [setOverCol, st.id]);
  const onDropOn = useCallback(
    (e: React.DragEvent, target: Issue) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.dataTransfer.getData("text/plain");
      setOverCol(null);
      setDragId(null);
      if (id && id !== target.id) {
        noteLanding(id, st.id, e);
        moveStatus(id, st.id, target.id);
      }
    },
    [setOverCol, setDragId, moveStatus, st.id],
  );
  const renderCard = useCallback(
    (i: Issue) => (
      <Card
        key={i.id}
        issue={i}
        usersById={usersById}
        epic={i.epicId ? epicsById.get(i.epicId) : undefined}
        status={statusById.get(i.statusId)}
        statusPos={posById.get(i.statusId) ?? 0.5}
        moveTargets={targetsByStatus.get(i.statusId) ?? NO_TARGETS}
        onOpen={onOpen}
        onMove={onMove}
        flash={lastEvent?.issueId === i.id && Date.now() - lastEvent.ts < 1500}
        onDragStart={onCardDragStart}
        onDragEnd={onCardDragEnd}
        onDropOn={onDropOn}
        onOver={onOver}
        draggable={can("transition", i)}
        selecting={selecting}
        selected={selectedIds.has(i.id)}
        onToggleSelect={onToggleSelect}
      />
    ),
    [usersById, epicsById, statusById, posById, targetsByStatus, onOpen, onMove, lastEvent, onCardDragStart, onCardDragEnd, onDropOn, onOver, can, selecting, selectedIds, onToggleSelect],
  );
  return (
    <section
      aria-label={workflowStatusName(st, t)}
      className={`board-col relative snap-start rounded-xl ${BOARD_COLUMN_SHELL}`}
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
        if (id) {
          noteLanding(id, st.id, e);
          moveStatus(id, st.id, null);
        }
      }}
    >
      {/* Заголовок внутри поверхности колонки и не прокручивается с карточками: глиф статуса, имя, число с сервера. */}
      <header className="board-col-header group/col flex shrink-0 items-center gap-2 px-1.5">
        <StatusGlyph category={st.category} position={statusPos} size={16} />
        <h2 className="min-w-0 truncate text-[15px] font-bold tracking-[-0.005em] text-ink">{workflowStatusName(st, t)}</h2>
        <span className="tabular text-[13.5px] text-faint">{total ?? "…"}</span>
        {isDone && !showAllDone && <span className="board-done-window text-[13px] text-faint">{t("board.doneWindow", { days: DONE_WINDOW_DAYS })}</span>}
        {canCreate && (
          <button
            onClick={() => setQuickFor(st.id)}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
            aria-label={t("board.addToStatusAria", { name: workflowStatusName(st, t) })}
          >
            <IcPlus size={16} />
          </button>
        )}
      </header>

      {/* Highlight a separate leaf: changing the scroll container invalidates styles for every card. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none board-col-highlight absolute inset-x-0 bottom-0 rounded-b-xl ${isOver ? (ok ? "bg-accentsoft/60 shadow-[inset_0_0_0_1px_var(--accent-muted)]" : "bg-dangersoft/60 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--status-danger)_40%,transparent)]") : ""}`}
      />
      <div className={`${BOARD_COLUMN_BODY} relative`}>
        {quickOpen && <QuickCreate status={st} onDone={() => setQuickFor(null)} />}
        {projectId && (
          <ColumnCards
            projectId={projectId}
            filters={colFilters}
            revision={revision}
            renderCard={renderCard}
            moves={moves}
            doneStatus={isDone}
            onMovesApplied={onMovesApplied}
          />
        )}
        {canCreate && isFirstTodo && !quickOpen && total !== 0 && (
          <button
            onClick={() => setQuickFor(st.id)}
            className="flex h-[30px] shrink-0 items-center gap-[7px] rounded-lg px-2 text-[13.5px] text-faint transition-colors hover:bg-hover hover:text-ink"
          >
            <IcPlus size={15} />
            {t("board.addCard")}
          </button>
        )}
        {/* Свёрнутый «хвост» закрытого: данные на месте, в один клик. */}
        {hiddenDone > 0 && (
          <button
            onClick={() => setShowAllDone(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] text-faint transition-colors hover:bg-hover hover:text-ink"
          >
            <IcArchive size={14} />
            {t("board.hiddenDone", { n: hiddenDone })}
          </button>
        )}
        {showAllDone && isDone && (
          <button
            onClick={() => setShowAllDone(false)}
            className="w-full rounded-lg px-3 py-1.5 text-[13px] text-faint transition-colors hover:bg-hover hover:text-ink"
          >
            {t("board.collapseDone", { days: DONE_WINDOW_DAYS })}
          </button>
        )}
        {total === 0 && !quickOpen && hiddenDone === 0 && (
          <div className={`rounded-lg border border-dashed px-3 py-6 text-center text-[13px] transition-colors ${isOver ? (ok ? "border-accent text-accenttext" : "border-danger/60 text-danger") : "border-line text-faint"}`}>
            {isOver ? (ok ? t("board.dropReleaseOk") : t("board.dropForbidden")) : t("board.dropHere")}
          </div>
        )}
      </div>
      {isOver && !ok && (
        <p className="pointer-events-none absolute inset-x-1.5 bottom-1.5 z-10 rounded-md bg-dangersoft px-2 py-1 text-center text-[13px] font-medium text-[var(--status-danger-fg)]">
          {t("board.transitionOutOfSchema", {
            from: draggedStatusId ? workflowStatusName(statusById.get(draggedStatusId) ?? { name: "" }, t) : "",
            to: workflowStatusName(st, t),
          })}
        </p>
      )}

    </section>
  );
});

export default function Board() {
  const { t, tn } = useT();
  const { data, ui, moveStatus, openIssue, can, epicsRevision, setCreateOpen } = useStore();
  const { photo: personalPhoto, error: boardPhotoError } = usePersonalBoardPhoto(data.currentUserId, data.currentProjectId);
  const canMove = can("transition");
  const canCreate = can("create");
  const [dragId, setDragId] = useState<string | null>(null);
  // Перетаскиваемую задачу берём из самой карточки, а не ищем по id в сторе: стор больше не
  // держит все задачи, и «нет в сторе» молча отключило бы проверку допустимости перехода
  // (canDropTo) — все колонки выглядели бы допустимыми.
  const [dragIssue, setDragIssue] = useState<Issue | null>(null);
  const [hoverStore] = useState(() => createExternalStore<string | null>(null));
  const setOverCol = useCallback((id: string | null) => hoverStore.setState(() => id), [hoverStore]);
  const [path, navigate] = useLocation();
  const initialSearch = projectIssueSearch(data.project.key, location.pathname, location.search);
  const [sharedFilters, setSharedFilters] = useState(() => filtersFromSearch(initialSearch));
  const [filterUser, setFilterUser] = useState<string | null>(() => sharedFilters.assignee || null);
  const [q, setQ] = useState(() => new URLSearchParams(initialSearch).get("q") ?? "");
  const [chips, setChips] = useState<Set<QuickChip>>(() => new Set(new URLSearchParams(initialSearch).get("overdue") === "1" ? ["overdue"] : []));
  const [quickFor, setQuickFor] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);
  // Выделение для массовых действий (ROUTE-03): те же действия и тот же серверный маршрут, что в «Списке задач».
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(NO_SELECTION);
  const onToggleSelect = useCallback(
    (id: string) =>
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  const clearSelection = useCallback(() => setSelectedIds(NO_SELECTION), []);
  useEffect(() => {
    if (!selectMode) clearSelection();
  }, [selectMode, clearSelection]);
  useEffect(() => {
    setSelectMode(false);
  }, [data.currentProjectId]);
  // Esc выходит из режима выделения (модалки перехватывают Esc раньше — там он закрывает модалку).
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open], [role=dialog]")) setSelectMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectMode]);

  const toggleChip = (id: QuickChip) => {
    if (id !== "overdue") {
      const assignee = id === "mine" ? data.currentUserId : "none";
      setFilterUser(filterUser === assignee ? null : assignee);
      return;
    }
    setChips((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Показывать ли в «Готово» всё закрытое или только свежее (см. DONE_WINDOW_DAYS).
  const [showAllDone, setShowAllDone] = useState(() => new URLSearchParams(initialSearch).get("done") === "1");

  useEffect(() => {
    const restore = () => {
      const p = new URLSearchParams(location.search), f = filtersFromSearch(location.search);
      setSharedFilters(f); setFilterUser(f.assignee || null); setQ(p.get("q") ?? "");
      setChips(new Set(p.get("overdue") === "1" ? ["overdue"] : [])); setShowAllDone(p.get("done") === "1");
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const doneIds = useMemo(
    () => new Set(data.workflow.statuses.filter((s) => s.category === "done").map((s) => s.id)),
    [data.workflow.statuses],
  );

  // Индексы вместо линейного поиска в каждой карточке (аудит PERF-02).
  const usersById = useMemo(() => new Map(data.users.map((u) => [u.id, u])), [data.users]);
  const statusById = useMemo(
    () => new Map(data.workflow.statuses.map((st) => [st.id, st])),
    [data.workflow.statuses],
  );

  const posById = useMemo(() => {
    const ss = data.workflow.statuses;
    return new Map(ss.map((st, i) => [st.id, ss.length > 1 ? i / (ss.length - 1) : 0.5]));
  }, [data.workflow.statuses]);

  // Куда задачу из статуса разрешено двигать по схеме workflow (для меню на карточке) — один
  // массив на статус, пересчитывается со схемой, а не на каждый рендер: иначе memo(Card) не держит.
  const targetsByStatus = useMemo(
    () =>
      new Map(
        data.workflow.statuses.map((from) => [
          from.id,
          data.workflow.statuses.filter((st) => st.id !== from.id && canTransition(data.workflow, from.id, st.id)),
        ]),
      ),
    [data.workflow],
  );
  // Нижняя кнопка быстрого создания остаётся у первого todo; «+» в шапке есть у каждого статуса.
  const firstTodoId = data.workflow.statuses.find((s) => s.category === "todo")?.id;

  // Фильтры доски — на сервере (PERF-05): колонки видят только свои первые
  // страницы, и клиентский фильтр «по загруженному» искал бы лишь в них.
  const qDebounced = useDebounced(q.trim().slice(0, SEARCH_MAX), SEARCH_DEBOUNCE_MS, isEmptyText);
  const fState = useMemo(
    () => ({ filterUser, chips, q: qDebounced, currentUserId: data.currentUserId }),
    [filterUser, chips, qDebounced, data.currentUserId],
  );
  const baseFilters = useMemo<IssueFilterParams>(() => ({
    status: sharedFilters.status || undefined, type: sharedFilters.type || undefined,
    priority: sharedFilters.priority || undefined, label: sharedFilters.label || undefined,
    sprintId: data.project.sprintsEnabled ? sharedFilters.sprintId || undefined : undefined,
    dueFrom: sharedFilters.dueFrom || undefined, dueTo: sharedFilters.dueTo || undefined,
    ...customFieldCondition(sharedFilters), ...boardFilterParams(fState),
  }), [fState, sharedFilters, data.project.sprintsEnabled]);
  const filtersOn = hasBoardFilters(fState) || Object.entries(sharedFilters).some(([k, v]) => k !== "assignee" && !!v);
  const resetFilters = () => { setSharedFilters(EMPTY_FILTERS); setFilterUser(null); setChips(new Set()); setQ(""); };
  useEffect(() => {
    if (path !== pathForView(data.project.key, "board")) return;
    const next = searchFromFilters(location.search, { ...sharedFilters, assignee: baseFilters.assignee ?? "" },
      { q: qDebounced, overdue: baseFilters.overdue ?? "", done: showAllDone ? "1" : "" });
    if (next !== location.search.replace(/^\?/, "")) navigate(`${path}${next ? `?${next}` : ""}`, { replace: true });
  }, [sharedFilters, baseFilters, qDebounced, showAllDone, path, data.project.key]);
  const projectId = data.currentProjectId || null;
  const moveQueryKey = JSON.stringify([projectId, baseFilters]);
  const [localMoves, setLocalMoves] = useState<{ key: string; moves: ReadonlyMap<string, string> }>({ key: "", moves: NO_MOVES });
  const moves = localMoves.key === moveQueryKey ? localMoves.moves : NO_MOVES;
  const moveQueryRef = useRef(moveQueryKey);
  moveQueryRef.current = moveQueryKey;
  const moveRequests = useRef(new Map<string, symbol>());
  const onMovesApplied = useCallback((ids: readonly string[]) => {
    setLocalMoves(prev => {
      if (prev.key !== moveQueryKey || !ids.some(id => prev.moves.has(id))) return prev;
      const next = new Map(prev.moves);
      ids.forEach(id => next.delete(id));
      return { key: moveQueryKey, moves: next };
    });
  }, [moveQueryKey]);
  const moveOnBoard = useCallback((id: string, to: string, before?: string | null) => {
    if (!canMove) return;
    const request = Symbol();
    moveRequests.current.set(id, request);
    moveStatus(id, to, before, confirmed => {
      if (moveRequests.current.get(id) !== request) return;
      moveRequests.current.delete(id);
      if (moveQueryRef.current !== moveQueryKey) return;
      if (!confirmed) { onMovesApplied([id]); return; }
      setLocalMoves(prev => {
        const next = new Map(prev.key === moveQueryKey ? prev.moves : NO_MOVES);
        next.delete(id);
        next.set(id, to);
        if (next.size > 128) next.delete(next.keys().next().value!);
        return { key: moveQueryKey, moves: next };
      });
    });
  }, [moveStatus, moveQueryKey, canMove, onMovesApplied]);
  const revision = useIssuesRevision();
  const epics = useEpics(projectId, epicsRevision);
  const hasDoneColumn = doneIds.size > 0;

  // Счётчики: один запрос на набор фильтров, а не на колонку и не на рендер.
  const filtered = useIssueCounts(projectId, baseFilters, revision);
  const overdueFilters = useMemo(() => ({ ...baseFilters, overdue: "1" as const }), [baseFilters]);
  const overdueCounts = useIssueCounts(projectId, overdueFilters, revision);
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
  // Фильтры колонок — по объекту на статус, стабильные между рендерами доски (иначе каждая
  // колонка получала бы новый объект и перерисовывалась вместе с любым состоянием доски).
  const colFiltersById = useMemo(
    () =>
      new Map(
        data.workflow.statuses.map((st) => [st.id, columnFilterParams(baseFilters, st.id, { isDone: doneIds.has(st.id), showAllDone })]),
      ),
    [data.workflow.statuses, baseFilters, doneIds, showAllDone],
  );

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

  const dragged = dragId ? dragIssue : null;

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

  // Колбэки карточек стабильны: задачу они получают аргументом (ADR-0011, шаг 0).
  const onMove = useCallback((id: string, to: string) => moveOnBoard(id, to, null), [moveOnBoard]);
  const onCardDragStart = useCallback((i: Issue) => {
    setDragId(i.id);
    setDragIssue(i);
    dragRef.current = i.id;
  }, []);
  const onCardDragEnd = useCallback(() => {
    setDragId(null);
    setOverCol(null);
    dragRef.current = null;
  }, [setOverCol]);

  return (
    <div className="board-view flex h-full min-w-0 flex-col">
      {/* шапка */}
      <div className="workspace-view-header px-4 pb-3 pt-3.5 sm:px-[18px]">
        <WorkspaceControls selectionMode={selectMode}
          compact
          summary={t("board.filteredOf", { visible: data.workflow.statuses.reduce<number | null>((sum, st) => { const n = totalOf(st.id); return sum === null || n === null ? null : sum + n; }, 0) ?? "…", total: poolTotal ?? "…" })}
          quickFilters={<WorkspaceQuickFilters active={id => id === "overdue" ? chips.has(id) : baseFilters.assignee === (id === "mine" ? data.currentUserId : "none")} onToggle={toggleChip} overdue={overdueCounts.counts?.total} />}
          grouping={<Menu label={t("workspace.groupingNone")} placement="bottom-end"
            trigger={p => <Button {...p} size="sm" className="workspace-grouping" iconRight={<IcChevD size={14} />}>{t("workspace.groupingNone")}</Button>}
            items={[{ id: "none", label: t("workspace.noGrouping"), icon: <IcCheck size={15} />, onSelect: () => {
              const params = new URLSearchParams(location.search); params.set("group", "none"); navigate(path + "?" + params, { replace: true });
            } }]} />}
          count={Object.values(baseFilters).filter(Boolean).length}
          search={<WorkspaceSearch value={q} onChange={setQ} />}
          filters={<div className="workspace-filters-body space-y-3">
          <p className="ds-label">{t("field.assignee")}</p>
          <div className="board-assignees flex min-w-0 max-w-full items-center -space-x-1.5 overflow-x-auto py-1">
            {assignees.map((u) => (
              <button
                key={u.id}
                onClick={() => setFilterUser(filterUser === u.id ? null : u.id)}
                aria-label={t("board.filterUserAria", { name: u.name })}
                aria-pressed={filterUser === u.id}
                title={t("board.filterUserAria", { name: u.name })}
                className={`rounded-full transition-[transform,opacity] duration-150 ${filterUser === u.id ? "z-10 ring-2 ring-accent ring-offset-2 ring-offset-[var(--bg-canvas)]" : "hover:z-10 hover:-translate-y-0.5"} ${filterUser && filterUser !== u.id ? "opacity-40" : ""}`}
              >
                <UserAvatar user={u} size={26} ring />
              </button>
            ))}
            <button
              onClick={() => setFilterUser(filterUser === "none" ? null : "none")}
              aria-label={t("board.unassignedFilter")}
              aria-pressed={filterUser === "none"}
              title={t("board.unassignedFilter")}
              className={`rounded-full transition-[transform,opacity] duration-150 ${filterUser === "none" ? "z-10 ring-2 ring-accent ring-offset-2 ring-offset-[var(--bg-canvas)]" : "hover:z-10 hover:-translate-y-0.5"} ${filterUser && filterUser !== "none" ? "opacity-40" : ""}`}
            >
              <UserAvatar user={null} size={26} ring />
            </button>
          </div>
              {canMove && <Hint id="board-move">{t("hint.boardMove")}</Hint>}
            </div>}
          options={<div className="workspace-options-body flex flex-wrap items-center gap-2">
              <BoardBackgroundControl key={`${data.currentUserId}:${data.currentProjectId}`} userId={data.currentUserId} projectId={data.currentProjectId} hasPhoto={!!personalPhoto} />
          <button
            onClick={() => setSelectMode((v) => !v)}
            aria-pressed={selectMode}
            className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13.5px] font-medium transition-colors ${selectMode ? "border-accent text-accenttext" : "border-line text-sub hover:border-accent hover:text-accenttext"}`}
          >
            {t("backlog.selectMode")}
          </button>
            </div>}
        />
        {filtersOn && <IssueFilterSummary filters={baseFilters}>
          {chips.has("overdue") && <span>{t("board.quickChip.overdue")}</span>}
          {filtersOn && <button onClick={resetFilters} className="ds-focus rounded px-2 py-1 font-medium hover:text-ink"><IcX size={14} className="inline" /> {t("common.reset")}</button>}
        </IssueFilterSummary>}
       {selectMode && selectedIds.size === 0 && (
         <p className="mt-2.5 text-[13px] text-faint" role="status">
           {t("board.selectHint")}
         </p>
       )}
       {selectMode && selectedIds.size > 0 && (
         <Suspense fallback={null}>
           <BulkBar selectedIds={selectedIds} onDone={clearSelection} className="mt-1" />
         </Suspense>
       )}
      </div>

      {!canMove && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-warnsoft px-3 py-1.5 text-[13.5px] text-[var(--status-progress-fg)] sm:mx-6">
          <IcEye size={16} className="shrink-0" />
          <span className="truncate">{t("board.readOnlyBanner")}</span>
        </div>
      )}

      {allClear && (
        <div className="mx-4 mb-2 rounded-lg bg-oksoft px-4 py-3 sm:mx-6">
          <p className="flex items-center gap-2 text-[14.5px] font-medium text-[var(--status-done-fg)]">
            <IcCheck size={17} /> {t("board.allClearTitle")}
          </p>
          <p className="mt-0.5 text-[13px] text-sub">
            {closedRecently > 0
              ? t("board.closedRecently", { n: closedRecently, noun: tn(closedRecently, "noun.issueAcc.one", "noun.issueAcc.few", "noun.issueAcc.many") })
              : t("board.noOpenIssues")}
            {canCreate && t("board.canCreateSuffix")}
          </p>
        </div>
      )}

      {/* Проект без единой задачи (не путать с allClear — там закрыто хоть что-то): колонки
          остаются под низом как цели переноса, а сверху — объяснение места и одно действие. */}
      {poolTotal === 0 && !filtersOn && (
        <div className="mx-4 mb-2 sm:mx-6">
          <EmptyState
            icon={<IcBoard size={22} tone="violet" />}
            title={t("empty.board.title")}
            sub={t("empty.board.sub")}
            action={canCreate ? <Button size="sm" onClick={() => setCreateOpen(true)}>{t("home.createIssue")}</Button> : undefined}
          />
        </div>
      )}



      {/* колонки. Сетка ограничивает ширину карточек. Группа начинается от левого края, под заголовком и фильтрами:
          раньше она стояла по центру, и на широком мониторе доска висела островом посреди пустоты, оторванная от
          своей же шапки (часть F, скриншот владельца на 3440 px). Лишнее место остаётся справа. */}
      {boardPhotoError && <p role="alert" className="px-4 text-[13px] text-danger">{t("board.personalStorageFailed")}</p>}
      <div data-personal-board-photo={personalPhoto ? "true" : undefined}
        ref={node => {
          // Trusted object URL from IndexedDB: set via CSSOM, preserving the generic style URL guard.
          if (node) node.style.backgroundImage = personalPhoto ? `linear-gradient(color-mix(in oklch, var(--bg-canvas) 65%, transparent), color-mix(in oklch, var(--bg-canvas) 65%, transparent)), url("${personalPhoto.url}")` : "";
        }}
        className="board-scroll min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="board-columns" ref={cssVars({ "--board-columns": String(Math.max(1, data.workflow.statuses.length)) })}>
          {data.workflow.statuses.map((st) => {
            return (
              <BoardColumn
                key={st.id}
                st={st}
                total={totalOf(st.id)}
                hiddenDone={hiddenDone(st.id)}
                colFilters={colFiltersById.get(st.id) ?? NO_ISSUE_FILTERS}
                hoverStore={hoverStore}
                ok={canDropTo(st.id)}
                draggedStatusId={dragged?.statusId ?? null}
                isDone={doneIds.has(st.id)}
                showAllDone={showAllDone}
                setShowAllDone={setShowAllDone}
                canCreate={canCreate}
                isFirstTodo={st.id === firstTodoId}
                quickOpen={quickFor === st.id}
                setQuickFor={setQuickFor}
                projectId={projectId}
                revision={revision}
                usersById={usersById}
                statusById={statusById}
                posById={posById}
                epicsById={epics.byId}
                targetsByStatus={targetsByStatus}
                lastEvent={ui.lastEvent}
                can={can}
                moveStatus={moveOnBoard}
                moves={moves}
                onMovesApplied={onMovesApplied}
                onOpen={openIssue}
                onMove={onMove}
                onCardDragStart={onCardDragStart}
                onCardDragEnd={onCardDragEnd}
                setOverCol={setOverCol}
                setDragId={setDragId}
                dragRef={dragRef}
                selecting={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={onToggleSelect}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
