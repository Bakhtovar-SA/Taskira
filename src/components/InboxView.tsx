import { IconButton } from "../ds/Button";
import { PersonAvatar } from "./settings/parts";
/** «Входящие» (ADR-0013 §1, `/inbox`) — полная страница ленты уведомлений; колокол в шапке
 *  остаётся быстрым просмотром той же ленты. Данные — внешний стор уведомлений (ADR-0011). */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createEnterTracker, type EnterTracker } from "../listEnter";
import { createRowMotion, type RowMotion } from "../listExit";
import { CountUp } from "../CountUp";
import { lookOf } from "../projectLook";
import { useNotifications, useStore } from "../store";
import { relTime } from "../store/mappers";
import type { NotificationT } from "../types";
import { IcCheck, IcInbox, IcX } from "../icons";
import { ProjectMark } from "../ui";
import { Button, EmptyState } from "../ds";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";
import { NOTIF_VERB } from "./Topbar";

type Filter = "all" | "unread";
type DayGroup = "today" | "yesterday" | "earlier";
/** Строка ленты: последнее событие задачи за день и остальные события той же задачи. */
type Thread = { head: NotificationT; rest: NotificationT[] };
const ids = (t: Thread) => [t.head, ...t.rest].map((n) => n.id);
const unreadIds = (t: Thread) => [t.head, ...t.rest].filter((n) => !n.read).map((n) => n.id);

const dayGroup = (ms: number): DayGroup => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (ms >= start.getTime()) return "today";
  return ms >= start.getTime() - 864e5 ? "yesterday" : "earlier";
};

