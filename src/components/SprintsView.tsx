import { useMemo, useState } from "react";
import { useStore } from "../store";
import type { Issue, Sprint } from "../types";
import { LIMITS } from "../validation";
import { IcCheck, IcFlag, IcPlus, IcX, PriorityIcon, TypeIcon } from "../icons";
import { Avatar, Empty, Modal } from "../ui";

/** Бэклог + спринты (sprints, миграция 023) — опциональный модуль, вкладка
 *  видна только при data.project.sprintsEnabled (гейтится в Sidebar.tsx).
 *  Сама доска статусов не переизобретается здесь — задачи спринта видно и
 *  двигаются по workflow на обычной Доске; эта вьюха только про то, какие
 *  задачи В КАКОМ спринте (или в бэклоге) состоят, плюс жизненный цикл
 *  самого спринта (старт/завершение). См. SPRINTS_MIGRATION.md. */

const STATUS_LABEL: Record<Sprint["status"], string> = {
  future: "Будущий",
  active: "Активный",
  completed: "Завершён",
};

function IssueRow({ issue, onRemove }: { issue: Issue; onRemove?: () => void }) {
  const { idx, openIssue, can } = useStore();
  const assignee = issue.assigneeId ? idx.users.get(issue.assigneeId) : undefined;
  // Как Board.tsx (draggable={canMove}) — иначе карточка выглядит
  // перетаскиваемой для роли без manageSprints, а drop лишь молча отклоняется
  // тостом об отказе (ревью PR #49, седьмой раунд).
  const canDrag = can("manageSprints");

  return (
    <div
      draggable={canDrag}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", issue.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => openIssue(issue.id)}
      className="group flex cursor-pointer items-center gap-2 border-b border-linesoft bg-panel px-2.5 py-1.5 transition-colors last:border-0 hover:bg-accentsoft/50"
    >
      <TypeIcon type={issue.typeId} size={13} />
      <span className="w-14 shrink-0 truncate font-mono text-[10.5px] font-semibold text-faint">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{issue.title}</span>
      <PriorityIcon p={issue.priorityId} size={13} />
      <Avatar user={assignee ?? null} size={19} />
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Убрать из спринта"
          title="Убрать из спринта"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint opacity-0 transition-all hover:bg-todosoft hover:text-ink group-hover:opacity-100"
        >
          <IcX size={11} />
        </button>
      )}
    </div>
  );
}

function DropZone({
  onDropIssue,
  children,
  className = "",
}: {
  onDropIssue: (issueId: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropIssue(id);
      }}
      className={`${className} ${over ? "bg-accentsoft/40 ring-1 ring-inset ring-accent" : ""}`}
    >
      {children}
    </div>
  );
}

