import { useCallback, useMemo, useRef, useState } from "react";
import { canTransition, fmtDate, useStore } from "../store";
import type { Issue, Status } from "../types";
import { PRIORITIES } from "../types";
import { IcCalendar, IcCheck, IcEye, IcInbox, IcPlus, IcSearch, IcX, PRIORITY_COLOR, PriorityIcon, TypeIcon } from "../icons";
import { Avatar, BOARD_COLUMN_SHELL, Chip, catColor } from "../ui";

const todayStr = () => new Date().toISOString().slice(0, 10);

// Быстрые фильтры-чипы над доской (round4 §3.3) — клиентская фильтрация
// поверх уже загруженных задач, комбинируется с текстовым фильтром.
type QuickChip = "mine" | "overdue" | "unassigned";
const QUICK_CHIPS: { id: QuickChip; label: string }[] = [
  { id: "mine", label: "Мои задачи" },
  { id: "overdue", label: "Просрочено" },
  { id: "unassigned", label: "Без исполнителя" },
];

/** Плавность отпускания карточки — тот же экспоненциальный ease-out, что и
 *  dropLand/View Transitions, без переброса (overdrive: физика без отскока). */
const SETTLE = "cubic-bezier(0.16, 1, 0.3, 1)";
const SETTLE_MS = 180;

function Card({
  issue,
  flash,
  draggable,
  hidden,
  onGrabStart,
  onGrabMove,
  onGrabEnd,
  onOpen,
}: {
  issue: Issue;
  flash: boolean;
  draggable: boolean;
  hidden?: boolean;
  onGrabStart?: (e: React.PointerEvent, issue: Issue) => void;
  onGrabMove?: (e: React.PointerEvent) => void;
  onGrabEnd?: (e: React.PointerEvent) => void;
  onOpen: () => void;
}) {
  const { data, ui } = useStore();
  const assignee = data.users.find((u) => u.id === issue.assigneeId);
  const epic = data.issues.find((i) => i.id === issue.epicId);
  const doneCat = data.workflow.statuses.find((s) => s.id === issue.statusId)?.category === "done";
  const overdue = !!issue.dueDate && !doneCat && issue.dueDate < new Date().toISOString().slice(0, 10);
  // Пока карточка открыта в модалке, имя переходит панели модалки (Modal
  // viewTransitionName) — у обеих не может быть одно имя одновременно.
  const viewTransitionName = ui.selectedIssueId === issue.id ? undefined : `card-${issue.id}`;

  return (
    <article
      data-card-id={issue.id}
      onPointerDown={draggable ? (e) => onGrabStart?.(e, issue) : undefined}
      onPointerMove={draggable ? onGrabMove : undefined}
      onPointerUp={draggable ? onGrabEnd : undefined}
      onPointerCancel={draggable ? onGrabEnd : undefined}
      onClick={onOpen}
      style={{ viewTransitionName, visibility: hidden ? "hidden" : undefined, touchAction: draggable ? "none" : undefined }}
      className={`group relative cursor-grab overflow-hidden rounded-lg border border-line bg-panel p-2.5 pt-3 shadow-[0_1px_2px_rgba(20,35,64,0.06)] transition-all duration-150 hover:-translate-y-px hover:border-line2 hover:shadow-[0_6px_18px_rgba(20,35,64,0.12)] active:cursor-grabbing ${flash ? (doneCat ? "anim-drop-done" : "anim-drop") : ""}`}
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
          {PRIORITIES[issue.priorityId].name}
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
    </article>
  );
}

function QuickCreate({ status, onDone }: { status: Status; onDone: () => void }) {
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
      points: null,
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
        placeholder={`Задача в «${status.name}»…`}
        rows={2}
        className="w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-faint"
      />
      <div className="flex items-center gap-1.5">
        <button onClick={submit} className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-accentdeep">
          <IcCheck size={12} /> Добавить
        </button>
        <button onClick={onDone} className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-canvas hover:text-ink" aria-label="Отмена">
          <IcX size={13} />
        </button>
      </div>
    </div>
  );
}

