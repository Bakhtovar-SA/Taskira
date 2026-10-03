import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { Avatar, Button, Checkbox, DatePicker, IconButton, Input, Menu, Popover, Tabs, Tooltip } from "../ds";
import { IcChevR, IcPlus, IcX, TypeIcon } from "../icons";
import type { Issue, StatusCategory, User } from "../types";
import { TYPE_ORDER } from "../types";
import { useDebounced, useIssueSet, useIssuesRevision, useOnRevision } from "../issuePages";
import { dateOf, hiddenCount, issuesByDay, localToday, movePeriod, periodDays, shiftDay, type CalendarMode } from "../calendarLayout";
import { denialText } from "../permissions";
import "./calendar.css";

const EMPTY: Issue[] = [];
type Actions = { open: (id: string) => void; move: (id: string, dueDate: string | null) => void; create: (dueDate: string) => void };
const Plate = memo(function Plate({ issue, category, person, editable, reason, actions, today, nav = true }: {
  issue: Issue; category: StatusCategory; person?: User; editable: boolean; reason: string; actions: Actions; today: string; nav?: boolean;
}) {
  const { t, lang } = useT();
  const [moving, setMoving] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const stopMoving = () => { setMoving(false); requestAnimationFrame(() => buttonRef.current?.focus()); };
  const overdue = category !== "done" && !!issue.dueDate && issue.dueDate < today;
  return <div className="calendar-plate-wrap">
    <Tooltip label={editable ? `${issue.key} ${issue.title}` : reason}>
      <button ref={buttonRef} type="button" className="calendar-plate ds-focus" data-category={category} data-overdue={overdue || undefined}
        data-issue-id={nav ? issue.id : undefined} draggable={editable}
        onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData("application/x-taskira-issue", issue.id); e.dataTransfer.effectAllowed = "move"; }}
        onClick={() => actions.open(issue.id)} onKeyDown={e => {
          if ((e.key.toLowerCase() === "m" || e.key.toLowerCase() === "ь") && editable) { e.preventDefault(); e.stopPropagation(); setMoving(true); }
        }}>
        <TypeIcon type={issue.typeId} size={13} />
        <span className="shrink-0 text-[10px]">{issue.key}</span>
        <span className="calendar-plate-title">{issue.title}</span>
        {person && <Avatar person={person} size={20} />}
      </button>
    </Tooltip>
    {moving && <DatePicker label={t("field.dueDate")} value={issue.dueDate ?? null} lang={lang} open onOpenChange={v => { if (!v) stopMoving(); }}
      onChange={v => { actions.move(issue.id, v); stopMoving(); }} />}
  </div>;
});

type CellProps = { day: string; date: string; mode: CalendarMode; today: string; items: Issue[]; focused: boolean;
  categories: Map<string, StatusCategory>; users: Map<string, User>; editable: Set<string>; reasons: Map<string, string>; actions: Actions; onDayKey: (e: KeyboardEvent, day: string) => void; onFocusDay: (day: string) => void };
const Day = memo(function Day({ day, date, mode, today, items, focused, categories, users, editable, reasons, actions, onDayKey, onFocusDay }: CellProps) {
  const { t, lang } = useT();
  const weekend = dateOf(day).getDay() % 6 === 0;
  const plate = (i: Issue, nav = true) => <Plate key={i.id} issue={i} category={categories.get(i.statusId) ?? "todo"} person={users.get(i.assigneeIds[0])}
    editable={editable.has(i.id)} reason={reasons.get(i.id) ?? ""} actions={actions} today={today} nav={nav} />;
  return <div role="gridcell" className="calendar-day ds-focus" data-day={day} data-today={day === today || undefined}
    data-outside={mode === "month" && day.slice(0, 7) !== date.slice(0, 7) || undefined} data-weekend={weekend || undefined}
    tabIndex={focused ? 0 : -1} aria-label={dateOf(day).toLocaleDateString(lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "long", year: "numeric" })}
    onFocus={e => { if (e.target === e.currentTarget) onFocusDay(day); }} onKeyDown={e => { if (e.target === e.currentTarget) onDayKey(e, day); }}
    onDragOver={e => { if (e.dataTransfer.types.includes("application/x-taskira-issue")) e.preventDefault(); }}
    onDrop={e => { e.preventDefault(); actions.move(e.dataTransfer.getData("application/x-taskira-issue"), day); }}>
    <div className="calendar-day-head"><span className="calendar-day-number">{Number(day.slice(-2))}</span>
      <span className="calendar-add"><IconButton label={t("calendar.add")} size="sm" onClick={() => actions.create(day)}><IcPlus size={13} /></IconButton></span>
    </div>
    <div className="calendar-day-issues">
      {items.map((i, index) => <div key={i.id} hidden={mode === "month" && index >= 3}>{plate(i)}</div>)}
    </div>
    {hiddenCount(items.length, mode) > 0 && <Popover label={t("calendar.dayIssues")} trigger={p => <Button {...p} variant="ghost" size="sm">{t("calendar.more", { n: hiddenCount(items.length, mode) })}</Button>}>
      <div className="max-h-80 space-y-1 overflow-y-auto p-1">{items.map(i => plate(i, false))}</div>
    </Popover>}
  </div>;
});

