import { useMemo, useState } from "react";
import { fmtDate, useStore } from "../store";
import type { Issue, Sprint } from "../types";
import { IcBolt, IcCalendar, IcChevD, IcDots, IcFlag, IcInbox, IcLock, IcTrash, PriorityIcon, TypeIcon } from "../icons";
import { Avatar, Chip, Dropdown, Empty, MenuItem } from "../ui";

function Row({ issue, onDragStart, onDragEnd, draggable }: { issue: Issue; onDragStart: () => void; onDragEnd: () => void; draggable: boolean }) {
  const { data, openIssue, setSprint, deleteIssue, can } = useStore();
  const assignee = data.users.find((u) => u.id === issue.assigneeId);
  const epic = data.issues.find((i) => i.id === issue.epicId);
  const active = data.sprints.find((s) => s.status === "active");
  const future = data.sprints.find((s) => s.status === "future");

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", issue.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={() => openIssue(issue.id)}
      className="group flex cursor-pointer items-center gap-2.5 border-b border-linesoft bg-panel px-3 py-2 transition-colors last:border-0 hover:bg-accentsoft/50"
    >
      <span className="cursor-grab text-[#c3ccda] group-hover:text-faint" title="Перетащите">
        <IcDots size={13} className="rotate-90" />
      </span>
      <TypeIcon type={issue.typeId} size={14} />
      <span className="w-14 shrink-0 font-mono text-[11px] font-semibold text-faint">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{issue.title}</span>
      {epic && (
        <span className="hidden items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10.5px] font-semibold lg:inline-flex" style={{ background: `${epic.color}1a`, color: epic.color }}>
          <span className="h-1.5 w-1.5 rounded-sm" style={{ background: epic.color }} />
          <span className="max-w-[110px] truncate">{epic.title}</span>
        </span>
      )}
      <span className="hidden gap-1 xl:flex">
        {issue.labels.slice(0, 2).map((l) => (
          <Chip key={l} text={l} />
        ))}
      </span>
      <PriorityIcon p={issue.priorityId} size={14} />
      {issue.points != null && <span className="w-7 text-center font-mono text-[11px] font-bold text-sub">{issue.points}</span>}
      <Avatar user={assignee ?? null} size={22} />
      <div onClick={(e) => e.stopPropagation()}>
        <Dropdown
          align="right"
          width={210}
          button={() => (
            <button className="flex h-6 w-6 items-center justify-center rounded text-faint opacity-0 transition-all hover:bg-[#e3e9f1] hover:text-ink group-hover:opacity-100" aria-label="Действия">
              <IcDots size={14} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem onClick={() => { openIssue(issue.id); close(); }}>Открыть задачу</MenuItem>
              {active && issue.sprintId !== active.id && (
                <MenuItem onClick={() => { setSprint(issue.id, active.id); close(); }}>В {active.name}</MenuItem>
              )}
              {future && issue.sprintId !== future.id && (
                <MenuItem onClick={() => { setSprint(issue.id, future.id); close(); }}>В {future.name}</MenuItem>
              )}
              {issue.sprintId !== null && (
                <MenuItem onClick={() => { setSprint(issue.id, null); close(); }}>Вернуть в бэклог</MenuItem>
              )}
              {can("delete") && (
                <>
                  <div className="my-1 border-t border-linesoft" />
                  <MenuItem danger onClick={() => { deleteIssue(issue.id); close(); }}>
                    <IcTrash size={13} /> Удалить
                  </MenuItem>
                </>
              )}
            </>
          )}
        </Dropdown>
      </div>
    </div>
  );
}