export default function Board() {
  const { data, ui, moveStatus, openIssue, can } = useStore();
  const canMove = can("transition");
  const canCreate = can("create");
  const [filterUser, setFilterUser] = useState<string | null | "none">(null);
  const [q, setQ] = useState("");
  const [chips, setChips] = useState<Set<QuickChip>>(new Set());
  const [quickFor, setQuickFor] = useState<string | null>(null);

  // ── Drag-and-drop поверх Pointer Events (overdrive) ───────────────────
  // Карточка физически следует за курсором (без рывков нативного HTML5 DnD),
  // с наклоном по скорости и растущей тенью при подъёме; отпускание —
  // экспоненциальное затухание без отскока (см. SETTLE), затем карточка
  // обычным образом переливается в новую позицию (flash/anim-drop).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overTarget, setOverTarget] = useState<{ statusId: string; beforeId: string | null } | null>(null);
  // Источник истины для решения при отпускании — стейт живёт только для
  // подсветки колонки/места вставки. Нативные pointerup может прийти раньше,
  // чем React успеет закоммитить последний setOverTarget из pointermove
  // (оба события — часть одного и того же жеста, без паузы на кадр между
  // ними), и тогда grabEnd прочитал бы ещё старое значение из замыкания.
  const overTargetRef = useRef<{ statusId: string; beforeId: string | null } | null>(null);
  const pointerMeta = useRef<{ id: string; startX: number; startY: number; rect: DOMRect } | null>(null);
  const activeRef = useRef(false);
  const suppressClickRef = useRef(false);
  const lastMoveRef = useRef({ x: 0, t: 0 });
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const settleTimer = useRef<number | undefined>(undefined);

  const toggleChip = (id: QuickChip) =>
    setChips((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const doneStatusId = data.workflow.statuses.find((s) => s.category === "done")?.id;
  const doneIds = useMemo(
    () => new Set(data.workflow.statuses.filter((s) => s.category === "done").map((s) => s.id)),
    [data.workflow.statuses],
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

  const byStatus = (sid: string) => visible.filter((i) => i.statusId === sid);
  const assignees = useMemo(() => {
    const ids = [...new Set(pool.map((i) => i.assigneeId).filter(Boolean))] as string[];
    return data.users.filter((u) => ids.includes(u.id));
  }, [pool, data.users]);

  const dragged = draggingId ? data.issues.find((i) => i.id === draggingId) : null;
  const canDropTo = (sid: string) => !dragged || dragged.statusId === sid || canTransition(data.workflow, dragged.statusId, sid);

  const onCardClick = useCallback(
    (issueId: string) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      openIssue(issueId);
    },
    [openIssue],
  );

  const grabStart = useCallback((e: React.PointerEvent, issue: Issue) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    pointerMeta.current = { id: issue.id, startX: e.clientX, startY: e.clientY, rect };
    activeRef.current = false;
    lastMoveRef.current = { x: e.clientX, t: performance.now() };
  }, []);

  const grabMove = useCallback((e: React.PointerEvent) => {
    const m = pointerMeta.current;
    if (!m) return;
    const dx = e.clientX - m.startX;
    const dy = e.clientY - m.startY;
    if (!activeRef.current) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      activeRef.current = true;
      setDraggingId(m.id);
    }
    const now = performance.now();
    const dt = Math.max(1, now - lastMoveRef.current.t);
    const vx = (e.clientX - lastMoveRef.current.x) / dt;
    lastMoveRef.current = { x: e.clientX, t: now };
    const tilt = Math.max(-8, Math.min(8, vx * 40));
    if (ghostRef.current) {
      ghostRef.current.style.transition = "";
      ghostRef.current.style.transform = `translate(${dx}px, ${dy}px) rotate(${tilt}deg) scale(1.03)`;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const colEl = el?.closest<HTMLElement>("[data-col-id]");
    const cardEl = el?.closest<HTMLElement>("[data-card-id]");
    const statusId = colEl?.dataset.colId;
    if (statusId) {
      const beforeId = cardEl && cardEl.dataset.cardId !== m.id ? cardEl.dataset.cardId! : null;
      const next = { statusId, beforeId };
      overTargetRef.current = next;
      setOverTarget((prev) => (prev && prev.statusId === statusId && prev.beforeId === beforeId ? prev : next));
    }
  }, []);

  const grabEnd = useCallback(
    (e: React.PointerEvent) => {
      const m = pointerMeta.current;
      if (!m) return;
      const wasDragging = activeRef.current;
      activeRef.current = false;
      if (!wasDragging) {
        pointerMeta.current = null;
        return; // обычный клик — сработает onClick
      }

      suppressClickRef.current = true;
      // canDropTo не перепроверяем здесь: moveStatus (store.tsx) сам читает
      // актуальный workflow и статус задачи из dataRef и покажет тост при
      // запрещённом переходе — дублировать проверку в замыкании grabEnd
      // незачем (и рискованно: useCallback не пересоздавался бы при каждом
      // изменении draggingId, замыкание тут же протухло бы, как overTarget
      // выше).
      const target = overTargetRef.current;
      if (target) moveStatus(m.id, target.statusId, target.beforeId);

      // rect остаётся в pointerMeta до конца settle — иначе призрак прыгнет
      // в (0,0) на следующем ре-рендере (draggingId ещё не сброшен).
      const dx = e.clientX - m.startX;
      const dy = e.clientY - m.startY;
      const g = ghostRef.current;
      if (g) {
        requestAnimationFrame(() => {
          g.style.transition = `transform ${SETTLE_MS}ms ${SETTLE}`;
          g.style.transform = `translate(${dx}px, ${dy}px) rotate(0deg) scale(1)`;
        });
      }
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        pointerMeta.current = null;
        overTargetRef.current = null;
        setDraggingId(null);
        setOverTarget(null);
      }, SETTLE_MS);
    },
    [moveStatus],
  );

  return (
    <div className="flex h-full flex-col">
      {/* шапка */}
      <div className="border-b border-line bg-panel/70 px-6 py-3.5">
       <div className="flex flex-wrap items-center gap-3">
        <div className="mr-2">
          <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">Доска</h1>
          <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-faint">
            <span>{data.project.name}</span>
            <span>·</span>
            <span>{pool.length} задач</span>
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center -space-x-1.5">
            {assignees.map((u) => (
              <button
                key={u.id}
                onClick={() => setFilterUser(filterUser === u.id ? null : u.id)}
                title={`Фильтр: ${u.name}`}
                className={`rounded-full transition-all ${filterUser === u.id ? "z-10 scale-110 ring-2 ring-accent" : "hover:z-10 hover:scale-105"} ${filterUser && filterUser !== u.id ? "opacity-40" : ""}`}
              >
                <Avatar user={u} size={26} ring />
              </button>
            ))}
            <button
              onClick={() => setFilterUser(filterUser === "none" ? null : "none")}
              title="Без исполнителя"
              className={`rounded-full transition-all ${filterUser === "none" ? "z-10 scale-110 ring-2 ring-accent" : "hover:z-10 hover:scale-105"} ${filterUser && filterUser !== "none" ? "opacity-40" : ""}`}
            >
              <Avatar user={null} size={26} ring />
            </button>
          </div>
          <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-panel px-2.5">
            <IcSearch size={13} className="text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Фильтр по доске" className="w-32 bg-transparent text-[12.5px] outline-none placeholder:text-faint" />
            {q && (
              <button onClick={() => setQ("")} className="text-faint hover:text-ink" aria-label="Сбросить">
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
               {c.label}
             </button>
           );
         })}
         {chips.size > 0 && (
           <button
             onClick={() => setChips(new Set())}
             className="flex h-7 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-faint hover:text-ink"
           >
             <IcX size={11} /> Сбросить
           </button>
         )}
         <span className="ml-auto text-[11.5px] text-faint">{visible.length} из {pool.length}</span>
       </div>
      </div>

      {!canMove && (
        <div className="flex items-center gap-2 border-b border-line bg-warnsoft/60 px-6 py-1.5 text-[12px] font-medium text-warn">
          <IcEye size={14} className="shrink-0" />
          <span className="truncate">
            Режим «только чтение»: ваша роль не позволяет перемещать задачи и создавать новые. Обратитесь к администратору проекта, если нужны дополнительные права.
          </span>
        </div>
      )}

      {/* колонки. w-max + mx-auto: на широком экране группа колонок
          центрируется, а когда не влезает — просто прокручивается от левого края
          (ticket-board-columns-theme-fix §3). */}
      <div className="dotgrid flex-1 overflow-x-auto overflow-y-hidden">
        <div className="mx-auto flex h-full w-max items-start gap-4 px-6 py-4">
          {data.workflow.statuses.map((st, ci) => {
            const items = byStatus(st.id);
            const c = catColor(st.category);
            const isOver = overTarget?.statusId === st.id;
            const ok = canDropTo(st.id);
            return (
              <section key={st.id} data-col-id={st.id} className={`anim-fadeup ${BOARD_COLUMN_SHELL}`} style={{ animationDelay: `${ci * 60}ms` }}>
                <header className="mb-1.5 flex items-center gap-2 px-1.5 pt-1">
                  <span className="h-2 w-2 rounded-sm" style={{ background: c.dot }} />
                  <h3 className="text-[12px] font-bold uppercase tracking-wider text-sub">{st.name}</h3>
                  <span className="rounded-full bg-todosoft px-1.5 font-mono text-[10.5px] font-bold text-sub">{items.length}</span>
                  {canCreate && st.id === firstTodoId && (
                    <button
                      onClick={() => setQuickFor(st.id)}
                      className="ml-auto flex h-6 w-6 items-center justify-center rounded text-faint transition-colors hover:bg-todosoft hover:text-ink"
                      aria-label={`Добавить в «${st.name}»`}
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
                    <div key={i.id} className={isOver && overTarget?.beforeId === i.id ? "-mt-2 border-t-2 border-accent pt-2" : ""}>
                      <Card
                        issue={i}
                        flash={ui.lastEvent?.issueId === i.id && Date.now() - ui.lastEvent.ts < 1500}
                        hidden={draggingId === i.id}
                        onGrabStart={grabStart}
                        onGrabMove={grabMove}
                        onGrabEnd={grabEnd}
                        onOpen={() => onCardClick(i.id)}
                        draggable={canMove}
                      />
                    </div>
                  ))}
                  {items.length === 0 && quickFor !== st.id && (
                    <div className={`rounded-lg border border-dashed px-3 py-6 text-center text-[11.5px] transition-colors ${isOver ? "border-accent text-accent" : "border-line2 text-faint"}`}>
                      {isOver ? (ok ? "Отпустите, чтобы переместить" : "Переход запрещён workflow") : "Перетащите задачи сюда"}
                    </div>
                  )}
                  {isOver && !ok && (
                    <p className="rounded bg-dangersoft px-2 py-1 text-center text-[11px] font-semibold text-danger">
                      Переход «{dragged ? data.workflow.statuses.find((s) => s.id === dragged.statusId)?.name : ""} → {st.name}» вне схемы
                    </p>
                  )}
                </div>

                {st.id === doneStatusId && items.length > 0 && (
                  <p className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-ok">
                    <IcInbox size={13} /> Закрыто: {items.length}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* «призрак» карточки под курсором — реальная карточка спрятана
          (visibility:hidden), эта плавающая копия следит за курсором */}
      {draggingId &&
        dragged &&
        (() => {
          const rect = pointerMeta.current?.rect;
          return (
            <div
              ref={ghostRef}
              style={{
                position: "fixed",
                left: rect?.left ?? 0,
                top: rect?.top ?? 0,
                width: rect?.width,
                zIndex: 100,
                pointerEvents: "none",
                willChange: "transform",
                borderRadius: 8,
                boxShadow: "0 22px 44px rgba(20,35,64,0.32), 0 8px 16px rgba(20,35,64,0.18)",
              }}
            >
              <Card issue={dragged} flash={false} draggable={false} onOpen={() => {}} />
            </div>
          );
        })()}
    </div>
  );
}
