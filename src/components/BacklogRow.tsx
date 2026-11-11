/** Заголовок колонки и строка списка задач. Вынесено из Backlog.tsx без изменения поведения. */
import { Flash } from "../Flash";
import { cssVars } from "../cssVars";
import { localToday } from "../calendarLayout";
import AssigneePicker from "./AssigneePicker";
import { useStore } from "../store";
import { canTransition, fmtDate, relTime } from "../store/mappers";
import type { Issue } from "../types";
import { type IssueEpic } from "../api";
import { DueRing, IcChevD, IcDots, IcFilter, IcTrash, PriorityIcon, StatusGlyph, TypeIcon } from "../icons";
import { directionColor, labelTone } from "../ui";
import { RepeatMark } from "./RepeatMark";
import { UserAvatarGroup } from "./UserAvatar";
import { Button } from "../ds/Button";
import { Checkbox } from "../ds/Field";
import { Tag } from "../ds/Display";
import { Menu, Popover } from "../ds/Overlay";
import { useT } from "../i18n";
import { statusTone, workflowStatusName } from "../workflowStatus";
import { pathForIssue } from "../router";
import { COLUMNS, LEFT, type ColumnId, type SortKey } from "../listColumns";

export function HeadCell({ id, sortKey, sortDir, onSort, compact }: { id: ColumnId | "key"; sortKey: SortKey; sortDir: "asc" | "desc"; onSort: (k: SortKey) => void; compact?: boolean }) {
  const { t } = useT();
  const def = id === "key" ? { label: "backlog.sort.key" as const, sort: "key" as SortKey } : COLUMNS.find((c) => c.id === id)!;
  const label = t(def.label);
  const on = def.sort && def.sort === sortKey;
  const text = compact ? <span className="sr-only">{label}</span> : <span className="truncate" title={label}>{label}</span>;
  return (
    <span role="columnheader" data-col={id} aria-sort={on ? (sortDir === "asc" ? "ascending" : "descending") : undefined} className="flex min-w-0 items-center">
      {def.sort ? (
        <button type="button" onClick={() => onSort(def.sort!)} title={label} className={`ds-focus -mx-1 flex min-w-0 items-center gap-1 rounded px-1 hover:text-ink ${on ? "text-ink" : ""}`}>
          {compact && !on ? <IcFilter size={13} className="shrink-0 opacity-60" /> : null}
          {text}
          {on && <IcChevD size={12} className={`shrink-0 ${sortDir === "asc" ? "rotate-180" : ""}`} />}
        </button>
      ) : (
        text
      )}
    </span>
  );
}

