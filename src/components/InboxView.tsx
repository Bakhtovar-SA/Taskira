/** «Входящие» (ADR-0013 §1, `/inbox`) — полная страница ленты уведомлений; колокол в шапке
 *  остаётся быстрым просмотром той же ленты. Данные — внешний стор уведомлений (ADR-0011). */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNotifications, useStore } from "../store";
import { relTime } from "../store/mappers";
import type { NotificationT } from "../types";
import { IcCheck, IcInbox, IcX } from "../icons";
import { Avatar, Empty, ProjectMark } from "../ui";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";
import { NOTIF_VERB } from "./Topbar";

type Filter = "all" | "unread";
type DayGroup = "today" | "yesterday" | "earlier";

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

  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  const list = useMemo(() => (filter === "unread" ? notifications.filter((n) => !n.read) : notifications), [notifications, filter]);
  const groups = useMemo(() => {
    const out: { id: DayGroup; items: NotificationT[] }[] = [];
    for (const n of list) {
      const g = dayGroup(n.createdAt);
      const last = out[out.length - 1];
      if (last?.id === g) last.items.push(n);
      else out.push({ id: g, items: [n] });
    }
    return out;
  }, [list]);
  const projectKey = useMemo(() => new Map(data.projects.map((p) => [p.id, p.key])), [data.projects]);
  const cur = Math.min(cursor, Math.max(0, list.length - 1));

  const go = (n: NotificationT) => {
    if (!n.read) markNotificationsRead([n.id]);
    // Тот же проект — открыть сразу; другой — switchProject откроет задачу после переключения.
    if (n.issueId && n.projectId === data.currentProjectId) openIssue(n.issueId);
    else if (n.issueId && n.projectId) switchProject(n.projectId, n.issueId);
  };

  // J/K — по ленте, Enter — открыть, E — прочитано (как во входящих Linear и почты).
  const stateRef = useRef({ list, cur, go });
  stateRef.current = { list, cur, go };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog]")) return;
      const { list: l, cur: c, go: open } = stateRef.current;
      if (!l.length) return;
      const k = e.key.toLowerCase();
      const move = (d: number) => {
        e.preventDefault();
        const next = Math.max(0, Math.min(l.length - 1, c + d));
        setCursor(next);
        listRef.current?.querySelector<HTMLElement>(`[data-row="${next}"]`)?.scrollIntoView?.({ block: "nearest" });
      };
      if (k === "j" || k === "о" || e.key === "ArrowDown") move(1);
      else if (k === "k" || k === "л" || e.key === "ArrowUp") move(-1);
      else if (e.key === "Enter" && el === document.body) {
        e.preventDefault();
        open(l[c]);
      } else if (k === "e" || k === "у") {
        e.preventDefault();
        if (!l[c].read) markNotificationsRead([l[c].id]);
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
            <p className="mt-0.5 text-[12.5px] text-faint">{t("inbox.subtitle")}</p>
          </div>
          <div role="tablist" aria-label={t("sidebar.nav.inbox")} className="flex items-center gap-0.5 rounded-lg bg-sunken/70 p-0.5 ring-1 ring-inset ring-linesoft">
            {(["all", "unread"] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => {
                  setFilter(f);
                  setCursor(0);
                }}
                className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-semibold transition-[background-color,color,box-shadow] duration-150 ${
                  filter === f ? "bg-panel text-ink shadow-[var(--highlight-top),0_1px_2px_oklch(0.2_0.05_288/0.1)]" : "text-sub hover:text-ink"
                }`}
              >
                {t(f === "all" ? "inbox.filterAll" : "inbox.filterUnread")}
                {f === "unread" && unreadCount > 0 && <span className="tabular text-accenttext">{unreadCount}</span>}
              </button>
            ))}
          </div>
          {unreadCount > 0 && (
            <button onClick={() => markNotificationsRead()} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-sub ring-1 ring-inset ring-linesoft transition-colors hover:bg-hover hover:text-ink">
              <IcCheck size={13} /> {t("topbar.markAllRead")}
            </button>
          )}
          {notifications.length > 0 && (
            <button onClick={() => dismissNotifications()} title={t("topbar.clearListTitle")} className="flex h-8 items-center rounded-lg px-2.5 text-[12.5px] font-medium text-faint transition-colors hover:bg-hover hover:text-danger">
              {t("topbar.clear")}
            </button>
          )}
        </div>

        {list.length === 0 ? (
          <div className="mt-10">
            <Empty icon={<IcInbox size={22} />} title={t(filter === "unread" ? "inbox.emptyUnreadTitle" : "inbox.emptyTitle")} sub={t("inbox.emptySub")} />
          </div>
        ) : (
          <div ref={listRef} className="mt-6 space-y-6">
            {groups.map((g) => (
              <section key={g.id}>
                <h2 className="mb-2 px-1 text-[11.5px] font-semibold tracking-[0.01em] text-faint">{t(`inbox.${g.id}`)}</h2>
                <div className="surface-raised overflow-hidden rounded-xl ring-1 ring-inset ring-line/70">
                  {g.items.map((n) => {
                    row += 1;
                    const i = row;
                    const pk = n.projectId ? projectKey.get(n.projectId) : undefined;
                    return (
                      <div
                        key={n.id}
                        data-row={i}
                        data-active={i === cur ? "" : undefined}
                        className={`inbox-row group relative flex items-start gap-3 border-b border-linesoft px-4 py-3 transition-colors last:border-0 hover:bg-hover/60 ${n.read ? "" : "is-unread"}`}
                        onMouseEnter={() => setCursor(i)}
                      >
                        <button onClick={() => go(n)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                          <span className="relative mt-0.5 shrink-0">
                            <Avatar user={n.actor} size={30} />
                            {!n.read && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)] ring-2 ring-panel" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] leading-snug text-ink">
                              <b className="font-semibold">{n.actor?.name ?? t("topbar.someone")}</b> {t(NOTIF_VERB[n.type])}{" "}
                              {n.payload.key && <span className="font-mono text-[12px] font-medium text-accenttext">{n.payload.key}</span>}
                              {n.type === "project.member" && n.payload.projectName && <span className="text-faint"> «{n.payload.projectName}»</span>}
                            </span>
                            {(n.payload.title || (n.type === "issue.status" && n.payload.from)) && (
                              <span className="mt-0.5 block truncate text-[12.5px] text-sub">
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
                            {pk && <ProjectMark projectKey={pk} size={18} />}
                            <span className="w-[72px] text-right text-[11.5px] tabular text-faint">{relTime(n.createdAt)}</span>
                          </span>
                        </button>
                        <button
                          onClick={() => dismissNotifications([n.id])}
                          title={t("topbar.dismissOneTitle")}
                          aria-label={t("topbar.dismissOneTitle")}
                          className="mt-1 shrink-0 rounded p-1 text-faint opacity-0 transition-opacity hover:bg-linesoft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <IcX size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            <p className="hidden text-center text-[11.5px] text-faint md:block">{t("inbox.hint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