export default function InboxView() {
  const { t } = useT();
  const { data, openIssue, switchProject, refreshNotifications, markNotificationsRead, dismissNotifications } = useStore();
  const { notifications, unreadCount } = useNotifications();
  const [filter, setFilter] = useState<Filter>("all");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  const filtered = useMemo(() => (filter === "unread" ? notifications.filter((n) => !n.read) : notifications), [notifications, filter]);
  // ТЗ 5.12 g, как во входящих Linear: события одной задачи за день — одна строка (последнее событие + «ещё N»).
  const groups = useMemo(() => {
    const out: { id: DayGroup; items: Thread[] }[] = [];
    for (const n of filtered) {
      const g = dayGroup(n.createdAt);
      let day = out[out.length - 1];
      if (day?.id !== g) out.push((day = { id: g, items: [] }));
      const same = n.issueId ? day.items.find((x) => x.head.issueId === n.issueId) : undefined;
      if (same) same.rest.push(n);
      else day.items.push({ head: n, rest: [] });
    }
    return out;
  }, [filtered]);
  const list = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const projectKey = useMemo(() => new Map(data.projects.map((p) => [p.id, p.key])), [data.projects]);
  const cur = Math.min(cursor, Math.max(0, list.length - 1));
  // Новое событие во время просмотра въезжает пружиной; первый показ, смена фильтра и первая загрузка в пустой
  // список (у стора уведомлений нет признака загрузки) — без движения (ADR-0035).
  const enterRows = useRef<EnterTracker | null>(null);
  const rowMotion = useRef<RowMotion | null>(null);
  useEffect(() => () => rowMotion.current?.dispose(), []);
  const enterPrev = useRef<{ filter: Filter; n: number } | null>(null);
  useLayoutEffect(() => {
    enterRows.current ??= createEnterTracker();
    const baseline = !enterPrev.current || enterPrev.current.filter !== filter || enterPrev.current.n === 0;
    enterPrev.current = { filter, n: list.length };
    const rowIds = list.map(th => th.head.id);
    const find = (id: string) => listRef.current?.querySelector<HTMLElement>(`[data-enter-id="${CSS.escape(id)}"]`);
    rowMotion.current ??= createRowMotion();
    rowMotion.current(listRef.current, rowIds, find, baseline);
    enterRows.current(rowIds, find, baseline);
  }, [list, filter]);
  useLayoutEffect(() => {
    // Count-only refreshes do not need another geometry pass.
    // After the final row or a disappearing toolbar action, keep a live keyboard target.
    if (pendingFocus.current && !pendingFocus.current.isConnected) {
      if (document.activeElement === document.body) {
        const target = listRef.current?.querySelector<HTMLElement>("[data-enter-id] button") ??
          tabsRef.current?.querySelector<HTMLElement>('button[aria-selected="true"]');
        target?.focus({ preventScroll: true });
      }
      pendingFocus.current = null;
    }
  }, [list, filter, unreadCount]);

  const go = (th: Thread) => {
    const n = th.head;
    const unread = unreadIds(th);
    if (unread.length) markNotificationsRead(unread);
    // Тот же проект — открыть сразу; другой — switchProject откроет задачу после переключения.
    // Из Входящих — полной страницей: контекста доски здесь нет (ADR-0013 §3).
    if (n.issueId && n.projectId === data.currentProjectId) openIssue(n.issueId, "page");
    else if (n.issueId && n.projectId) switchProject(n.projectId, n.issueId, "page");
  };

  // J/K — по ленте, Enter — открыть, E — прочитано (как во входящих Linear и почты).
  const stateRef = useRef({ list, cur, go });
  stateRef.current = { list, cur, go };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog]")) return;
      const { list: l, cur: selected, go: open } = stateRef.current;
      const focusedRow = el.closest<HTMLElement>("[data-row]");
      const c = focusedRow ? Number(focusedRow.dataset.row) : selected;
      if (!l.length) return;
      const k = e.key.toLowerCase();
      const move = (d: number) => {
        e.preventDefault();
        const next = Math.max(0, Math.min(l.length - 1, c + d));
        setCursor(next);
        const row = listRef.current?.querySelector<HTMLElement>(`[data-row="${next}"]`);
        row?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
        row?.scrollIntoView?.({ block: "nearest" });
      };
      if (k === "j" || k === "о" || e.key === "ArrowDown") move(1);
      else if (k === "k" || k === "л" || e.key === "ArrowUp") move(-1);
      else if (e.key === "Enter" && el === document.body) {
        e.preventDefault();
        open(l[c]);
      } else if (k === "e" || k === "у") {
        e.preventDefault();
        const unread = unreadIds(l[c]);
        if (unread.length) {
          setCursor(c);
          listRef.current?.querySelector<HTMLElement>(`[data-row="${c}"] button`)?.focus({ preventScroll: true });
          pendingFocus.current = document.activeElement as HTMLElement;
          markNotificationsRead(unread);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [markNotificationsRead]);

  let row = -1;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-4 pb-12 pt-6 sm:px-8">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h1 className="font-disp text-[22px] font-semibold tracking-[-0.02em] text-ink">{t("sidebar.nav.inbox")}</h1>
            <p className="mt-0.5 text-[13.5px] text-faint">{t("inbox.subtitle")}</p>
          </div>
          <div ref={tabsRef} role="tablist" aria-label={t("sidebar.nav.inbox")} className="flex items-center gap-0.5 rounded-lg bg-sunken/70 p-0.5 ring-1 ring-inset ring-linesoft">
            {(["all", "unread"] as const).map((f) => (
              <Button variant="ghost" size="sm"
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => {
                  setFilter(f);
                  setCursor(0);
                }}
                className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13.5px] font-semibold transition-[background-color,color,box-shadow] duration-150 ${
                  filter === f ? "bg-panel text-ink shadow-[var(--highlight-top),0_1px_2px_oklch(0.2_0.05_288/0.1)]" : "text-sub hover:text-ink"
                }`}
              >
                {t(f === "all" ? "inbox.filterAll" : "inbox.filterUnread")}
                {f === "unread" && unreadCount > 0 && <CountUp value={unreadCount} resetKey={filter} className="tabular text-accenttext" />}
              </Button>
            ))}
          </div>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={event => { pendingFocus.current = event.currentTarget; markNotificationsRead(); }} className="h-8 [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0">
              <IcCheck size={15} /> {t("topbar.markAllRead")}
            </Button>
          )}
          {notifications.length > 0 && (
            <Button variant="ghost" size="sm" onClick={event => { pendingFocus.current = event.currentTarget; dismissNotifications(); }} title={t("topbar.clearListTitle")} className="h-8 [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0">
              {t("topbar.clear")}
            </Button>
          )}
        </div>

        <div ref={listRef} className="inbox-list">
        {list.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              icon={<IcInbox size={22} tone="sky" />}
              title={t(filter === "unread" ? "inbox.emptyUnreadTitle" : "inbox.emptyTitle")}
              sub={t("inbox.emptySub")}
              action={
                filter === "unread" && notifications.length > 0 ? (
                  <Button size="sm" variant="secondary" onClick={() => setFilter("all")}>{t("inbox.filterAll")}</Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="anim-stagger mt-6 space-y-6">
            {groups.map((g) => (
              <section key={g.id}>
                <h2 className="mb-2 px-1 text-[12.5px] font-semibold tracking-[0.01em] text-faint">{t(`inbox.${g.id}`)}</h2>
                <div className="surface-raised overflow-hidden rounded-xl ring-1 ring-inset ring-line/70">
                  {g.items.map((th) => {
                    const n = th.head;
                    const read = !unreadIds(th).length;
                    row += 1;
                    const i = row;
                    const pk = n.projectId ? projectKey.get(n.projectId) : undefined;
                    return (
                      <div
                        key={n.id}
                        data-enter-id={n.id}
                        data-row={i}
                        data-active={i === cur ? "" : undefined}
                        className={`inbox-row group relative flex items-start gap-3 border-b border-linesoft px-4 py-3 transition-colors last:border-0 hover:bg-hover/60 ${read ? "" : "is-unread"}`}
                        onMouseEnter={() => setCursor(i)}
                        onFocus={() => setCursor(i)}
                      >
                        <Button variant="ghost" size="sm" onClick={() => go(th)} className="min-w-0 flex-1 text-left [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0">
                          <span className="relative mt-0.5 shrink-0">
                            <PersonAvatar user={n.actor} size={30} />
                            {!read && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)] ring-2 ring-panel" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14.5px] leading-snug text-ink">
                              {n.type !== "issue.dueSoon" && n.type !== "issue.reminder" && <b className="font-semibold">{n.actor?.name ?? t("topbar.someone")}</b>} {t(NOTIF_VERB[n.type])}{" "}
                              {n.type === "issue.dueSoon" && <span className="text-sub">{n.payload.dueDate} · </span>}
                              {n.payload.key && <span className="font-mono text-[13px] font-medium text-accenttext">{n.payload.key}</span>}
                              {n.type === "project.member" && n.payload.projectName && <span className="text-faint"> «{n.payload.projectName}»</span>}
                              {th.rest.length > 0 && (
                                <span className="ml-1.5 rounded-full bg-sunken px-1.5 py-px align-[1px] text-[12px] font-medium tabular text-faint ring-1 ring-inset ring-linesoft">
                                  {t("inbox.moreEvents", { n: th.rest.length })}
                                </span>
                              )}
                            </span>
                            {(n.payload.title || (n.type === "issue.status" && n.payload.from)) && (
                              <span className="mt-0.5 block truncate text-[13.5px] text-sub">
                                {n.payload.title}
                                {n.type === "issue.status" && n.payload.from && (
                                  <span className="text-faint">
                                    {n.payload.title ? " · " : ""}
                                    {workflowStatusName({ name: n.payload.from }, t)} → {workflowStatusName({ name: n.payload.to ?? "" }, t)}
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-2 pt-0.5">
                            {pk && <ProjectMark projectKey={pk} {...lookOf(data.projects, pk)} size={18} />}
                            <span className="w-[72px] text-right text-[12.5px] tabular text-faint">{relTime(n.createdAt)}</span>
                          </span>
                        </Button>
                        <IconButton variant="ghost" size="sm" label={t("topbar.dismissOneTitle")}
                          onClick={event => { pendingFocus.current = event.currentTarget; dismissNotifications(ids(th)); }}
                          className="mt-1 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <IcX size={14} />
                        </IconButton>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            <p className="hidden text-center text-[12.5px] text-faint md:block">{t("inbox.hint")}</p>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