function Section({ title, sprint, issues, zone, accent, right, defaultOpen = true }: { title: string; sprint?: Sprint; issues: Issue[]; zone: string; accent?: boolean; right?: React.ReactNode; defaultOpen?: boolean }) {
  const { setSprint, ui, can } = useStore();
  const canManage = can("manageSprints");
  const [open, setOpen] = useState(defaultOpen);
  const [over, setOver] = useState(false);
  const pts = issues.reduce((a, i) => a + (i.points ?? 0), 0);
  const doneId = useStore().data.workflow.statuses.find((s) => s.category === "done")?.id;
  const done = issues.filter((i) => i.statusId === doneId).length;

  return (
    <section
      className="overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) setSprint(id, zone === "backlog" ? null : zone);
      }}
    >
      <header
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3 transition-colors ${accent ? "border-line bg-gradient-to-r from-accentsoft/80 to-panel" : "border-linesoft bg-canvas/60"} ${over ? "bg-accentsoft" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <button className="flex items-center gap-2 text-left" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
          <IcChevD size={13} className={`text-faint transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
          <h3 className="text-[13.5px] font-bold text-ink">{title}</h3>
          {accent && <span className="h-2 w-2 rounded-full bg-ok pulse-dot" />}
        </button>
        <span className="rounded-full bg-[#e3e9f1] px-2 py-0.5 font-mono text-[10.5px] font-bold text-sub">{issues.length}</span>
        <span className="font-mono text-[10.5px] text-faint">{pts} очков</span>
        {sprint && (
          <span className="flex items-center gap-1.5 text-[11.5px] text-faint">
            <IcCalendar size={12} /> {fmtDate(sprint.startDate)} — {fmtDate(sprint.endDate)}
          </span>
        )}
        {accent && issues.length > 0 && (
          <span className="hidden items-center gap-2 md:flex">
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[#e3e9f1]">
              <span className="block h-full rounded-full bg-ok transition-all duration-500" style={{ width: `${(done / issues.length) * 100}%` }} />
            </span>
            <span className="font-mono text-[10.5px] font-bold text-ok">{done}/{issues.length}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {right}
        </div>
      </header>
      {sprint?.goal && open && (
        <p className="flex items-center gap-2 border-b border-linesoft bg-warnsoft/40 px-4 py-2 text-[12px] text-sub">
          <IcFlag size={13} className="text-warn" /> Цель: <b className="font-semibold text-ink">{sprint.goal}</b>
        </p>
      )}
      {open && (
        <div className={`transition-all ${over ? "ring-2 ring-inset ring-accent/50" : ""}`}>
          {issues.map((i) => (
            <Row key={i.id} issue={i} draggable={canManage} onDragStart={() => ui.lastEvent} onDragEnd={() => undefined} />
          ))}
          {issues.length === 0 && (
            <div className="p-3">
              <Empty icon={<IcInbox size={22} />} title={over ? "Отпустите, чтобы переместить" : "Пока пусто"} sub="Перетащите задачи из других секций или создайте новые" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function Backlog() {
  const { data, completeSprint, startSprint, can } = useStore();
  const canManage = can("manageSprints");
  const active = data.sprints.find((s) => s.status === "active");
  const future = data.sprints.find((s) => s.status === "future");
  const issues = useMemo(() => data.issues.filter((i) => i.typeId !== "epic"), [data.issues]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1060px] flex-col gap-4 px-6 py-5">
        <div className="anim-fadeup flex items-end gap-3">
          <div>
            <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">Бэклог</h1>
            <p className="mt-0.5 text-[11.5px] text-faint">Планируйте спринты перетаскиванием задач между секциями</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!canManage && (
              <span className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-canvas px-3 text-[12px] font-medium text-faint">
                <IcLock size={12} /> спринты управляет менеджер
              </span>
            )}
            {active ? (
              <button
                onClick={completeSprint}
                disabled={!canManage}
                className={`flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-[12.5px] font-semibold transition-colors ${canManage ? "text-sub hover:border-ok hover:text-ok" : "cursor-not-allowed text-faint"}`}
              >
                <IcBolt size={13} /> Завершить {active.name.toLowerCase()}
              </button>
            ) : (
              <button
                onClick={startSprint}
                disabled={!canManage}
                className={`flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[12.5px] font-semibold transition-all ${canManage ? "bg-accent text-white shadow-[0_2px_8px_rgba(11,95,217,0.3)] hover:bg-accentdeep active:scale-[0.97]" : "cursor-not-allowed bg-canvas text-faint"}`}
              >
                <IcBolt size={13} /> Начать спринт
              </button>
            )}
          </div>
        </div>

        {active ? (
          <div className="anim-fadeup" style={{ animationDelay: "60ms" }}>
            <Section
              title={`${active.name} · активный`}
              sprint={active}
              zone={active.id}
              accent
              issues={issues.filter((i) => i.sprintId === active.id)}
              right={
                <span className="rounded bg-warnsoft px-2 py-1 font-mono text-[10.5px] font-bold text-warn">
                  {Math.max(0, Math.ceil((new Date(active.endDate + "T23:59:59").getTime() - Date.now()) / 864e5))} дн до конца
                </span>
              }
            />
          </div>
        ) : (
          <div className="anim-fadeup rounded-xl border border-dashed border-[#c3ccda] bg-panel/60 p-6 text-center">
            <p className="text-[13px] font-semibold text-sub">Активного спринта нет</p>
            <p className="mx-auto mt-1 max-w-[340px] text-[12px] text-faint">Соберите объём из будущего спринта или бэклога и нажмите «Начать спринт» — задачи появятся на доске.</p>
          </div>
        )}

        {future && (
          <div className="anim-fadeup" style={{ animationDelay: "120ms" }}>
            <Section title={`${future.name} · запланирован`} sprint={future} zone={future.id} issues={issues.filter((i) => i.sprintId === future.id)} />
          </div>
        )}

        <div className="anim-fadeup pb-8" style={{ animationDelay: "180ms" }}>
          <Section title="Бэклог · вне спринтов" zone="backlog" issues={issues.filter((i) => i.sprintId === null)} defaultOpen />
        </div>
      </div>
    </div>
  );
}
