import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import type { Issue, Sprint } from "../types";
import { LIMITS } from "../validation";
import { IcCheck, IcFlag, IcPlus, IcX, PriorityIcon, TypeIcon } from "../icons";
import { AvatarStack, Empty, Modal, SkeletonRow } from "../ui";
import { useT } from "../i18n";

/** Бэклог + спринты (sprints, миграция 023) — опциональный модуль, вкладка
 *  видна только при data.project.sprintsEnabled (гейтится в Sidebar.tsx).
 *  Сама доска статусов не переизобретается здесь — задачи спринта видно и
 *  двигаются по workflow на обычной Доске; эта вьюха только про то, какие
 *  задачи В КАКОМ спринте (или в бэклоге) состоят, плюс жизненный цикл
 *  самого спринта (старт/завершение). См. SPRINTS_MIGRATION.md. */

function IssueRow({ issue, onRemove }: { issue: Issue; onRemove?: () => void }) {
  const { t } = useT();
  const { idx, openIssue, can } = useStore();
  const assignees = issue.assigneeIds.map((id) => idx.users.get(id)).filter((u): u is NonNullable<typeof u> => !!u);
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
      className="group flex cursor-pointer items-center gap-2 border-b border-linesoft bg-panel px-2.5 py-1.5 transition-colors last:border-0 hover:bg-hover/60"
    >
      <TypeIcon type={issue.typeId} size={13} />
      <span className="w-14 shrink-0 truncate font-mono text-[10.5px] font-semibold text-faint">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{issue.title}</span>
      <PriorityIcon p={issue.priorityId} size={13} />
      <AvatarStack users={assignees} size={19} interactive />
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={t("sprints.removeIssue")}
          title={t("sprints.removeIssue")}
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
  const { t } = useT();
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
    <Modal onClose={onClose} w={440} title={t("sprints.new")}>
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <span className="font-disp text-[14px] font-semibold text-ink">{t("sprints.new")}</span>
        <button onClick={onClose} className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink" aria-label={t("common.close")}>
          <IcX size={15} />
        </button>
      </div>
      <div className="space-y-3 px-5 py-4">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-faint">{t("sprints.name")}</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={t("sprints.namePlaceholder")}
            maxLength={LIMITS.sprint.name.max}
            className="w-full rounded-md border border-line bg-panel px-3 py-2 text-[13px] text-ink focus:border-accent focus:shadow-focus focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-faint">{t("sprints.goal")}</label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            placeholder={t("sprints.goalPlaceholder")}
            maxLength={LIMITS.sprint.goal.max}
            className="w-full resize-none rounded-md border border-line bg-panel px-3 py-2 text-[13px] text-ink focus:border-accent focus:shadow-focus focus:outline-none"
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-[12px] font-medium text-faint">{t("sprints.start")}</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border border-line bg-panel px-3 py-2 text-[13px] text-ink focus:border-accent focus:shadow-focus focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-[12px] font-medium text-faint">{t("sprints.end")}</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-md border border-line bg-panel px-3 py-2 text-[13px] text-ink focus:border-accent focus:shadow-focus focus:outline-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-[13px] font-semibold text-sub hover:bg-hover">
            {t("common.cancel")}
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="rounded-lg btn-primary px-4 py-2 text-[13px] font-medium text-onaccent transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("common.create")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SprintSection({ sprint, issues, hasActiveSprint }: { sprint: Sprint; issues: Issue[]; hasActiveSprint: boolean }) {
  const { t } = useT();
  const { can, startSprint, completeSprint, setIssueSprint } = useStore();
  const manage = can("manageSprints");
  const doneCount = issues.filter((i) => i.doneAt != null).length;

  return (
    <div className="rounded-lg border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-linesoft px-3.5 py-2.5">
        <IcFlag size={14} />
        <span className="font-disp text-[13.5px] font-semibold text-ink">{sprint.name}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[11.5px] font-medium ${
            sprint.status === "active"
              ? "bg-oksoft text-ok"
              : sprint.status === "future"
                ? "bg-todosoft text-sub"
                : "bg-linesoft text-faint"
          }`}
        >
          {t(`sprints.status.${sprint.status}`)}
        </span>
        {(sprint.startDate || sprint.endDate) && (
          <span className="font-mono text-[10.5px] text-faint">
            {sprint.startDate ?? "…"} – {sprint.endDate ?? "…"}
          </span>
        )}
        <span className="text-[11px] text-faint">
          {issues.length > 0 ? t("sprints.doneCount", { done: doneCount, total: issues.length }) : t("issue.noIssues")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {manage && sprint.status === "future" && (
            <button
              onClick={() => startSprint(sprint.id)}
              disabled={hasActiveSprint}
              title={hasActiveSprint ? t("sprints.activeExists") : undefined}
              className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] font-semibold text-sub transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("sprints.begin")}
            </button>
          )}
          {manage && sprint.status === "active" && (
            <button
              onClick={() => {
                if (window.confirm(t("sprints.completeConfirm", { name: sprint.name }))) completeSprint(sprint.id);
              }}
              className="flex items-center gap-1 rounded-lg btn-primary px-2.5 py-1 text-[11.5px] font-medium text-onaccent transition-colors"
            >
              <IcCheck size={12} /> {t("sprints.complete")}
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
          <p className="px-3.5 py-3 text-[12px] text-faint">{t("sprints.dropHere")}</p>
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
  const { t } = useT();
  const { data, can, setIssueSprint, ensureAllIssues } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  // Sprints группирует ВСЕ задачи проекта по спринтам и бэклогу и потому остаётся единственным
  // осознанным потребителем полной загрузки (PERF-06 A15: обернуть, не оптимизировать). Экран
  // выключен по умолчанию; полный набор грузится только при входе на него.
  useEffect(() => {
    void ensureAllIssues();
  }, [ensureAllIssues]);

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
    return <Empty icon={<IcFlag size={28} />} title={t("sprints.disabledTitle")} sub={t("sprints.disabledSub")} />;
  }

  return (
    <div className="flex h-full gap-4 overflow-hidden p-4">
      <div className="flex w-[300px] shrink-0 flex-col rounded-lg border border-line bg-panel">
        <div className="border-b border-linesoft px-3.5 py-2.5">
          <span className="font-disp text-[13.5px] font-semibold text-ink">{t("sprints.backlogTitle")}</span>
          <span className="ml-1.5 text-[11px] text-faint">{data.issuesComplete ? backlogIssues.length : "…"}</span>
        </div>
        <DropZone onDropIssue={(id) => setIssueSprint(id, null)} className="min-h-0 flex-1 overflow-y-auto transition-colors">
          {!data.issuesComplete ? (
            <div aria-busy="true" aria-label={t("sprints.loadingIssues")}>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : backlogIssues.length === 0 ? (
            <p className="px-3.5 py-3 text-[12px] text-faint">{t("sprints.backlogEmpty")}</p>
          ) : (
            backlogIssues.map((i) => <IssueRow key={i.id} issue={i} />)
          )}
        </DropZone>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[12px] font-semibold text-faint">{t("sprints.count", { count: data.sprints.length })}</p>
          {can("manageSprints") && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-lg btn-primary px-3 py-1.5 text-[12.5px] font-medium text-onaccent transition-all active:scale-[0.97]"
            >
              <IcPlus size={13} /> {t("sprints.sprint")}
            </button>
          )}
        </div>
        {!data.issuesComplete && <p className="mb-2 text-[11.5px] text-faint">{t("sprints.loadingIssues")}</p>}
        {sortedSprints.length === 0 ? (
          <Empty icon={<IcFlag size={28} />} title={t("sprints.emptyTitle")} sub={t("sprints.emptySub")} />
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
