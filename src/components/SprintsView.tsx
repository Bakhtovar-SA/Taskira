
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import type { Issue, Sprint } from "../types";
import { LIMITS } from "../validation";
import { IcCheck, IcFlag, IcPlus, IcX, PriorityIcon, TypeIcon } from "../icons";
import { AvatarStack } from "../ui";
import { Button, IconButton, Dialog, Input, Textarea, EmptyState, Tag } from "../ds";
import { ScreenSkeletonRow } from "./settings/parts";
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
        <IconButton variant="ghost" size="sm" label={t("sprints.removeIssue")}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}


          className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
        >
          <IcX size={11} />
        </IconButton>
      )}
    </div>
  );
}

function DropZone({
  onDropIssue,
  children,
  className = "",
  blocked,
}: {
  onDropIssue: (issueId: string) => void;
  children: React.ReactNode;
  className?: string;
  /** Сюда переносить нельзя (завершённый спринт): зона подсвечивается как закрытая,
   *  а сброс не переносит задачу — вызывается onBlockedDrop с объяснением, а не тишина. */
  blocked?: { reason: string; onBlockedDrop: (reason: string) => void };
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
        if (!id) return;
        if (blocked) blocked.onBlockedDrop(blocked.reason);
        else onDropIssue(id);
      }}
      data-blocked={blocked ? "true" : undefined}
      className={`${className} ${over ? (blocked ? "bg-sunken ring-1 ring-inset ring-line2" : "bg-accentsoft/40 ring-1 ring-inset ring-accent") : ""}`}
    >
      {over && blocked && <p className="px-3.5 pt-2 text-[12px] font-medium text-sub">{blocked.reason}</p>}
      {children}
    </div>
  );
}

function CreateSprintModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const { addSprint } = useStore();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  useEffect(() => {
    if (open) { setName(""); setGoal(""); setStartDate(""); setEndDate(""); }
  }, [open]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addSprint({ name: trimmed, goal: goal.trim(), startDate: startDate || null, endDate: endDate || null });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} size="sm" title={t("sprints.new")} footer={<>
      <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
      <Button variant="primary" onClick={submit} disabled={!name.trim()}>{t("common.create")}</Button>
    </>}>
      <div className="space-y-3">
          <Input label={t("sprints.name")} data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={t("sprints.namePlaceholder")}
            maxLength={LIMITS.sprint.name.max}
          />
          <Textarea label={t("sprints.goal")} maxChars={LIMITS.sprint.goal.max}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            placeholder={t("sprints.goalPlaceholder")}
            maxLength={LIMITS.sprint.goal.max}
          />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input type="date" label={t("sprints.start")} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input type="date" label={t("sprints.end")} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}

function SprintSection({ sprint, issues, hasActiveSprint }: { sprint: Sprint; issues: Issue[]; hasActiveSprint: boolean }) {
  const { t } = useT();
  const { can, startSprint, completeSprint, setIssueSprint, toast } = useStore();
  const manage = can("manageSprints");
  const doneCount = issues.filter((i) => i.doneAt != null).length;

  return (
    <div className="rounded-lg border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-linesoft px-3.5 py-2.5">
        <IcFlag size={14} />
        <span className="font-disp text-[13.5px] font-semibold text-ink">{sprint.name}</span>
        <Tag tone={sprint.status === "active" ? "green" : "gray"} size="sm">
          {t(`sprints.status.${sprint.status}`)}
        </Tag>
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
            <Button variant="secondary" size="sm"
              onClick={() => startSprint(sprint.id)}
              disabled={hasActiveSprint ? t("sprints.activeExists") : false}
              className="[&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
            >
              {t("sprints.begin")}
            </Button>
          )}
          {manage && sprint.status === "active" && (
            <Button variant="primary" size="sm"
              onClick={() => {
                if (window.confirm(t("sprints.completeConfirm", { name: sprint.name }))) completeSprint(sprint.id);
              }}
              className="[&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
            >
              <IcCheck size={12} /> {t("sprints.complete")}
            </Button>
          )}
        </div>
      </div>
      {sprint.goal && <p className="border-b border-linesoft px-3.5 py-2 text-[12px] text-sub">{sprint.goal}</p>}
      <DropZone
        onDropIssue={(id) => setIssueSprint(id, sprint.id)}
        blocked={sprint.status === "completed" ? { reason: t("sprints.completedNoDrop"), onBlockedDrop: (r) => toast("info", r) } : undefined}
        className="min-h-[44px] transition-colors"
      >
        {issues.length === 0 ? (
          <p className="px-3.5 py-3 text-[12px] text-faint">{t(sprint.status === "completed" ? "sprints.completedEmpty" : "sprints.dropHere")}</p>
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
    // Модуль выключен администратором — на этом экране действия нет ни у кого,
    // включая роли, у которых иначе есть manageSprints (D3/ТЗ 5.11 п.4).
    return <EmptyState icon={<IcFlag size={22} tone="amber" />} title={t("sprints.disabledTitle")} sub={t("sprints.disabledSub")} />;
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
              <ScreenSkeletonRow />
              <ScreenSkeletonRow />
              <ScreenSkeletonRow />
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
            <Button variant="primary" size="sm"
              onClick={() => setShowCreate(true)}
              className="[&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0"
            >
              <IcPlus size={13} /> {t("sprints.sprint")}
            </Button>
          )}
        </div>
        {!data.issuesComplete && <p className="mb-2 text-[11.5px] text-faint">{t("sprints.loadingIssues")}</p>}
        {sortedSprints.length === 0 ? (
          <EmptyState
            icon={<IcFlag size={22} tone="amber" />}
            title={t("sprints.emptyTitle")}
            sub={t("sprints.emptySub")}
            action={can("manageSprints") ? <Button size="sm" onClick={() => setShowCreate(true)}>{t("sprints.new")}</Button> : undefined}
          />
        ) : (
          <div className="space-y-3 pb-4">
            {sortedSprints.map((s) => (
              <SprintSection key={s.id} sprint={s} issues={issuesBySprintId.get(s.id) ?? []} hasActiveSprint={hasActiveSprint} />
            ))}
          </div>
        )}
      </div>

      <CreateSprintModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
