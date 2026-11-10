import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cssVars } from "../cssVars";
import { preloadMotionIdle } from "../motion";
import { cancelBoardFlip, clearBoardFlip, createPendingMarks, restoreCardFocus, snapshotBoard } from "../boardFlip";
import { useLocation } from "wouter";
import { EMPTY_FILTERS, customFieldCondition, filtersFromSearch, searchFromFilters, projectIssueSearch, pathForView } from "../router";
import { IssueFilterSummary } from "./IssueFilterSummary";
import { WorkspaceControls, WorkspaceSearch, WorkspaceQuickFilters } from "./WorkspaceControls";
import { BoardAssigneeFilter } from "./ProjectMembers";
import { Hint } from "./Hint";
import { useStore } from "../store";
import { usePersonalBoardPhoto } from "../personalBoardPhoto";
import BoardBackgroundControl from "./BoardBackgroundControl";
import { createExternalStore } from "../store/external";
import { canTransition } from "../store/mappers";
import type { Issue, User } from "../types";
import { IcBoard, IcCheck, IcEye } from "../icons";
import { BoardFilterSummary } from "./BoardFilterSummary";
import { Button } from "../ds/Button";
import { EmptyState } from "../ds/Display";
import { useT } from "../i18n";
import { issuesApi, type IssueFilterParams } from "../api";
import { NO_ISSUE_FILTERS, useDebounced, useEpics, useIssueCounts, useIssuesRevision } from "../issuePages";
import { DONE_WINDOW_DAYS, boardFilterParams, columnFilterParams, columnTotal, hasBoardFilters, hiddenDoneCount, openTotal, type QuickChip } from "../boardFilters";
import { NO_SELECTION, NO_MOVES, BulkBar, BoardColumn } from "./BoardColumn";

/** Поиск уходит на сервер не на каждую букву; пустой — сразу. */
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MAX = 120; // = LIMITS сервера для q
const isEmptyText = (v: string) => v === "";

// Быстрые фильтры-чипы над доской (round4 §3.3). Фильтры серверные
// (`boardFilters.ts`): окно «Готово» (DONE_WINDOW_DAYS) — там же; закрытое
// дальше окна прячется за строку «Ранее закрыто», а через ARCHIVE_AFTER_DAYS
// (настройка сервера) уходит в архив и перестаёт грузиться вовсе.


