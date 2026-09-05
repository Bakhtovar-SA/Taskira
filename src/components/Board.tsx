import { useMemo, useRef, useState } from "react";
import { canTransition, fmtDate, useStore } from "../store";
import type { Issue, Status } from "../types";
import { IcCheck, IcEye, IcInbox, IcPlus, IcSearch, IcX, PriorityIcon, TypeIcon } from "../icons";
import { Avatar, Chip, catColor } from "../ui";

function Card({ issue, onDragStart, onDragEnd, onDropOn, onOver, flash, draggable }: { issue: Issue; onDragStart: () => void; onDragEnd: () => void; onDropOn: (e: React.DragEvent) => void; onOver: () => void; flash: boolean; draggable: boolean }) {
  const { data, openIssue } = useStore();
  const assignee = data.users.find((u) => u.id === issue.assigneeId);
  const epic = data.issues.find((i) => i.id === issue.epicId);

  return (
    <article
      draggable={draggable}
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
      className={`group cursor-pointer rounded-lg border border-line bg-panel p-2.5 shadow-[0_1px_2px_rgba(20,35,64,0.06)] transition-all duration-150 hover:-translate-y-px hover:border-[#b9c6da] hover:shadow-[0_6px_18px_rgba(20,35,64,0.12)] active:scale-[0.99] ${flash ? "anim-flash" : ""}`}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <TypeIcon type={issue.typeId} size={14} />
        <span className="font-mono text-[11px] font-semibold tracking-tight text-faint">{issue.key}</span>
        {issue.labels.slice(0, 2).map((l) => (
          <Chip key={l} text={l} />
        ))}
        <span className="ml-auto" title="Приоритет">
          <PriorityIcon p={issue.priorityId} size={14} />
        </span>
      </div>
      <h4 className="text-[13.5px] font-medium leading-snug text-ink">{issue.title}</h4>
      <div className="mt-2.5 flex items-center gap-2">
        {epic && (
          <span className="inline-flex max-w-[120px] items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ background: `${epic.color}1a`, color: epic.color }}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-sm" style={{ background: epic.color }} />
            <span className="truncate">{epic.title}</span>
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {issue.points != null && <span className="rounded-full bg-[#e8edf4] px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-sub">{issue.points}</span>}
          <Avatar user={assignee ?? null} size={22} />
        </span>
      </div>
    </article>
  );
}

function QuickCreate({ status, onDone }: { status: Status; onDone: () => void }) {
  const { data, createIssue } = useStore();
  const [text, setText] = useState("");
  const active = data.sprints.find((s) => s.status === "active");
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
      sprintId: active?.id ?? null,
      statusId: status.id,
    });
    setText("");
  };
  return (
    <div className="anim-fadeup rounded-lg border border-accent bg-white p-2 shadow-[0_0_0_3px_rgba(11,95,217,0.1)]">
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
  const { data, ui, moveStatus, can } = useStore();
  const canMove = can("transition");
  const canCreate = can("create");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [filterUser, setFilterUser] = useState<string | null | "none">(null);
  const [q, setQ] = useState("");
  const [quickFor, setQuickFor] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);

  const activeSprint = data.sprints.find((s) => s.status === "active");
  const doneStatusId = data.workflow.statuses.find((s) => s.category === "done")?.id;

  const pool = useMemo(
    () => data.issues.filter((i) => i.typeId !== "epic" && (activeSprint ? i.sprintId === activeSprint.id : true)),
    [data.issues, activeSprint],
  );

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return pool.filter((i) => {
      if (filterUser === "none" ? i.assigneeId !== null : filterUser ? i.assigneeId !== filterUser : false) return false;
      if (s && !i.title.toLowerCase().includes(s) && !i.key.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [pool, filterUser, q]);

  const byStatus = (sid: string) => visible.filter((i) => i.statusId === sid);
  const assignees = useMemo(() => {
    const ids = [...new Set(pool.map((i) => i.assigneeId).filter(Boolean))] as string[];
    return data.users.filter((u) => ids.includes(u.id));
  }, [pool, data.users]);

  const dragged = dragId ? data.issues.find((i) => i.id === dragId) : null;
  const canDropTo = (sid: string) => !dragged || dragged.statusId === sid || canTransition(data.workflow, dragged.statusId, sid);

  const sprintDays = activeSprint ? Math.max(0, Math.ceil((new Date(activeSprint.endDate + "T23:59:59").getTime() - Date.now()) / 864e5)) : null;

  return (
    <div className="flex h-full flex-col">
      {/* шапка */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel/70 px-6 py-3.5">
        <div className="mr-2">
          <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">Доска</h1>
          <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-faint">
            {activeSprint ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-ok pulse-dot" />
                <b className="text-sub">{activeSprint.name}</b> · {fmtDate(activeSprint.startDate)} — {fmtDate(activeSprint.endDate)}
                <span className="rounded bg-warnsoft px-1.5 py-0.5 font-mono text-[10px] font-bold text-warn">осталось {sprintDays} дн</span>
              </>
            ) : (
              <span>спринт не активен — показаны все задачи</span>
            )}
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
          <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-white px-2.5">
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

      {!canMove && (
        <div className="flex items-center gap-2 border-b border-line bg-warnsoft/60 px-6 py-1.5 text-[12px] font-medium text-warn">
          <IcEye size={14} className="shrink-0" />
          <span className="truncate">
            Режим «только чтение»: ваша роль не позволяет перемещать задачи и создавать новые. Переключите пользователя в меню справа, чтобы увидеть другие уровни доступа.
          </span>
        </div>
      )}

      {/* колонки */}
      <div className="dotgrid flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full items-start gap-3.5 px-6 py-4" style={{ minWidth: "max-content" }}>
          {data.workflow.statuses.map((st, ci) => {
            const items = byStatus(st.id);
            const c = catColor(st.category);
            const isOver = overCol === st.id;
            const ok = canDropTo(st.id);
            const totalPts = items.reduce((a, i) => a + (i.points ?? 0), 0);
            return (
              <section
                key={st.id}
                className="anim-fadeup flex h-full max-h-full w-[286px] shrink-0 flex-col"
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
                <header className="mb-2 flex items-center gap-2 px-1">
                  <span className="h-2 w-2 rounded-sm" style={{ background: c.dot }} />
                  <h3 className="text-[12px] font-bold uppercase tracking-wider text-sub">{st.name}</h3>
                  <span className="rounded-full bg-[#e3e9f1] px-1.5 font-mono text-[10.5px] font-bold text-sub">{items.length}</span>
                  {totalPts > 0 && <span className="font-mono text-[10px] text-faint">{totalPts} оч.</span>}
                  {canCreate && (
                    <button
                      onClick={() => setQuickFor(st.id)}
                      className="ml-auto flex h-6 w-6 items-center justify-center rounded text-faint transition-colors hover:bg-[#e3e9f1] hover:text-ink"
                      aria-label={`Добавить в «${st.name}»`}
                    >
                      <IcPlus size={14} />
                    </button>
                  )}
                </header>

                <div
                  className={`flex-1 space-y-2 overflow-y-auto rounded-xl border-2 border-dashed p-2 transition-all duration-150 ${
                    isOver ? (ok ? "border-accent bg-accentsoft/70" : "border-danger bg-dangersoft/70") : "border-transparent bg-[#e9edf3]/60"
                  }`}
                >
                  {quickFor === st.id && <QuickCreate status={st} onDone={() => setQuickFor(null)} />}
                  {items.map((i) => (
                    <Card
                      key={i.id}
                      issue={i}
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
                  {items.length === 0 && quickFor !== st.id && (
                    <div className={`rounded-lg border border-dashed px-3 py-6 text-center text-[11.5px] transition-colors ${isOver ? "border-accent text-accent" : "border-[#c3ccda] text-faint"}`}>
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
                    <IcInbox size={13} /> Закрыто в этом спринте: {items.length}
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