function CreateSprintModal({ onClose }: { onClose: () => void }) {
  const { addSprint } = useStore();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addSprint({ name: trimmed, goal: goal.trim(), startDate: startDate || null, endDate: endDate || null });
    onClose();
  };

  return (
    <Modal onClose={onClose} w={440} title="Новый спринт">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <span className="font-disp text-[14px] font-bold text-ink">Новый спринт</span>
        <button onClick={onClose} className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-canvas hover:text-ink" aria-label="Закрыть">
          <IcX size={15} />
        </button>
      </div>
      <div className="space-y-3 px-5 py-4">
        <div>
          <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-faint">Название</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Спринт 12"
            maxLength={LIMITS.sprint.name.max}
            className="w-full rounded-md border border-line bg-panel px-3 py-2 text-[13px] text-ink focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-faint">Цель (необязательно)</label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            placeholder="Что должно быть готово к концу спринта"
            maxLength={LIMITS.sprint.goal.max}
            className="w-full resize-none rounded-md border border-line bg-panel px-3 py-2 text-[13px] text-ink focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-faint">Начало</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border border-line bg-panel px-3 py-2 text-[13px] text-ink focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-faint">Конец</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-md border border-line bg-panel px-3 py-2 text-[13px] text-ink focus:border-accent focus:outline-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-[13px] font-semibold text-sub hover:bg-canvas">
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(11,95,217,0.3)] transition-all hover:bg-accentdeep active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Создать
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SprintSection({ sprint, issues, hasActiveSprint }: { sprint: Sprint; issues: Issue[]; hasActiveSprint: boolean }) {
  const { can, startSprint, completeSprint, setIssueSprint } = useStore();
  const manage = can("manageSprints");
  const doneCount = issues.filter((i) => i.doneAt != null).length;

  return (
    <div className="rounded-lg border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-linesoft px-3.5 py-2.5">
        <IcFlag size={14} />
        <span className="font-disp text-[13.5px] font-bold text-ink">{sprint.name}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            sprint.status === "active"
              ? "bg-oksoft text-ok"
              : sprint.status === "future"
                ? "bg-todosoft text-sub"
                : "bg-linesoft text-faint"
          }`}
        >
          {STATUS_LABEL[sprint.status]}
        </span>
        {(sprint.startDate || sprint.endDate) && (
          <span className="font-mono text-[10.5px] text-faint">
            {sprint.startDate ?? "…"} – {sprint.endDate ?? "…"}
          </span>
        )}
        <span className="text-[11px] text-faint">
          {issues.length > 0 ? `${doneCount}/${issues.length} готово` : "нет задач"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {manage && sprint.status === "future" && (
            <button
              onClick={() => startSprint(sprint.id)}
              disabled={hasActiveSprint}
              title={hasActiveSprint ? "В проекте уже есть активный спринт — сначала завершите его" : undefined}
              className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] font-semibold text-sub transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Начать
            </button>
          )}
          {manage && sprint.status === "active" && (
            <button
              onClick={() => {
                if (window.confirm(`Завершить «${sprint.name}»? Незакрытые задачи вернутся в бэклог.`)) completeSprint(sprint.id);
              }}
              className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-white transition-colors hover:bg-accentdeep"
            >
              <IcCheck size={12} /> Завершить
            </button>
          )}
        </div>
      </div>
      {sprint.goal && <p className="border-b border-linesoft px-3.5 py-2 text-[12px] text-sub">{sprint.goal}</p>}
      <DropZone
        onDropIssue={(id) => sprint.status !== "completed" && setIssueSprint(id, sprint.id)}
        className="min-h-[44px] transition-colors"
      >
        {issues.length === 0 ? (
          <p className="px-3.5 py-3 text-[12px] text-faint">Перетащите задачи из бэклога сюда</p>
        ) : (
          issues.map((i) => (
            <IssueRow key={i.id} issue={i} onRemove={manage ? () => setIssueSprint(i.id, null) : undefined} />
          ))
        )}
      </DropZone>
    </div>
  );
}

export default function SprintsView() {
  const { data, can, setIssueSprint } = useStore();
  const [showCreate, setShowCreate] = useState(false);

  const backlogIssues = useMemo(
    () => data.issues.filter((i) => i.sprintId === null && !i.archivedAt).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
    [data.issues],
  );
  const issuesBySprintId = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of data.issues) {
      if (!i.sprintId) continue;
      const bucket = m.get(i.sprintId);
      if (bucket) bucket.push(i);
      else m.set(i.sprintId, [i]);
    }
    return m;
  }, [data.issues]);
  const hasActiveSprint = data.sprints.some((s) => s.status === "active");
  // Активный первым, затем будущие, завершённые — в конце списком (история).
  const order: Record<Sprint["status"], number> = { active: 0, future: 1, completed: 2 };
  const sortedSprints = useMemo(() => [...data.sprints].sort((a, b) => order[a.status] - order[b.status]), [data.sprints]);

  if (!data.project.sprintsEnabled) {
    return <Empty icon={<IcFlag size={28} />} title="Модуль спринтов не подключён" sub="Обратитесь к администратору, чтобы включить его для этого проекта." />;
  }

  return (
    <div className="flex h-full gap-4 overflow-hidden p-4">
      <div className="flex w-[300px] shrink-0 flex-col rounded-lg border border-line bg-panel">
        <div className="border-b border-linesoft px-3.5 py-2.5">
          <span className="font-disp text-[13.5px] font-bold text-ink">Бэклог</span>
          <span className="ml-1.5 text-[11px] text-faint">{backlogIssues.length}</span>
        </div>
        <DropZone onDropIssue={(id) => setIssueSprint(id, null)} className="min-h-0 flex-1 overflow-y-auto transition-colors">
          {backlogIssues.length === 0 ? (
            <p className="px-3.5 py-3 text-[12px] text-faint">Бэклог пуст</p>
          ) : (
            backlogIssues.map((i) => <IssueRow key={i.id} issue={i} />)
          )}
        </DropZone>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Спринты · {data.sprints.length}</p>
          {can("manageSprints") && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-[0_2px_8px_rgba(11,95,217,0.3)] transition-all hover:bg-accentdeep active:scale-[0.97]"
            >
              <IcPlus size={13} /> Спринт
            </button>
          )}
        </div>
        {sortedSprints.length === 0 ? (
          <Empty icon={<IcFlag size={28} />} title="Ещё нет ни одного спринта" sub="Создайте первый, чтобы начать планирование." />
        ) : (
          <div className="space-y-3 pb-4">
            {sortedSprints.map((s) => (
              <SprintSection key={s.id} sprint={s} issues={issuesBySprintId.get(s.id) ?? []} hasActiveSprint={hasActiveSprint} />
            ))}
          </div>
        )}
      </div>

      {showCreate && <CreateSprintModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