export default function Board() {
  const { t, tn } = useT();
  const { data, ui, moveStatus, openIssue, can, epicsRevision, setCreateOpen } = useStore();
  const boardRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const setInput = (value: "keyboard" | "pointer") => boardRoot.current?.setAttribute("data-board-input", value);
    const keyboard = (event: KeyboardEvent) => { if (!event.metaKey && !event.ctrlKey && !event.altKey) setInput("keyboard"); };
    const pointer = () => setInput("pointer");
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("pointerdown", pointer, true);
    return () => { document.removeEventListener("keydown", keyboard, true); document.removeEventListener("pointerdown", pointer, true); };
  }, []);
  // Чанк пружин (ADR-0035) — на простое после первого экрана доски, чтобы первый перенос уже был пружиной.
  useEffect(() => preloadMotionIdle(), []);
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
  const [filterSummaryOpen, setFilterSummaryOpen] = useState(false);
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
  useEffect(() => { if (!filtersOn) setFilterSummaryOpen(false); }, [filtersOn]);
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
  // Отмена цепочки возврата фокуса (FIX-12): при размонтировании доски и перед следующим переносом.
  const restoreFocusCancel = useRef<(() => void) | null>(null);
  const boardMounted = useRef(true); // ответ на перенос может прийти уже после ухода с доски — новую цепочку не запускаем
  // NEW-02: отметка «перенос отправлен» на карточке до ответа сервера; по одной на задачу.
  const pendingMarks = useRef(createPendingMarks(() => boardRoot.current));
  useEffect(() => {
    boardMounted.current = true;
    const marks = pendingMarks.current;
    const root = boardRoot.current;
    return () => {
      boardMounted.current = false;
      restoreFocusCancel.current?.();
      marks.clearAll();
      clearBoardFlip(root);
    };
  }, []);
  // Массовое действие закончено: панель выделения исчезает вместе с кнопкой, державшей фокус (B-04) — возвращаем его на
  // первую карточку выделения, если он потерян. Фокус, ушедший осознанно в другое место, `restoreCardFocus` не трогает.
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  // Фокус возвращаем на первую ВЫБРАННУЮ карточку (порядок вставки), а не на первую в доске: после смены статуса она может
  // оказаться в другой колонке. Удалённой карточки нет — остаётся запасной фокус по таймауту restoreCardFocus.
  const finishBulk = useCallback((cardLeaves?: boolean) => {
    const id = selectedRef.current.values().next().value;
    clearSelection();
    if (id === undefined || !boardMounted.current) return;
    restoreFocusCancel.current?.();
    // Смена статуса пересаживает карточку в другую колонку — ждём НОВУЮ кнопку (stale = нынешняя), иначе фокус встанет на
    // уходящую и пропадёт. Если карточка не пересаживалась (другое действие), после ожидания берём ту же кнопку.
    const sel = `article[data-issue-id="${CSS.escape(id)}"] .board-card-open`;
    const stale = boardRoot.current?.querySelector<HTMLElement>(sel) ?? null;
    let quick = 0;
    const handle = () => { window.clearTimeout(quick); cancel(); };
    const cancel = restoreCardFocus(boardRoot.current, id, null, stale, () => {
      if (restoreFocusCancel.current === handle) restoreFocusCancel.current = null;
      const active = document.activeElement;
      if (!boardMounted.current || (active && active !== document.body && active !== stale)) return;
      // Карточки нет (массовое удаление) — фокус на первую оставшуюся, чтобы не оставлять его на body.
      (boardRoot.current?.querySelector<HTMLElement>(sel) ?? boardRoot.current?.querySelector<HTMLElement>(".board-card-open"))?.focus({ preventScroll: true });
    });
    restoreFocusCancel.current = handle;
    if (cardLeaves) return; // смена статуса пересаживает карточку, удаление её убирает — старую кнопку не трогаем
    // Действие без пересадки (назначение, приоритет, «Очистить»): панель уходит, фокус падает на body — вернём на ту же
    // кнопку сразу, не дожидаясь исчерпания повторов. Таймер отменяется тем же handle, что и цепочка повторов.
    quick = window.setTimeout(() => {
      const active = document.activeElement;
      // Выход из режима выделения мог перерисовать кнопку — ищем заново, как в повторах.
      const target = stale?.isConnected ? stale : boardRoot.current?.querySelector<HTMLElement>(sel);
      if (boardMounted.current && target && (!active || active === document.body)) target.focus({ preventScroll: true });
    }, 0);
  }, [clearSelection]);
  const moveOnBoard = useCallback((id: string, to: string, before?: string | null) => {
    if (!canMove) return;
    const flip = snapshotBoard(boardRoot.current, id);
    // Перенос с клавиатуры или из меню карточки: фокус стоял внутри неё — вернём на новую после переезда (FIX-12).
    const focused = document.activeElement;
    const cardSel = `article[data-issue-id="${CSS.escape(id)}"]`;
    const menu = focused?.closest("[popover]");
    // Фокус внутри самой карточки или в её собственном меню переноса (кнопка карточки управляет этим всплывающим окном).
    const keepFocus = !!focused && (!!focused.closest(cardSel) || (!!menu?.id && !!boardRoot.current?.querySelector(`${cardSel} [aria-controls="${CSS.escape(menu.id)}"]`)));
    // Кнопка карточки ДО переноса: после ответа сервера карточка может быть уже отрисована в новой колонке.
    const staleBtn = keepFocus ? boardRoot.current?.querySelector<HTMLElement>(`${cardSel} .board-card-open`) ?? null : null;
    restoreFocusCancel.current?.();
    restoreFocusCancel.current = null;
    const request = Symbol();
    moveRequests.current.set(id, request);
    const endPending = pendingMarks.current.start(id);
    moveStatus(id, to, before, confirmed => {
      endPending();
      if (moveRequests.current.get(id) !== request) return;
      moveRequests.current.delete(id);
      if (moveQueryRef.current !== moveQueryKey) return;
      // Возврат фокуса и при отказе сервера: карточка могла быть заменена (откат), а пункт меню, державший фокус, исчез.
      const startFocus = () => {
        if (!keepFocus || !boardMounted.current) return;
        const cancel = restoreCardFocus(boardRoot.current, id, focused, staleBtn, () => { if (restoreFocusCancel.current === cancel) restoreFocusCancel.current = null; });
        restoreFocusCancel.current = cancel;
      };
      if (!confirmed) { cancelBoardFlip(flip); onMovesApplied([id]); startFocus(); return; }
      startFocus();
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
    () => (hasDoneColumn ? { ...baseFilters, closed: "older" as const, closedDays: DONE_WINDOW_DAYS } : null),
    [hasDoneColumn, baseFilters],
  );
  const older = useIssueCounts(projectId, olderFilters, revision);
  const projectCounts = filtersOn ? unfiltered.counts : filtered.counts;

  /** Задачи колонки: их получает `ColumnCards`. «Готово» по умолчанию — только
   *  закрытое за DONE_WINDOW_DAYS (аудит LIFE-02); остальное — в один клик по
   *  строке «Ранее закрыто». Задачи без doneAt (закрытые до миграции 016)
   *  считаются свежими, чтобы они не пропали из виду молча. */
  const totalOf = (sid: string) => columnTotal(filtered.counts, older.counts, sid, { isDone: doneIds.has(sid), showAllDone });
  // Keep the older count alive while open; the disclosure must not disappear during a counts refetch.
  const hiddenDone = (sid: string) => hiddenDoneCount(older.counts, sid, { isDone: doneIds.has(sid), showAllDone: false });
  // Фильтры колонок — по объекту на статус, стабильные между рендерами доски (иначе каждая
  // колонка получала бы новый объект и перерисовывалась вместе с любым состоянием доски).
  const colFiltersById = useMemo(
    () =>
      new Map(
        data.workflow.statuses.map((st) => [st.id, columnFilterParams(baseFilters, st.id, { isDone: doneIds.has(st.id), showAllDone: false })]),
      ),
    [data.workflow.statuses, baseFilters, doneIds],
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
  // Сводка должна совпадать с бейджами колонок; NaN сохраняет состояние загрузки любого счётчика.
  const visibleTotal = data.workflow.statuses.reduce((sum, status) => sum + (totalOf(status.id) ?? NaN), 0);
  const filteredSummary = t("board.filteredOf", { visible: Number.isNaN(visibleTotal) ? "…" : visibleTotal, total: poolTotal ?? "…" });
  const filterLabel = t("workspace.filters");

  // Колбэки карточек стабильны: задачу они получают аргументом (ADR-0011, шаг 0).
  const onMove = useCallback((id: string, to: string) => moveOnBoard(id, to, null), [moveOnBoard]);
  const onBeforeCreate = useCallback(() => snapshotBoard(boardRoot.current, null), []);
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
    <div ref={boardRoot} className="board-view relative flex h-full min-w-0 flex-col" data-selecting={selectMode || undefined}>
      <h1 className="sr-only">{t("board.title")} · {data.project.name}</h1>
      {/* шапка */}
      <div className="workspace-view-header px-4 pb-3 pt-3.5 sm:px-[18px]">
        <WorkspaceControls selectionMode={selectMode}
          members={<BoardAssigneeFilter selectedUserId={filterUser} extraUsers={assignees}
            onSelectUser={userId => setFilterUser(current => current === userId ? null : userId)} />}
          compact
          summary={filtersOn ? <BoardFilterSummary label={filterLabel} summary={filteredSummary} open={filterSummaryOpen} onOpenChange={setFilterSummaryOpen}>
            <IssueFilterSummary filters={baseFilters}>
              {chips.has("overdue") && <span>{t("board.quickChip.overdue")}</span>}
              <button onClick={resetFilters} className="ds-focus rounded px-2 py-1 font-medium hover:text-ink">{t("common.reset")}</button>
            </IssueFilterSummary>
          </BoardFilterSummary> : filteredSummary}
          quickFilters={<WorkspaceQuickFilters active={id => id === "overdue" ? chips.has(id) : baseFilters.assignee === (id === "mine" ? data.currentUserId : "none")} onToggle={toggleChip} overdue={overdueCounts.counts?.total} />}
          search={<WorkspaceSearch value={q} onChange={setQ} />}
          actions={<>
            <BoardBackgroundControl key={`${data.currentUserId}:${data.currentProjectId}`} userId={data.currentUserId} projectId={data.currentProjectId} hasPhoto={!!personalPhoto} />
            <Button size="sm" aria-pressed={selectMode} onClick={() => setSelectMode(v => !v)}
              className={selectMode ? "border-accent text-accenttext" : undefined} iconLeft={<IcCheck size={14} />}>
              {t("backlog.selectMode")}
            </Button>
          </>}
        />
        {canMove && <Hint id="board-move" className="board-move-touch-hint mt-2">{t("hint.boardMoveTouch")}</Hint>}
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
                onBeforeCreate={onBeforeCreate}
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
      {selectMode && !selectedIds.size && <Hint id="board-select" className="board-select-hint absolute inset-x-4 bottom-4 z-20 mx-auto w-fit">{t("board.selectHint")}</Hint>}
      {selectMode && selectedIds.size > 0 && (
        <Suspense fallback={null}>
          <BulkBar floating selectedIds={selectedIds} onDone={finishBulk} onBeforeStatus={onBeforeCreate} />
        </Suspense>
      )}
    </div>
  );
}