export default function CalendarView() {
  const { t, lang, errText } = useT();
  const store = useStore();
  const { data, idx, can, me } = store;
  const latest = useRef(store); latest.current = store;
  const today = localToday();
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<CalendarMode>(() => localStorage.getItem("taskira.calendar.mode") === "week" ? "week" : "month");
  const [focusDay, setFocusDay] = useState(today);
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 250);
  const [assignee, setAssignee] = useState("");
  const [type, setType] = useState("");
  const [closed, setClosed] = useState(false);
  const [unscheduled, setUnscheduled] = useState(false);
  const days = useMemo(() => periodDays(date, mode), [date, mode]);
  const filters = useMemo(() => ({ q: q || undefined, assignee: assignee || undefined, type: type || undefined, closed: closed ? "hide" as const : undefined }), [q, assignee, type, closed]);
  const range = useIssueSet({ projectId: data.currentProjectId, filters: { ...filters, dueFrom: days[0], dueTo: days[days.length - 1] }, sort: "due", dir: "asc" }, { withCounts: false });
  const without = useIssueSet(unscheduled ? { projectId: data.currentProjectId, filters: { ...filters, dueEmpty: "1" }, sort: "priority", dir: "asc" } : null, { withCounts: false });
  const revision = useIssuesRevision();
  useOnRevision(revision, () => { range.revalidate(); without.revalidate(); });
  useEffect(() => {
    if (!range.loading && !range.loadingMore && !range.error && range.hasMore && range.items.length < 500) range.loadMore();
  }, [range.loading, range.loadingMore, range.error, range.hasMore, range.items.length, range.loadMore]);
  const items = useMemo(() => range.items.slice(0, 500), [range.items]);
  const grouped = useMemo(() => issuesByDay(items), [items]);
  const categories = useMemo(() => new Map(data.workflow.statuses.map(s => [s.id, s.category])), [data.workflow.statuses]);
  const permission = useMemo(() => {
    const editable = new Set<string>(); const reasons = new Map<string, string>();
    for (const i of [...items, ...without.items]) {
      if (can("edit", i)) editable.add(i.id);
      else reasons.set(i.id, denialText(me, "edit", i, t));
    }
    return { editable, reasons };
  }, [items, without.items, can, me, t]);
  const loaded = useRef(new Map<string, Issue>());
  loaded.current = new Map([...items, ...without.items].map(i => [i.id, i]));
  const actions = useMemo<Actions>(() => ({
    open: id => latest.current.openIssue(id, "panel"),
    move: (id, dueDate) => { const i = loaded.current.get(id); if (i && latest.current.can("edit", i)) latest.current.updateIssue(id, { dueDate }); },
    create: dueDate => { if (latest.current.can("create")) latest.current.openCreate({ dueDate }); },
  }), []);
  const focus = useCallback((day: string) => {
    setFocusDay(day);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus());
  }, []);
  const onDayKey = useCallback((e: KeyboardEvent, day: string) => {
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in deltas) {
      e.preventDefault(); const next = shiftDay(day, deltas[e.key]);
      if (next < days[0] || next > days[days.length - 1]) setDate(next);
      focus(next);
    } else if (e.key === "PageUp" || e.key === "PageDown") { e.preventDefault(); const next = movePeriod(day, mode, e.key === "PageUp" ? -1 : 1); setDate(next); focus(next); }
    else if (e.key.toLowerCase() === "t" || e.key.toLowerCase() === "е") { e.preventDefault(); setDate(today); focus(today); }
    else if (e.key === "Enter") { e.preventDefault(); actions.create(day); }
  }, [days, focus, mode, today, actions]);
  const period = mode === "month" ? dateOf(date).toLocaleDateString(lang === "en" ? "en-GB" : "ru-RU", { month: "long", year: "numeric" }) : `${dateOf(days[0]).toLocaleDateString(lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "long" })} – ${dateOf(days[6]).toLocaleDateString(lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "long", year: "numeric" })}`;
  const activeDay = days.includes(focusDay) ? focusDay : days[0];
  return <div className="calendar-view" data-mode={mode}>
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <Button size="sm" onClick={() => { setDate(today); setFocusDay(today); }}>{t("calendar.today")}</Button>
      <IconButton label={t("calendar.previous")} onClick={() => setDate(d => movePeriod(d, mode, -1))}><IcChevR className="rotate-180" /></IconButton>
      <IconButton label={t("calendar.next")} onClick={() => setDate(d => movePeriod(d, mode, 1))}><IcChevR /></IconButton>
      <h1 className="mr-auto text-base font-semibold">{period}</h1>
      <Tabs mode="filter" label={t("calendar.scale")} value={mode} onChange={v => { setMode(v); localStorage.setItem("taskira.calendar.mode", v); }} items={[{ id: "month", label: t("calendar.month") }, { id: "week", label: t("calendar.week") }]} />
    </div>
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      <Input aria-label={t("calendar.search")} value={search} maxLength={120} placeholder={t("calendar.search")} onChange={e => setSearch(e.target.value)} />
      <Menu label={t("calendar.assignee")} trigger={p => <Button {...p} size="sm">{data.users.find(u => u.id === assignee)?.name ?? t("calendar.assignee")}</Button>}
        items={[{ id: "all", label: t("calendar.all"), onSelect: () => setAssignee("") }, { id: "none", label: t("calendar.unassigned"), onSelect: () => setAssignee("none") }, ...data.users.map(u => ({ id: u.id, label: u.name, onSelect: () => setAssignee(u.id) }))]} />
      <Menu label={t("calendar.type")} trigger={p => <Button {...p} size="sm">{type ? t(`issueType.${type as "task" | "bug" | "request"}`) : t("calendar.type")}</Button>}
        items={[{ id: "all", label: t("calendar.all"), onSelect: () => setType("") }, ...TYPE_ORDER.map(v => ({ id: v, label: t(`issueType.${v}`), onSelect: () => setType(v) }))]} />
      <Checkbox checked={closed} onChange={setClosed} label={t("calendar.hideClosed")} />
      <Button size="sm" onClick={() => setUnscheduled(v => !v)}>{t("calendar.unscheduled")}</Button>
    </div>
    {range.error && <p role="alert" className="px-4 text-danger">{errText(range.error, t("calendar.loadFailed"))}<Button onClick={range.reload}>{t("common.retry")}</Button></p>}
    {items.length >= 500 && range.hasMore && <p className="px-4 text-sub">{t("calendar.limit")}</p>}
    <div className="flex min-h-0 flex-1">
    <div className="calendar-scroll" aria-busy={range.loading || range.loadingMore}>
      <div role="grid" aria-label={t("calendar.title")} className="calendar-grid">
        <div role="row" className="calendar-weekdays">{days.slice(0, 7).map(d => <div role="columnheader" key={d}>{dateOf(d).toLocaleDateString(lang === "en" ? "en-GB" : "ru-RU", { weekday: "short" })}</div>)}</div>
        {Array.from({ length: days.length / 7 }, (_, row) => <div role="row" className="calendar-row" key={row}>
          {days.slice(row * 7, row * 7 + 7).map(day => <Day key={day} day={day} date={date} mode={mode} today={today} items={grouped.get(day) ?? EMPTY} focused={activeDay === day}
            categories={categories} users={idx.users} {...permission} actions={actions} onDayKey={onDayKey} onFocusDay={setFocusDay} />)}
        </div>)}
      </div>
    </div>
    {unscheduled && <aside aria-label={t("calendar.unscheduled")} className="w-72 shrink-0 overflow-y-auto border-l border-line p-3">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{t("calendar.unscheduled")}</h2><IconButton label={t("common.close")} onClick={() => setUnscheduled(false)}><IcX /></IconButton></div>
      <div className="min-h-40 space-y-2" onDragOver={e => { if (e.dataTransfer.types.includes("application/x-taskira-issue")) e.preventDefault(); }}
        onDrop={e => { e.preventDefault(); actions.move(e.dataTransfer.getData("application/x-taskira-issue"), null); }}>
        <p className="text-sm text-sub">{t("calendar.dropUnscheduled")}</p>
        {without.items.map(i => <Plate key={i.id} issue={i} category={categories.get(i.statusId) ?? "todo"} person={idx.users.get(i.assigneeIds[0])}
          editable={permission.editable.has(i.id)} reason={permission.reasons.get(i.id) ?? ""} actions={actions} today={today} />)}
        {without.error && <p role="alert">{errText(without.error, t("calendar.loadFailed"))}</p>}
        {without.hasMore && <Button loading={without.loadingMore} onClick={without.loadMore}>{t("calendar.loadMore")}</Button>}
      </div>
    </aside>}
    </div>
  </div>;
}
