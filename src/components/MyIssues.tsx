/** «Мои задачи» — общие куски Главной и страницы `/my-issues` (ADR-0013 §1): строка задачи
 *  и полоса фокуса. Данные — `data.assignedToMe` (GET /api/issues/assigned-to-me, по всем
 *  видимым проектам). */
import { useMemo, useRef } from "react";
import type { lookOf } from "../projectLook";
import { fmtDate } from "../store/mappers";
import type { AssignedIssue } from "../types";
import { DueRing, PriorityIcon, StatusGlyph, TypeIcon } from "../icons";
import { ProjectMark } from "../ui";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";

const today = () => new Date().toISOString().slice(0, 10);
const isOverdue = (i: AssignedIssue) => !!i.dueDate && i.statusCategory !== "done" && i.dueDate < today();

export type Focus = "all" | "overdue" | "week" | "inprogress";

/** Срок в ближайшие 7 дней (включая сегодня), не просрочен и не закрыт. */
const isThisWeek = (i: AssignedIssue) => {
  if (!i.dueDate || i.statusCategory === "done") return false;
  const d = (Date.parse(i.dueDate) - Date.parse(today())) / 864e5;
  return d >= 0 && d <= 7;
};
export const FOCUS_TEST: Record<Focus, (i: AssignedIssue) => boolean> = {
  all: () => true,
  overdue: isOverdue,
  week: isThisWeek,
  inprogress: (i) => i.statusCategory === "inprogress",
};

/** Срочность (ТЗ 5.12 b: «мои задачи по срочности»): просрочено → сегодня → неделя → позже → без срока;
 *  внутри группы — по сроку, затем по приоритету. Закрытые — в конце без срока. */
export type Urgency = "overdue" | "today" | "week" | "later" | "nodate";
export const URGENCY_ORDER: Urgency[] = ["overdue", "today", "week", "later", "nodate"];
const PRIO_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export function urgencyOf(i: AssignedIssue, now = today()): Urgency {
  if (!i.dueDate || i.statusCategory === "done") return "nodate";
  if (i.dueDate < now) return "overdue";
  if (i.dueDate === now) return "today";
  return (Date.parse(i.dueDate) - Date.parse(now)) / 864e5 <= 7 ? "week" : "later";
}
export function groupByUrgency(items: AssignedIssue[], now = today()): { id: Urgency; items: AssignedIssue[] }[] {
  const by = new Map<Urgency, AssignedIssue[]>();
  for (const i of items) {
    const u = urgencyOf(i, now);
    by.set(u, [...(by.get(u) ?? []), i]);
  }
  const cmp = (a: AssignedIssue, b: AssignedIssue) =>
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (PRIO_RANK[a.priorityId] ?? 9) - (PRIO_RANK[b.priorityId] ?? 9);
  return URGENCY_ORDER.filter((u) => by.has(u)).map((u) => ({ id: u, items: by.get(u)!.sort(cmp) }));
}

export function useFocusCounts(items: AssignedIssue[]) {
  return useMemo(
    () => Object.fromEntries((Object.keys(FOCUS_TEST) as Focus[]).map((f) => [f, items.filter(FOCUS_TEST[f]).length])) as Record<Focus, number>,
    [items],
  );
}

/** Полоса фокуса вместо плашек-счётчиков: каждая цифра — фильтр списка ниже
 *  (анти-список трека: «большое число + подпись» только если оно что-то открывает). */
export function FocusChips({ focus, onFocus, counts, className = "" }: { focus: Focus; onFocus: (f: Focus) => void; counts: Record<Focus, number>; className?: string }) {
  const { t } = useT();
  const list = useRef<HTMLDivElement>(null);
  const order: Focus[] = ["all", "overdue", "week", "inprogress"];
  return (
    <div ref={list} role="tablist" aria-label={t("home.myTasks")} className={`flex flex-wrap gap-2 ${className}`}>
      {(
        [
          ["all", "home.focus.all", "violet"],
          ["overdue", "home.focus.overdue", "red"],
          ["week", "home.focus.week", "amber"],
          ["inprogress", "home.focus.inprogress", "sky"],
        ] as const
      ).map(([id, key, tone]) => {
        const on = focus === id;
        const n = counts[id];
        return (
          <button
            key={id}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onFocus(id)}
            onKeyDown={(e) => {
              const i = order.indexOf(id);
              const next = e.key === "ArrowRight" ? (i + 1) % order.length : e.key === "ArrowLeft" ? (i + order.length - 1) % order.length : e.key === "Home" ? 0 : e.key === "End" ? order.length - 1 : null;
              if (next === null) return;
              e.preventDefault();
              onFocus(order[next]);
              list.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
            }}
            className={`ds-focus focus-chip tk-tone-${tone} ${on ? "is-on" : ""} flex h-10 items-center gap-2.5 rounded-xl pl-3 pr-3.5 text-[14px] font-medium transition-[background-color,box-shadow,color] duration-150`}
          >
            <span className={`font-disp text-[18px] font-semibold tabular leading-none ${id === "overdue" && n > 0 ? "text-[var(--status-danger-fg)]" : on ? "text-current" : "text-ink"}`}>{n}</span>
            <span className={on ? "text-ink" : "text-sub"}>{t(key)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TaskRow({ issue, onOpen, showProject = true, look }: { issue: AssignedIssue; onOpen: () => void; showProject?: boolean; look?: ReturnType<typeof lookOf> }) {
  const { t, lang } = useT();
  const cat = issue.statusCategory as "todo" | "inprogress" | "done";
  return (
    <button
      onClick={onOpen}
      className="group flex h-11 w-full items-center gap-3 border-b border-linesoft px-3.5 text-left transition-colors last:border-0 hover:bg-hover/60"
    >
      <span className="shrink-0" title={t(`priority.${issue.priorityId}`)}>
        <PriorityIcon p={issue.priorityId} size={16} />
      </span>
      <span className="w-[68px] shrink-0 font-mono text-[13px] text-faint">{issue.key}</span>
      <span className="shrink-0" title={workflowStatusName({ name: issue.statusName }, t)}>
        <StatusGlyph category={cat} size={16} />
      </span>
      {issue.typeId !== "task" && (
        <span className="shrink-0" title={t(`issueType.${issue.typeId}`)}>
          <TypeIcon type={issue.typeId} size={16} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-ink">{issue.title}</span>
      {issue.dueDate && (
        <span className={`hidden shrink-0 items-center gap-1 text-[13px] tabular md:inline-flex ${isOverdue(issue) ? "font-medium text-[var(--status-danger-fg)]" : "text-faint"}`}>
          <DueRing due={issue.dueDate} today={today()} done={cat === "done"} />
          {fmtDate(issue.dueDate, lang)}
        </span>
      )}
      {showProject && (
        <span className="hidden shrink-0 sm:inline-flex" title={issue.projectName}>
          <ProjectMark projectKey={issue.projectKey} {...look} size={20} />
        </span>
      )}
    </button>
  );
}
