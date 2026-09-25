import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import type { PermId } from "../permissions";
import { canTransition, fmtDate } from "../store/mappers";
import type { Issue, Status, User } from "../types";
import { DueRing, IcArchive, IcCheck, IcEye, IcInbox, IcMove, IcMyIssues, IcPlus, IcSearch, IcUsers, IcX, PriorityIcon, StatusGlyph, TypeIcon } from "../icons";
import { Avatar, AvatarStack, BOARD_COLUMN_BODY, BOARD_COLUMN_SHELL, SkeletonCard, DROPDOWN_OPEN_EVT, directionColor, labelTone } from "../ui";
import { useT, type TKey } from "../i18n";
import { workflowStatusName } from "../workflowStatus";
import { preloadIssueModal } from "../lazyModals";
import { issuesApi, type IssueEpic, type IssueFilterParams } from "../api";
import {
  ISSUE_PAGE_SIZE,
  NO_ISSUE_FILTERS,
  freshRows,
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
}) {
  const { t, lang } = useT();
  const assignees = useMemo(
    () => issue.assigneeIds.map((id) => usersById.get(id)).filter((u): u is User => !!u),
    [issue.assigneeIds, usersById],
  );
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const doneCat = status?.category === "done";
  const today = new Date().toISOString().slice(0, 10);
  const dueDays = issue.dueDate ? Math.round((Date.parse(issue.dueDate) - Date.parse(today)) / 864e5) : null;
  const overdue = !!issue.dueDate && !doneCat && issue.dueDate < today;

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

  // Перемещение без мыши. Кнопка видна при наведении и при фокусе с
  // клавиатуры, список — только разрешённые схемой переходы.
  const moveButton = draggable && (
    <span className="relative flex" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleMenu();
        }}
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-label={t("board.moveAria", { key: issue.key })}
        className={`flex h-5 w-5 items-center justify-center rounded-md text-faint transition-opacity hover:bg-hover hover:text-ink focus:opacity-100 group-hover:opacity-100 ${menu ? "opacity-100" : "opacity-0"}`}
      >
        <IcMove size={12} />
      </button>
      {menu && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="glass anim-pop absolute right-0 top-6 z-20 min-w-[190px] rounded-xl border border-line p-1 shadow-e3"
        >
          {moveTargets.length === 0 && <p className="px-2 py-1.5 text-[11.5px] text-faint">{t("board.noAllowedTransitions")}</p>}
          {moveTargets.map((target) => (
            <button
              key={target.id}
              role="menuitem"
              onClick={() => {
                setMenu(false);
                onMove(issue.id, target.id);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-hover/70"
            >
              <StatusGlyph category={target.category} size={13} />
              {target.name}
            </button>
          ))}
        </div>
      )}
    </span>
  );

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
      onClick={() => openIssue(issue.id)}
      className={`board-card group relative flex cursor-pointer flex-col gap-2 rounded-[10px] px-[11px] py-2.5 ${flash ? (doneCat ? "anim-drop-done" : "anim-drop") : ""}`}
    >
      {/* верх: глиф статуса, ключ, тип (кроме обычной задачи), справа — кнопка
          перемещения (при наведении/фокусе) и исполнители */}
      <div className="flex h-5 items-center gap-[7px] text-faint">
        {status && <StatusGlyph category={status.category} position={statusPos} size={14} />}
        <span className="font-mono text-[11.5px] font-medium tracking-[0.01em]">{issue.key}</span>
        {issue.typeId !== "task" && (
          <span title={t(`issueType.${issue.typeId}`)} className="flex">
            <TypeIcon type={issue.typeId} size={13} />
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {moveButton}
          <AvatarStack users={assignees} size={20} interactive />
        </span>
      </div>

      {/* заголовок, не больше двух строк */}
      <h4 className="line-clamp-2 text-[13.5px] font-semibold leading-[1.38] tracking-[-0.006em] text-ink">{issue.title}</h4>

      {/* мета: приоритет, направление, метки, срок, подзадачи — пилюли одной высоты */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="meta-pill is-icon" title={t(`priority.${issue.priorityId}`)}>
          <PriorityIcon p={issue.priorityId} size={14} />
        </span>
        {epic && (
          <span className="meta-pill min-w-0 max-w-[172px]" title={epic.title}>
            <i className="meta-dot" style={{ "--c": directionColor(epic.id, epic.color) } as React.CSSProperties} />
            <span>{epic.title}</span>
          </span>
        )}
        {issue.labels.slice(0, 2).map((l) => (
          <span key={l} className="meta-pill min-w-0 max-w-[120px]">
            <i className={`meta-dot tk-tone-${labelTone(l)}`} />
            <span>{l}</span>
          </span>
        ))}
        {issue.labels.length > 2 && <span className="meta-pill tabular">+{issue.labels.length - 2}</span>}
        {issue.dueDate && (
          <span className={`meta-pill tabular ${dueDays !== null && dueDays < 0 && !doneCat ? "is-late" : dueDays !== null && dueDays <= 3 && !doneCat ? "is-soon" : ""}`} title={overdue ? t("board.quickChip.overdue") : undefined}>
            <DueRing due={issue.dueDate} today={today} done={doneCat} />
            <span>{fmtDate(issue.dueDate, lang)}</span>
          </span>
        )}
        {issue.subtasksSummary && issue.subtasksSummary.total > 0 && (
          <span className="meta-pill tabular">
            <IcMyIssues size={13} />
            <span>
              {issue.subtasksSummary.done}/{issue.subtasksSummary.total}
            </span>
          </span>
        )}
      </div>
    </article>
  );
});