export function Row({
  issue,
  epic,
  cols,
  selectable,
  selected,
  onToggleSelect,
  onDelete,
}: {
  issue: Issue;
  epic: Pick<IssueEpic, "id" | "title" | "color"> | undefined;
  cols: ColumnId[];
  selectable: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onDelete: (issue: Issue) => void;
}) {
  const { t, lang } = useT();
  const { data, idx, me, openIssue, updateIssue, moveStatus, can } = useStore();
  // Ассоциированные сущности ищем по индексам из контекста, а не линейным
  // проходом по массивам в каждой строке списка (аудит PERF-02).
  const assignees = issue.assigneeIds.map((id) => idx.users.get(id)).filter((u): u is NonNullable<typeof u> => !!u);
  const status = idx.statuses.get(issue.statusId);
  const today = localToday();
  const overdue = !!issue.dueDate && status?.category !== "done" && issue.dueDate < today;
  const days = issue.dueDate ? Math.round((Date.parse(issue.dueDate) - Date.parse(today)) / 864e5) : Infinity;
  const urgency = status?.category === "done" ? "done" : overdue ? "late" : days <= 3 ? "soon" : "normal";
  const statusAction = (iconOnly = false) => status && (can("transition", issue) ? <Menu
    label={t("field.status")} placement="bottom-end"
    trigger={p => <Button {...p} variant="ghost" size="sm" className="list-status-action" aria-label={t("backlog.changeStatus", { key: issue.key })}
      iconLeft={<StatusGlyph category={status.category} size={16} />}>{iconOnly ? <IcChevD size={12} /> : workflowStatusName(status, t)}</Button>}
    items={data.workflow.statuses.map(target => ({ id: target.id, label: workflowStatusName(target, t), icon: <StatusGlyph category={target.category} size={16} />,
      disabled: !canTransition(data.workflow, issue.statusId, target.id), onSelect: () => moveStatus(issue.id, target.id, null) }))} /> : <Tag size="sm" tone={statusTone(status.category)} dot strong>{workflowStatusName(status, t)}</Tag>);

  const cell = (id: ColumnId) => {
    switch (id) {
      case "priority":
        return <PriorityIcon p={issue.priorityId} size={16} />;
      case "type":
        return <TypeIcon type={issue.typeId} size={16} />;
      case "direction":
        return epic ? (
          <span className="list-direction">
            <i ref={cssVars({ "--direction-color": directionColor(epic.id, epic.color) })} />
            <span className="truncate">{epic.title}</span>
          </span>
        ) : null;
      case "labels":
        return (
          <span className="flex min-w-0 gap-1 overflow-hidden">
            {issue.labels.slice(0, 2).map((l) => (
              <Tag key={l} size="sm" tone={labelTone(l)}>
                {l}
              </Tag>
            ))}
            {issue.labels.length > 2 && <span className="text-[12.5px] tabular text-faint">+{issue.labels.length - 2}</span>}
          </span>
        );
      case "due": {
        const repeat = issue.repeat && <RepeatMark repeat={issue.repeat} solo={!issue.dueDate} className="list-repeat" />;
        // Повторяющаяся задача без срока показывает расписание на месте срока; со сроком — значок рядом.
        return issue.dueDate || repeat ? (
          <span className="flex min-w-0 items-center gap-2">
            {issue.dueDate && <span className="list-due tabular" data-urgency={urgency} title={overdue ? t("board.quickChip.overdue") : undefined}>
              <DueRing due={issue.dueDate} today={today} done={status?.category === "done"} />
              {fmtDate(issue.dueDate, lang)}
            </span>}
            {repeat}
          </span>
        ) : null;
      }
      case "status":
        return <Flash value={issue.statusId} className="inline-flex">{statusAction()}</Flash>;
      case "assignee":
        return can("edit", issue) ? <Popover label={t("field.assignee")} placement="bottom-end" className="w-[260px]"
          trigger={p => <button {...p} type="button" className="list-assignee-action ds-focus" aria-label={t("backlog.changeAssignees", { key: issue.key })}><UserAvatarGroup users={assignees} size={22} /></button>}>
          <AssigneePicker data={data} selected={issue.assigneeIds} onChange={ids => updateIssue(issue.id, { assigneeIds: ids })} selfOnlyId={me.accessRole === "employee" ? me.id : undefined} />
        </Popover> : <UserAvatarGroup users={assignees} size={22} interactive />;
      case "updated":
        return <span className="text-[13px] tabular text-faint">{relTime(issue.updatedAt, lang)}</span>;
    }
  };

  return (
    <div
      role="row"
      onClick={() => openIssue(issue.id)}
      data-issue-id={issue.id}
      data-done={status?.category === "done" || undefined}
      aria-selected={selectable ? selected : undefined}
      className={`list-grid group list-row cursor-pointer items-center gap-x-3 border-b border-linesoft/80 px-4 transition-colors last:border-0 hover:bg-hover/60 ${selected ? "bg-accentsoft/50" : "bg-panel"}`}
    >
      {/* A reserved checkbox slot avoids row reflow on hover, focus and selection. */}
      {selectable && (
        <span role="cell" data-col="select" className="list-select flex" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onChange={() => onToggleSelect(issue.id)} label={t("backlog.selectRow", { key: issue.key })} labelHidden />
        </span>
      )}
      {LEFT.filter((id) => cols.includes(id)).map((id) => (
        <span key={id} role="cell" data-col={id} className="flex min-w-0 items-center">
          {cell(id)}
        </span>
      ))}
      <span role="cell" data-col="key" className="truncate font-mono text-[13px] tabular text-faint">
        {issue.key}
      </span>
      <span role="cell" data-col="title" className="list-title min-w-0 text-[15px] font-semibold text-ink">
        {/* На телефоне колонки ключа нет — ключ мелко над названием. */}
        <span aria-hidden className="block truncate font-mono text-[12px] font-normal leading-tight tabular text-faint sm:hidden">
          {issue.key}
        </span>
        <a href={pathForIssue(data.project.key, issue.key)} className="ds-focus block rounded hover:text-accenttext" title={issue.title}
          onClick={(e) => {
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault(); openIssue(issue.id);
          }}>{issue.title}</a>
        <span className="list-mobile-meta">
        {cols.includes("priority") && <span className="list-mobile-priority">{cell("priority")}</span>}
        {cols.includes("due") && issue.dueDate && cell("due")}
      </span>
      {!cols.includes("status") && can("transition", issue) && <span className="list-inline-status" onClick={e => e.stopPropagation()}>{statusAction(true)}</span>}
      </span>
      {COLUMNS.filter((c) => !LEFT.includes(c.id) && cols.includes(c.id)).map((c) => (
        <span key={c.id} role="cell" data-col={c.id} className="flex min-w-0 items-center" onClick={c.id === "status" || c.id === "assignee" ? e => e.stopPropagation() : undefined}>
          {cell(c.id)}
        </span>
      ))}
      {!cols.includes("status") && <span role="cell" data-col="status" className="list-mobile-status" onClick={e => e.stopPropagation()}>{statusAction()}</span>}
      <span role="cell" data-col="actions" className="flex justify-end" onClick={(e) => e.stopPropagation()}>
        <Menu
          label={t("common.actions")}
          placement="bottom-end"
          trigger={(p) => (
            <button
              {...p}
              type="button"
              className="list-actions ds-focus flex h-8 w-8 items-center justify-center rounded text-faint opacity-0 transition-all hover:bg-todosoft hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
              aria-label={t("common.actions")}
            >
              <IcDots size={16} />
            </button>
          )}
          items={[
            { id: "open", label: t("backlog.openIssue"), onSelect: () => openIssue(issue.id) },
            ...(can("delete", issue)
              ? [
                  { kind: "sep" as const, id: "sep" },
                  { id: "delete", label: t("common.delete"), icon: <IcTrash size={15} />, danger: true, onSelect: () => onDelete(issue) },
                ]
              : []),
          ]}
        />
      </span>
    </div>
  );
}
