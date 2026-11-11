/** Колонка доски и её постраничный список карточек. Вынесено из Board.tsx без изменения поведения. */
import QuickCreate from "./QuickCreateIssue";
import { lazy, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { BoardDoneTail } from "./BoardDoneTail";
import { BoardSkeletonCard, Card, noteLanding } from "./BoardCard";
import { useSkeletonReveal } from "../useSkeletonReveal";
import { playBoardFlip } from "../boardFlip";
import { useStore } from "../store";
import { useExternalStore, type ExternalStore } from "../store/external";
import type { PermId } from "../permissions";
import type { Issue, Status, User } from "../types";
import { IcArchive, IcPlus, StatusGlyph } from "../icons";
import { BOARD_COLUMN_BODY, BOARD_COLUMN_SHELL } from "../ui";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";
import { boardMoveRows } from "../boardMoves";
import { usePulse } from "../usePulse";
import { type IssueEpic, type IssueFilterParams } from "../api";
import { ISSUE_PAGE_SIZE, issueSetKey, useIssueSet, useLoadMoreSentinel, useOnRevision, type IssueSetQuery } from "../issuePages";
import { DONE_WINDOW_DAYS } from "../boardFilters";

/**
 * Карточки одной колонки: собственный постраничный набор (первые
 * ISSUE_PAGE_SIZE, дальше — по прокрутке или кнопке), независимый от соседних.
 * Число в заголовке колонки берётся из счётчика сервера, а не из числа
 * загруженных карточек.
 */
export const ColumnCards = memo(function ColumnCards({
  projectId,
  filters,
  revision,
  renderCard,
  moves,
  doneStatus,
  onMovesApplied,
  onRowsReady,
}: {
  projectId: string;
  filters: IssueFilterParams;
  revision: string;
  renderCard: (issue: Issue) => React.ReactNode;
  moves: ReadonlyMap<string, string>;
  doneStatus: boolean;
  onMovesApplied: (ids: readonly string[]) => void;
  onRowsReady?: (ids: readonly string[], loading: boolean) => void;
}) {
  const { t } = useT();
  const { idx } = useStore();
  const query = useMemo<IssueSetQuery>(() => ({ projectId, filters, sort: "rank", dir: "asc" }), [projectId, filters]);
  const set = useIssueSet(query, { withCounts: false });
  useOnRevision(revision, set.revalidate);
  const rows = useMemo(() => boardMoveRows(set.items, idx.issues, filters.status!, moves, { overdueOnly: filters.overdue === "1", doneStatus, closed: filters.closed, closedDays: filters.closedDays }), [set.items, idx.issues, filters.status, filters.overdue, filters.closed, filters.closedDays, moves, doneStatus]);
  useEffect(() => {
    const applied: string[] = [];
    for (const [id, target] of moves) {
      const current = idx.issues.get(id);
      if (current && (current.statusId !== target || (target === filters.status && set.items.some(i => i.id === id && i.statusId === target && i.rank === current.rank)))) applied.push(id);
    }
    if (applied.length) onMovesApplied(applied);
  }, [moves, idx.issues, filters.status, set.items, onMovesApplied]);

  useLayoutEffect(() => { onRowsReady?.(rows.map(row => row.id), set.loading || set.error !== null); }, [rows, set.loading, set.error, onRowsReady]);

  // FLIP после коммита строк (ADR-0035, прототип): колонка и так перерисовывается при их смене — без нового состояния.
  useLayoutEffect(playBoardFlip, [rows]);

  const { hasMore, loading, loadingMore, loadMore } = set;
  const scope = issueSetKey(query);
  const reveal = useSkeletonReveal(scope, loading && rows.length === 0, rows.length > 0);
  const sentinelRef = useLoadMoreSentinel(loadMore, hasMore && !loading && !loadingMore, rows.length, "200px");
  // Reuse the existing scroll body: an extra flex wrapper changes content-visibility sizing.
  const mountSentinel = useCallback((node: HTMLDivElement | null) => {
    sentinelRef.current = node;
    // Контейнер ищем по разметке BoardColumn (data-skeleton-content="board"), а не по parentElement: обёртка вокруг sentinel его не собьёт.
    reveal.contentRef.current = node ? node.closest<HTMLDivElement>('[data-skeleton-content="board"]') : null;
  }, [sentinelRef, reveal.contentRef]);

  return (
    <>
      {loading && rows.length === 0 && (
        <div key={scope} onAnimationStart={reveal.onSkeletonAnimationStart} aria-busy="true" aria-label={t("common.loading")} className="skeleton-late space-y-2">
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
      <div ref={mountSentinel}>
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
export const NO_TARGETS: Status[] = [];
export const NO_SELECTION: ReadonlySet<string> = new Set();
export const NO_MOVES: ReadonlyMap<string, string> = new Map();
/** Панель массовых действий — отдельный чанк: нужна только в режиме выделения, первый экран доски без неё. */
export const BulkBar = lazy(() => import("./BulkBar"));

/**
 * Колонка доски — отдельный memo-компонент (ADR-0011): подписка на hoverStore обновляет
 * только прежнюю и новую колонку под курсором. Memo-список карточек не обходится заново
 * при смене подсветки; начало перетаскивания обновляет доступность переходов во всех колонках.
 */
export const BoardColumn = memo(function BoardColumn({
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
  onBeforeCreate,
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
  onBeforeCreate: () => object | null;
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
  const previousExpanded = useRef(showAllDone);
  const doneTailId = useId();
  const oldFilters = useMemo(() => ({ ...colFilters, closed: "older" as const }), [colFilters]);
  useLayoutEffect(() => { previousExpanded.current = showAllDone; }, [showAllDone]);
  const isOver = useExternalStore(hoverStore, (id) => id === st.id);
  const countRef = usePulse<HTMLSpanElement>(total, "any");
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
        noteLanding(id, e);
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
    <div
      className="board-lane min-h-0 min-w-0 snap-start"
      onDragOver={(e) => {
        if (!dragRef.current) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = ok ? "move" : "none";
        setOverCol(st.id);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOverCol(null);
      }}
      onDrop={(e) => {
        if (!dragRef.current) return;
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        setOverCol(null);
        setDragId(null);
        dragRef.current = null;
        if (id) {
          noteLanding(id, e);
          moveStatus(id, st.id, null);
        }
      }}
    >
    <section aria-label={workflowStatusName(st, t)} className={`board-col relative rounded-xl ${BOARD_COLUMN_SHELL}`}>
      {/* Заголовок внутри поверхности колонки и не прокручивается с карточками: глиф статуса, имя, число с сервера. */}
      <header className="board-col-header group/col flex shrink-0 items-center gap-2 px-1.5">
        <StatusGlyph category={st.category} position={statusPos} size={16} />
        <h2 className="min-w-0 truncate text-[15px] font-bold tracking-[-0.005em] text-ink">{workflowStatusName(st, t)}</h2>
        <span ref={countRef} className="tabular text-[13.5px] text-faint">{total ?? "…"}</span>
        {isDone && !showAllDone && <span className="board-done-window text-[13px] text-faint">{t("board.doneWindow", { days: DONE_WINDOW_DAYS })}</span>}
        {canCreate && isFirstTodo && (
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
        data-drop-state={isOver ? (ok ? "allowed" : "forbidden") : undefined}
        className="pointer-events-none board-col-highlight absolute inset-0 rounded-xl"
      />
      <div data-skeleton-content="board" className={`${BOARD_COLUMN_BODY} relative`}>
        {canCreate && isFirstTodo && quickOpen && <QuickCreate status={st} onDone={() => setQuickFor(null)} onBeforeSubmit={onBeforeCreate} />}
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
        {projectId && isDone && showAllDone && (
          <BoardDoneTail key={issueSetKey({ projectId, filters: oldFilters, sort: "rank", dir: "asc" })} id={doneTailId} animate={!previousExpanded.current}>
            {ready => <ColumnCards projectId={projectId} filters={oldFilters} revision={revision} renderCard={renderCard}
              moves={moves} doneStatus onMovesApplied={onMovesApplied} onRowsReady={ready} />}
          </BoardDoneTail>
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
        {/* The same control survives expansion so keyboard focus stays on the disclosure. */}
        {isDone && (hiddenDone > 0 || showAllDone) && (
          <button type="button" id={doneTailId + "-toggle"} data-done-disclosure aria-expanded={showAllDone} aria-controls={showAllDone ? doneTailId : undefined}
            onClick={() => setShowAllDone(!showAllDone)}
            className="ds-focus flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] text-faint transition-colors hover:bg-hover hover:text-ink">
            {showAllDone ? t("board.collapseDone", { days: DONE_WINDOW_DAYS }) : <><IcArchive size={14} />{t("board.hiddenDone", { n: hiddenDone })}</>}
          </button>
        )}
        {total === 0 && !quickOpen && hiddenDone === 0 && (
          <div className={`rounded-lg border border-dashed px-3 py-6 text-center text-[13px] transition-colors ${isOver ? (ok ? "border-accent text-accenttext" : "border-danger/60 text-danger") : "border-line text-faint"}`}>
            {isOver ? (ok ? t("board.dropReleaseOk") : t("board.dropForbidden")) : t("board.dropHere")}
          </div>
        )}
      </div>
      {isOver && !ok && (
        <p className="anim-pop pointer-events-none absolute inset-x-1.5 bottom-1.5 z-10 rounded-md bg-dangersoft px-2 py-1 text-center text-[13px] font-medium text-[var(--status-danger-fg)]">
          {t("board.transitionOutOfSchema", {
            from: draggedStatusId ? workflowStatusName(statusById.get(draggedStatusId) ?? { name: "" }, t) : "",
            to: workflowStatusName(st, t),
          })}
        </p>
      )}

    </section>
    </div>
  );
});