/**
 * Своё изображение перетаскиваемой карточки (ТЗ 5.13 п.3, ADR-0007 — нативный DnD):
 * копия карточки чуть под наклоном, с акцентной кромкой и тенью, а на исходном
 * месте — пунктирный силуэт (`data-dragging`). Атрибут и размеры пишутся через
 * DOM/CSSOM, не через состояние React: начало перетаскивания не перерисовывает
 * ни одной карточки (ADR-0011, шаг 0), а CSSOM разрешён CSP (ADR-0010).
 */
function setDragGhost(e: React.DragEvent<HTMLElement>) {
  const card = e.currentTarget;
  card.setAttribute("data-dragging", "");
  if (typeof e.dataTransfer.setDragImage !== "function") return;
  const rect = card.getBoundingClientRect();
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
    <div className="anim-fadeup rounded-lg border border-accent bg-panel p-2.5 shadow-focus">
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
        className="w-full resize-none bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint"
      />
      <div className="flex items-center gap-1.5">
        <button onClick={submit} className="btn-primary flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-medium">
          <IcCheck size={12} /> {t("board.addButton")}
        </button>
        <button onClick={onDone} className="flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink" aria-label={t("common.cancel")}>
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
  const rows = useMemo(() => freshRows(set.items, idx.issues), [set.items, idx.issues]);

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

/** Стабильный пустой список переходов (новый `[]` на каждый рендер ломал бы memo карточки). */
const NO_TARGETS: Status[] = [];

/**
 * Колонка доски — отдельный memo-компонент (ADR-0011, шаг 0): подсветка колонки под курсором
 * при перетаскивании (`overCol`) и начало перетаскивания меняют пропсы только затронутых
 * колонок, а карточки с неизменными пропсами не перерисовываются вовсе. Все пропсы —
 * примитивы, стабильные справочники (`Map` из `useMemo`) или стабильные колбэки.
 */
const BoardColumn = memo(function BoardColumn({
  st,
  total,
  hiddenDone,
  colFilters,
  isOver,
  ok,
  draggedStatusId,
  isDone,
  isDoneStatus,
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
}: {
  st: Status;
  total: number | null;
  hiddenDone: number;
  colFilters: IssueFilterParams;
  isOver: boolean;
  ok: boolean;
  /** Статус перетаскиваемой задачи — только колонке под курсором (текст «переход вне схемы»). */
  draggedStatusId: string | null;
  isDone: boolean;
  isDoneStatus: boolean;
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
}) {
  const { t } = useT();
  const statusPos = posById.get(st.id) ?? 0.5;
  const onOver = useCallback(() => setOverCol(st.id), [setOverCol, st.id]);
  const onDropOn = useCallback(
    (e: React.DragEvent, target: Issue) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.dataTransfer.getData("text/plain");
      setOverCol(null);
      setDragId(null);
      if (id && id !== target.id) moveStatus(id, st.id, target.id);
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
      />
    ),
    [usersById, epicsById, statusById, posById, targetsByStatus, onOpen, onMove, lastEvent, onCardDragStart, onCardDragEnd, onDropOn, onOver, can],
  );
  return (
    <section
      aria-label={workflowStatusName(st, t)}
      className={`snap-start ${BOARD_COLUMN_SHELL}`}
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
      {/* Заголовок над жёлобом: глиф статуса (заполнен по месту в процессе), имя, число. */}
      <header className="group/col flex h-[34px] shrink-0 items-center gap-2 pl-2 pr-1.5">
        <StatusGlyph category={st.category} position={statusPos} size={14} />
        <h3 className="text-[13px] font-semibold tracking-[-0.005em] text-ink">{workflowStatusName(st, t)}</h3>
        <span className="tabular text-[12.5px] text-faint">{total ?? "…"}</span>
        {canCreate && isFirstTodo && (
          <button
            onClick={() => setQuickFor(st.id)}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
            aria-label={t("board.addToStatusAria", { name: workflowStatusName(st, t) })}
          >
            <IcPlus size={14} />
          </button>
        )}
      </header>

      <div
        className={`${BOARD_COLUMN_BODY} transition-[box-shadow,background-color] duration-150 ${isOver ? (ok ? "!bg-accentsoft/60 !shadow-[inset_0_0_0_1px_var(--accent-muted)]" : "!bg-dangersoft/60 !shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--status-danger)_40%,transparent)]") : ""}`}
      >
        {quickOpen && <QuickCreate status={st} onDone={() => setQuickFor(null)} />}
        {projectId && (
          <ColumnCards
            projectId={projectId}
            filters={colFilters}
            revision={revision}
            renderCard={renderCard}
          />
        )}
        {canCreate && isFirstTodo && !quickOpen && total !== 0 && (
          <button
            onClick={() => setQuickFor(st.id)}
            className="flex h-[30px] shrink-0 items-center gap-[7px] rounded-lg px-2 text-[12.5px] text-faint transition-colors hover:bg-hover hover:text-ink"
          >
            <IcPlus size={13} />
            {t("board.addCard")}
          </button>
        )}
        {/* Свёрнутый «хвост» закрытого: данные на месте, в один клик. */}
        {hiddenDone > 0 && (
          <button
            onClick={() => setShowAllDone(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-faint transition-colors hover:bg-hover hover:text-ink"
          >
            <IcArchive size={12} />
            {t("board.hiddenDone", { n: hiddenDone })}
          </button>
        )}
        {showAllDone && isDone && (
          <button
            onClick={() => setShowAllDone(false)}
            className="w-full rounded-lg px-3 py-1.5 text-[12px] text-faint transition-colors hover:bg-hover hover:text-ink"
          >
            {t("board.collapseDone", { days: DONE_WINDOW_DAYS })}
          </button>
        )}
        {total === 0 && !quickOpen && hiddenDone === 0 && (
          <div className={`rounded-lg border border-dashed px-3 py-6 text-center text-[12px] transition-colors ${isOver ? (ok ? "border-accent text-accenttext" : "border-danger/60 text-danger") : "border-line text-faint"}`}>
            {isOver ? (ok ? t("board.dropReleaseOk") : t("board.dropForbidden")) : t("board.dropHere")}
          </div>
        )}
        {isOver && !ok && (
          <p className="rounded-md bg-dangersoft px-2 py-1 text-center text-[11.5px] font-medium text-[var(--status-danger-fg)]">
            {t("board.transitionOutOfSchema", {
              from: draggedStatusId ? workflowStatusName(statusById.get(draggedStatusId) ?? { name: "" }, t) : "",
              to: workflowStatusName(st, t),
            })}
          </p>
        )}
      </div>

      {isDoneStatus && total !== null && total > 0 && (
        <p className="mt-1 flex items-center gap-1.5 px-2 pb-0.5 text-[12px] text-faint">
          <IcInbox size={13} /> {t("board.closedCount", { n: total })}
        </p>
      )}
    </section>
  );
});

export default function Board() {
  const { t, tn } = useT();
  const { data, ui, moveStatus, openIssue, can, epicsRevision } = useStore();
  const canMove = can("transition");
  const canCreate = can("create");
  const [dragId, setDragId] = useState<string | null>(null);
  // Перетаскиваемую задачу берём из самой карточки, а не ищем по id в сторе: стор больше не
  // держит все задачи, и «нет в сторе» молча отключило бы проверку допустимости перехода
  // (canDropTo) — все колонки выглядели бы допустимыми.
  const [dragIssue, setDragIssue] = useState<Issue | null>(null);
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
  const epics = useEpics(projectId, epicsRevision);
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
  const onMove = useCallback((id: string, to: string) => moveStatus(id, to, null), [moveStatus]);
  const onCardDragStart = useCallback((i: Issue) => {
    setDragId(i.id);
    setDragIssue(i);
    dragRef.current = i.id;
  }, []);
  const onCardDragEnd = useCallback(() => {
    setDragId(null);
    setOverCol(null);
    dragRef.current = null;
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* шапка */}
      <div className="px-4 pb-3 pt-5 sm:px-6">
       <div className="flex flex-wrap items-center gap-3">
        <div className="mr-2">
          <h1 className="font-disp text-[20px] font-semibold tracking-[-0.02em] text-ink">{t("board.title")}</h1>
          <p className="mt-0.5 flex items-center gap-2 text-[12.5px] text-faint">
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
                className={`rounded-full transition-[transform,opacity] duration-150 ${filterUser === u.id ? "z-10 ring-2 ring-accent ring-offset-2 ring-offset-[var(--bg-canvas)]" : "hover:z-10 hover:-translate-y-0.5"} ${filterUser && filterUser !== u.id ? "opacity-40" : ""}`}
              >
                <Avatar user={u} size={26} ring />
              </button>
            ))}
            <button
              onClick={() => setFilterUser(filterUser === "none" ? null : "none")}
              title={t("board.unassignedFilter")}
              className={`rounded-full transition-[transform,opacity] duration-150 ${filterUser === "none" ? "z-10 ring-2 ring-accent ring-offset-2 ring-offset-[var(--bg-canvas)]" : "hover:z-10 hover:-translate-y-0.5"} ${filterUser && filterUser !== "none" ? "opacity-40" : ""}`}
            >
              <Avatar user={null} size={26} ring />
            </button>
          </div>
          <div className="flex h-8 items-center gap-2 rounded-lg border border-linesoft bg-sunken px-2.5 transition-colors focus-within:border-accent focus-within:bg-panel focus-within:shadow-focus hover:border-line">
            <IcSearch size={14} className="text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("board.searchPlaceholder")} className="w-36 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint" />
            {q && (
              <button onClick={() => setQ("")} className="text-faint hover:text-ink" aria-label={t("common.reset")}>
                <IcX size={12} />
              </button>
            )}
          </div>
        </div>
       </div>

       {/* быстрые фильтры-чипы (round4 §3.3) */}
       <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
         {QUICK_CHIPS.map((c) => {
           const on = chips.has(c.id);
           return (
             <button
               key={c.id}
               onClick={() => toggleChip(c.id)}
               aria-pressed={on}
               className={`flex h-[26px] items-center gap-1.5 rounded-[7px] px-[9px] text-[12.5px] font-medium transition-colors duration-150 ${
                 on ? "bg-accentsoft text-accenttext ring-1 ring-inset ring-accentmuted" : "text-sub ring-1 ring-inset ring-line hover:bg-hover hover:text-ink"
               }`}
             >
               {c.id === "mine" ? (
                 <IcMyIssues size={14} tone={on ? undefined : "violet"} />
               ) : c.id === "overdue" ? (
                 <DueRing due="2000-01-01" today="2000-01-02" size={14} />
               ) : (
                 <IcUsers size={14} tone={on ? undefined : "gray"} />
               )}
               {t(c.labelKey)}
               {on && <IcX size={11} className="-mr-0.5 opacity-60" />}
             </button>
           );
         })}
         {chips.size > 0 && (
           <button
             onClick={() => setChips(new Set())}
             className="flex h-7 items-center gap-1 rounded-lg px-2 text-[12.5px] text-faint hover:text-ink"
           >
             <IcX size={11} /> {t("common.reset")}
           </button>
         )}
         <span className="ml-auto text-[12px] tabular text-faint">{t("board.filteredOf", { visible: filtered.counts?.total ?? "…", total: poolTotal ?? "…" })}</span>
       </div>
      </div>

      {!canMove && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-warnsoft px-3 py-1.5 text-[12.5px] text-[var(--status-progress-fg)] sm:mx-6">
          <IcEye size={14} className="shrink-0" />
          <span className="truncate">{t("board.readOnlyBanner")}</span>
        </div>
      )}

      {allClear && (
        <div className="mx-4 mb-2 rounded-lg bg-oksoft px-4 py-3 sm:mx-6">
          <p className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--status-done-fg)]">
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
      <div className="flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden md:snap-none">
        <div className="flex h-full w-max items-start gap-3 px-4 pb-4 pt-1 sm:px-6">
          {data.workflow.statuses.map((st) => {
            const isOver = overCol === st.id;
            return (
              <BoardColumn
                key={st.id}
                st={st}
                total={totalOf(st.id)}
                hiddenDone={hiddenDone(st.id)}
                colFilters={colFiltersById.get(st.id) ?? NO_ISSUE_FILTERS}
                isOver={isOver}
                ok={canDropTo(st.id)}
                draggedStatusId={isOver && dragged ? dragged.statusId : null}
                isDone={doneIds.has(st.id)}
                isDoneStatus={st.id === doneStatusId}
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
                moveStatus={moveStatus}
                onOpen={openIssue}
                onMove={onMove}
                onCardDragStart={onCardDragStart}
                onCardDragEnd={onCardDragEnd}
                setOverCol={setOverCol}
                setDragId={setDragId}
                dragRef={dragRef}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
