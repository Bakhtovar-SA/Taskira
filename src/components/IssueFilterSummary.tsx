import type { ReactNode } from "react";
import { useStore } from "../store";
import { useT, type TKey } from "../i18n";
import { NO_ONE } from "../boardFilters";
import { EMPTY_FILTERS, customFieldCondition, type FilterState } from "../router";
import { workflowStatusName } from "../workflowStatus";

/** Same applied conditions for both representations, including conditions without visible controls on the board. */
export function IssueFilterSummary({ filters: f, children }: { filters: Partial<FilterState>; children?: ReactNode }) {
  const { data, idx } = useStore();
  const { t } = useT();
  const status = data.workflow.statuses.find(s => s.id === f.status);
  const custom = customFieldCondition({ ...EMPTY_FILTERS, ...f });
  const items: [string, string | undefined][] = [
    ["status", f.status && `${t("field.status")}: ${status ? workflowStatusName(status, t) : f.status}`],
    ["assignee", f.assignee && `${t("field.assignee")}: ${f.assignee === NO_ONE ? t("board.filterConflict") : f.assignee === "none" ? t("createIssue.unassigned") : idx.users.get(f.assignee)?.name ?? f.assignee}`],
    ["type", f.type && `${t("field.type")}: ${t(`issueType.${f.type}` as TKey)}`],
    ["priority", f.priority && `${t("field.priority")}: ${t(`priority.${f.priority}` as TKey)}`],
    ["label", f.label && `${t("field.labels")}: ${f.label}`],
    ["due", (f.dueFrom || f.dueTo) && `${t("field.dueDate")}: ${f.dueFrom || "…"} — ${f.dueTo || "…"}`],
    ["sprint", f.sprintId && (data.sprints.find(s => s.id === f.sprintId)?.name ?? f.sprintId)],
    ["custom", custom && `${data.customFields.find(field => field.id === f.cf)?.name ?? f.cf}: ${f.cfEmpty ? t("backlog.cf.empty") : f.cfValue || [f.cfFrom, f.cfTo].filter(Boolean).join(" — ")}` || undefined],
  ];
  return <div className="active-filter-summary mt-2 flex flex-wrap items-center gap-2 text-[13px] text-sub" role="status">
    {items.filter(([, text]) => !!text).map(([id, text]) => <span key={id}>{text}</span>)}
    {children}
  </div>;
}
