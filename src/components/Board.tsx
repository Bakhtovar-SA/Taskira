import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { canTransition, fmtDate, useStore } from "../store";
import type { Issue, Status, User } from "../types";
import { IcArchive, IcCalendar, IcCheck, IcEye, IcInbox, IcMove, IcPlus, IcSearch, IcX, PRIORITY_COLOR, PriorityIcon, TypeIcon } from "../icons";
import { Avatar, BOARD_COLUMN_SHELL, Chip, catColor, DROPDOWN_OPEN_EVT } from "../ui";
import { useT, type TKey } from "../i18n";

const todayStr = () => new Date().toISOString().slice(0, 10);

/** Сколько дней закрытая задача остаётся видимой в колонке «Готово».
 *  Дальше она прячется за строку «Ранее закрыто», а через ARCHIVE_AFTER_DAYS
 *  (настройка сервера) уходит в архив и перестаёт грузиться вовсе. */
const DONE_WINDOW_DAYS = 14;

// Быстрые фильтры-чипы над доской (round4 §3.3) — клиентская фильтрация
// поверх уже загруженных задач, комбинируется с текстовым фильтром.
type QuickChip = "mine" | "overdue" | "unassigned";
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
  assignee,
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
  assignee: User | undefined;
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
  const { t } = useT();
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
    const onOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener(DROPDOWN_OPEN_EVT, onOtherOpen);
    document.addEventListener("mousedown", onOutside);
    return () => {
      window.removeEventListener(DROPDOWN_OPEN_EVT, onOtherOpen);
      document.removeEventListener("mousedown", onOutside);
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
              {fmtDate(issue.dueDate)}
            </span>
          )}
          <Avatar user={assignee ?? null} size={22} />
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
              {moveTargets.map((t) => (
                <button
                  key={t.id}
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    onMove(issue.id, t.id);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-canvas"
                >
                  <span className="h-1.5 w-1.5 rounded-sm" style={{ background: catColor(t.category).dot }} />
                  {t.name}
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
      assigneeId: null,
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
        placeholder={t("board.quickCreatePlaceholder", { status: status.name })}
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

  const pool = data.issues;

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    const td = todayStr();
    return pool.filter((i) => {
      if (filterUser === "none" ? i.assigneeId !== null : filterUser ? i.assigneeId !== filterUser : false) return false;
      if (s && !i.title.toLowerCase().includes(s) && !i.key.toLowerCase().includes(s)) return false;
      if (chips.has("mine") && i.assigneeId !== data.currentUserId) return false;
      if (chips.has("unassigned") && i.assigneeId !== null) return false;
      if (chips.has("overdue") && !(i.dueDate && !doneIds.has(i.statusId) && i.dueDate < td)) return false;
      return true;
    });
  }, [pool, filterUser, q, chips, data.currentUserId, doneIds]);

  /** Задачи колонки.
   *
   *  Колонка «Готово» по умолчанию показывает только закрытое за последние
   *  DONE_WINDOW_DAYS дней (аудит LIFE-02). Раньше закрытые копились там вечно,
   *  и через год колонка превращалась в место, куда никто не смотрит. Это не
   *  сокрытие данных: остальное — в один клик по строке «Ранее закрыто».
   *  Задачи без doneAt (закрытые до миграции 016) считаем свежими, чтобы
   *  они не пропали из виду молча. */
  const doneCutoff = Date.now() - DONE_WINDOW_DAYS * 86_400_000;
  const isRecentDone = (i: Issue) => i.doneAt === null || i.doneAt >= doneCutoff;

  const byStatus = (sid: string) => {
    const all = visible.filter((i) => i.statusId === sid);
    if (!doneIds.has(sid) || showAllDone) return all;
    return all.filter(isRecentDone);
  };
  /** Сколько закрытого в колонке спрятано окном (для строки «Ранее закрыто»). */
  const hiddenDone = (sid: string) =>
    doneIds.has(sid) && !showAllDone ? visible.filter((i) => i.statusId === sid && !isRecentDone(i)).length : 0;
  const assignees = useMemo(() => {
    const ids = new Set(pool.map((i) => i.assigneeId).filter(Boolean) as string[]);
    return data.users.filter((u) => ids.has(u.id));
  }, [pool, data.users]);

  const dragged = dragId ? (issuesById.get(dragId) ?? null) : null;

  /** Проект, где не осталось ни одной незакрытой задачи (аудит LIFE-04).
   *  Для отдела, работающего волнами, это нормальное и частое состояние, а не
   *  крайний случай, — и показывать его надо как достижение, а не как пустой
   *  экран с надписью «перетащите задачи сюда». */
  const openCount = pool.filter((i) => !doneIds.has(i.statusId)).length;
  const closedRecently = pool.filter(
    (i) => doneIds.has(i.statusId) && i.doneAt !== null && i.doneAt >= Date.now() - 30 * 86_400_000,
  ).length;
  const allClear = pool.length > 0 && openCount === 0;
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
            <span>{pool.length} {tn(pool.length, "noun.issue.one", "noun.issue.few", "noun.issue.many")}</span>
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
         <span className="ml-auto text-[11.5px] text-faint">{t("board.filteredOf", { visible: visible.length, total: pool.length })}</span>
       </div>
      </div>

      {!canMove && (
        <div className="flex items-center gap-2 border-b border-line bg-warnsoft/60 px-6 py-1.5 text-[12px] font-medium text-warn">
          <IcEye size={14} className="shrink-0" />
          <span className="truncate">{t("board.readOnlyBanner")}</span>
        </div>
      )}

      {/* Честная плашка об усечении: сервер вернул total больше, чем влезло
          в одну страницу. Раньше клиент молча показывал первые N задач, и экран
          выглядел непротиворечиво, но был неверным (аудит BLOCK-01). */}
      {data.issuesTruncated && (
        <div className="flex items-center gap-2 border-b border-line bg-warnsoft/60 px-6 py-1.5 text-[12px] font-medium text-warn">
          <IcEye size={14} className="shrink-0" />
          <span className="truncate">{t("board.truncatedBanner", { shown: pool.length, total: data.issuesTotal })}</span>
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
            const items = byStatus(st.id);
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
                  <h3 className="text-[12px] font-bold uppercase tracking-wider text-sub">{st.name}</h3>
                  <span className="rounded-full bg-todosoft px-1.5 font-mono text-[10.5px] font-bold text-sub">{items.length}</span>
                  {canCreate && st.id === firstTodoId && (
                    <button
                      onClick={() => setQuickFor(st.id)}
                      className="ml-auto flex h-6 w-6 items-center justify-center rounded text-faint transition-colors hover:bg-todosoft hover:text-ink"
                      aria-label={t("board.addToStatusAria", { name: st.name })}
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
                  {items.map((i) => (
                    <Card
                      key={i.id}
                      issue={i}
                      assignee={i.assigneeId ? usersById.get(i.assigneeId) : undefined}
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
                      draggable={canMove}
                    />
                  ))}
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
                  {items.length === 0 && quickFor !== st.id && hiddenDone(st.id) === 0 && (
                    <div className={`rounded-lg border border-dashed px-3 py-6 text-center text-[11.5px] transition-colors ${isOver ? "border-accent text-accent" : "border-line2 text-faint"}`}>
                      {isOver ? (ok ? t("board.dropReleaseOk") : t("board.dropForbidden")) : t("board.dropHere")}
                    </div>
                  )}
                  {isOver && !ok && (
                    <p className="rounded bg-dangersoft px-2 py-1 text-center text-[11px] font-semibold text-danger">
                      {t("board.transitionOutOfSchema", {
                        from: dragged ? data.workflow.statuses.find((s) => s.id === dragged.statusId)?.name ?? "" : "",
                        to: st.name,
                      })}
                    </p>
                  )}
                </div>

                {st.id === doneStatusId && items.length > 0 && (
                  <p className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-ok">
                    <IcInbox size={13} /> {t("board.closedCount", { n: items.length })}
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
