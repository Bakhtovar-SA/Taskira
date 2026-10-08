import { useEffect, useState } from "react";
import { PersonAvatar } from "./settings/parts";
import { Button, IconButton } from "../ds/Button";
import { EmptyState, Progress } from "../ds/Display";
import { Dialog } from "../ds/Dialog";
import { roadmapApi } from "../api";
import { useNotifications, useStore } from "../store";
import { fmtDate, relTime, readLastProject } from "../store/mappers";
import type { AssignedIssue, NotificationT, ViewId } from "../types";
import { IcBell, IcCheck, IcComment, IcMyIssues, IcPanel, IcPlus, IcX, StatusGlyph } from "../icons";
import { ProjectMark, projectTone } from "../ui";
import { NOTIF_VERB } from "./Topbar";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";
import { greetingName } from "../greetingName";
import { homeGroup, type HomeGroup } from "../homeGroups";
import { localToday, dateOf } from "../calendarLayout";
import { markHomeStep, useHomeSteps, type HomeStep } from "../homeSteps";
import { OPEN_HOME_CREATE_EVT, takeHomeCreate, openShortcuts } from "../palette/events";
import { openSidebarDrawer } from "./Sidebar";
import { pathForIssue } from "../router";
import { readRecent } from "../palette/recent";

const ORDER: HomeGroup[] = ["overdue", "week", "review", "rework", "other"];
const STEPS: HomeStep[] = ["profile", "create", "invite", "shortcuts"];
const greetingKey = (h = new Date().getHours()) =>
  h < 5 ? "home.greetingNight" : h < 12 ? "home.greetingMorning" : h < 18 ? "home.greetingDay" : h < 23 ? "home.greetingEvening" : "home.greetingNight";

export default function HomeView() {
  const { t, tn, lang } = useT();
  const { data, me, enterProject, switchProject, openIssue, setCreateOpen, setView } = useStore();
  const { notifications } = useNotifications();
  const [choosingProject, setChoosingProject] = useState(false);
  const [roadmap, setRoadmap] = useState<Awaited<ReturnType<typeof roadmapApi.get>> | null>(null);
  const [countsFailed, setCountsFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const steps = useHomeSteps(me.id);
  const completed = STEPS.filter(s => steps[s] || (s === "profile" && !!me.avatarUpdatedAt)).length;
  const target = data.projects.find(p => p.id === (data.currentProjectId || readLastProject())) ?? data.projects[0];
  const navigate = (view: ViewId, section?: string, projectId = target?.id) => {
    if (!projectId) return;
    setView(view, section); enterProject(projectId);
  };
  const createInProject = (projectId: string) => {
    setChoosingProject(false); setCreateOpen(true); enterProject(projectId);
  };
  const startCreate = () => {
    if (data.projects.length > 1) setChoosingProject(true);
    else if (target) createInProject(target.id);
  };
  useEffect(() => {
    const create = () => { if (takeHomeCreate()) startCreate(); };
    window.addEventListener(OPEN_HOME_CREATE_EVT, create);
    create();
    return () => window.removeEventListener(OPEN_HOME_CREATE_EVT, create);
  });
  useEffect(() => {
    let live = true;
    setCountsFailed(false);
    void roadmapApi.get().then(value => { if (live) setRoadmap(value); }, () => { if (live) setCountsFailed(true); });
    return () => { live = false; };
  }, [retry]);
  const openTask = (item: Pick<AssignedIssue, "projectId" | "issueId">) => {
    if (item.projectId === data.currentProjectId) { enterProject(item.projectId); openIssue(item.issueId, "page"); }
    else switchProject(item.projectId, item.issueId, "page");
  };
  const now = localToday();
  const groups = ORDER.map(id => ({ id, items: data.assignedToMe.filter(i => i.statusCategory !== "done" && homeGroup(i, me.globalRole === "admin", now) === id) })).filter(g => g.items.length);
  const count = (id: HomeGroup) => groups.find(g => g.id === id)?.items.length ?? 0;
  const review = data.assignedToMe.filter(i => i.statusCategory !== "done" && i.statusSid === "review" && (me.globalRole === "admin" || i.projectRole === "manager")).length;
  const rework = data.assignedToMe.filter(i => i.statusCategory !== "done" && (i.statusSid === "rework" || i.returnedForRework) && me.globalRole !== "admin" && i.projectRole === "employee").length;
  const dateLine = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const inviter = me.globalRole === "admin" ? target : undefined;
  const actions: Record<HomeStep, () => void> = {
    profile: () => navigate("settings", "profile"), create: startCreate,
    invite: () => navigate("projectSettings", "access", inviter?.id), shortcuts: openShortcuts,
  };

  return <div className="home-view h-full overflow-y-auto">
    <div className="home-content">
      <IconButton variant="ghost" size="lg" className="home-menu lg:hidden" label={t("sidebar.menu")} onClick={openSidebarDrawer}><IcPanel size={20} /></IconButton>
      <p className="home-date first-letter:uppercase">{dateLine}</p>
      <h1>{t(greetingKey(), { name: greetingName(me) })}</h1>
      <p className="home-summary">
        <span className={count("overdue") ? "text-[var(--status-danger-fg)]" : undefined}>{count("overdue")} {tn(count("overdue"), "home.summaryOverdue.one", "home.summaryOverdue.few", "home.summaryOverdue.many")}</span>
        {t("home.summaryWeek", { n: count("week") })}
        {t(rework && !review ? "home.summaryRework" : "home.summaryReview", { n: rework && !review ? rework : review })}
      </p>
      <div className="home-grid">
        <div className="min-w-0 space-y-6">
          <section className="home-card" aria-label={t("home.myTasks")}>
            <div className="home-card-head"><h2>{t("home.myTasks")}</h2><Button variant="ghost" size="sm" onClick={() => navigate("my")}>{t("home.allMyTasks")}</Button></div>
            {groups.map(g => <div key={g.id} className="home-task-group" data-urgency={g.id}>
              <h3>{t(`home.group.${g.id}`)} <span className="tabular text-faint">{g.items.length}</span></h3>
              {g.items.map(item => {
                const overdue = !!item.dueDate && item.dueDate < now;
                const days = item.dueDate ? Math.round((dateOf(now).getTime() - dateOf(item.dueDate).getTime()) / 864e5) : 0;
                return <a key={item.issueId} href={pathForIssue(item.projectKey, item.key)} className="home-task ds-focus" onClick={e => {
                  if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                  e.preventDefault(); openTask(item);
                }}>
                  <span title={workflowStatusName({ name: item.statusName }, t)}><StatusGlyph category={item.statusCategory} size={16} /></span>
                  <span className="home-task-title truncate" title={item.title}>{item.title}</span>
                  <span className="home-task-key font-mono text-faint">{item.key}</span>
                  <span className={'home-task-due tabular ' + (overdue ? "text-[var(--status-danger-fg)]" : "text-faint")}>{item.dueDate ? overdue ? t("issue.overdueDays", { n: days, days: tn(days, "noun.day.one", "noun.day.few", "noun.day.many") }) : fmtDate(item.dueDate, lang) : t("home.urgency.nodate")}</span>
                  <PersonAvatar user={me} size={22} />
                </a>;
              })}
            </div>)}
            {!groups.length && <EmptyState icon={<IcMyIssues size={22} tone="violet" />} title={t("home.noAssignedTitle")} sub={t("home.noAssignedSub")} action={target && <Button variant="primary" size="lg" iconLeft={<IcPlus size={18} />} onClick={startCreate}>{t("home.createIssue")}</Button>} />}
            {data.assignedTruncated && <p className="border-t border-line px-4 py-3 text-[13px] text-warn">{t("home.assignedTruncated", { n: data.assignedToMe.length, noun: tn(data.assignedToMe.length, "noun.issue.one", "noun.issue.few", "noun.issue.many") })}</p>}
          </section>
          <RecentActivity notifications={notifications} onOpen={openTask} />
          <Mentions notifications={notifications} onOpen={openTask} />
        </div>
        <div className="min-w-0 space-y-6">
          {!steps.hidden && completed < 4 && <section className="home-steps home-card" aria-label={t("home.firstSteps")}>
            <div className="home-card-head"><h2>{t("home.firstSteps")}</h2><span className="tabular text-sub">{t("home.stepsCount", { n: completed })}</span><IconButton variant="ghost" size="sm" label={t("home.hideSteps")} onClick={() => markHomeStep(me.id, "hidden")}><IcX size={16} /></IconButton></div>
            <Progress value={completed * 25} label={t("home.firstSteps")} />
            <div className="home-step-list">{STEPS.map(step => {
              const done = steps[step] || (step === "profile" && !!me.avatarUpdatedAt);
              return <Button key={step} variant="ghost" size="md" className="home-step" title={step === "invite" && !inviter ? t("home.inviteAdmin") : undefined} disabled={!!done || (step === "invite" && !inviter) || (step === "create" && !target)} onClick={actions[step]} iconLeft={done ? <IcCheck size={18} /> : <span className="home-step-circle" />}>{t(`home.step.${step}`)}</Button>;
            })}</div>
          </section>}
          <section className="home-card" aria-label={t("home.projects")}>
            <div className="home-card-head"><h2>{t("home.projects")}</h2>{countsFailed && <Button variant="ghost" size="sm" onClick={() => setRetry(n => n + 1)}>{t("common.retry")}</Button>}</div>
            {data.projects.map(p => {
              const stats = roadmap?.projects.find(s => s.id === p.id);
              const mine = data.assignedToMe.filter(i => i.projectId === p.id && i.statusCategory !== "done").length;
              return <button type="button" key={p.id} className="home-project ds-focus" onClick={() => navigate(p.defaultView ?? "board", undefined, p.id)}>
                <ProjectMark projectKey={p.key} icon={p.icon} color={p.color} size={28} />
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink">{p.name}</span><span className={'home-project-progress tk-tone-' + (p.color ?? projectTone(p.key))}>{stats && <Progress value={stats.total ? stats.done / stats.total * 100 : 0} label={t("home.projectProgress", { name: p.name })} />}</span></span>
                <span className="home-project-count text-faint">{t("home.projectMine", { n: String(mine) + (data.assignedTruncated ? "+" : "") })}<span className="block">{t("home.projectOpen", { n: stats ? Math.max(0, stats.total - stats.done) : "—" })}</span></span>
              </button>;
            })}
            {countsFailed && <p role="status" className="px-4 pb-3 text-[13px] text-sub">{t("home.countsFailed")}</p>}
          </section>
          <RecentlyOpened onOpen={openTask} />
        </div>
      </div>
    </div>
    <Dialog open={choosingProject} onClose={() => setChoosingProject(false)} title={t("home.chooseProject")} description={t("home.chooseProjectSub")} size="sm">
      <div className="space-y-2">{data.projects.map(p => <Button key={p.id} size="lg" variant="secondary" className="w-full justify-start" onClick={() => createInProject(p.id)} iconLeft={<ProjectMark projectKey={p.key} icon={p.icon} color={p.color} size={24} />}>{p.name}</Button>)}</div>
    </Dialog>
  </div>;
}

type ActivityProps = { notifications: NotificationT[]; onOpen: (item: Pick<AssignedIssue, "projectId" | "issueId">) => void };
function RecentActivity({ notifications, onOpen }: ActivityProps) {
  const { t, lang } = useT();
  if (!notifications.length) return null;
  return <section className="home-card"><div className="home-card-head"><h2 className="flex items-center gap-2"><IcBell size={16} />{t("home.recentActivity")}</h2></div>
    {notifications.slice(0, 5).map(n => <button type="button" key={n.id} disabled={!n.projectId || !n.issueId} onClick={() => onOpen({ projectId: n.projectId!, issueId: n.issueId! })} className="home-activity ds-focus">
      <PersonAvatar user={n.actor} size={22} />
      <span className="min-w-0 truncate"><b className="font-semibold">{n.actor?.name.split(" ")[0] ?? t("topbar.someone")}</b>{" "}{t(NOTIF_VERB[n.type])}{" "}<span className="font-mono">{n.payload.key}</span> · <span className="text-faint">{relTime(n.createdAt, lang)}</span></span>
    </button>)}
  </section>;
}
function Mentions({ notifications, onOpen }: ActivityProps) {
  const { t } = useT();
  const items = notifications.filter(n => n.type === "issue.mention" && !n.read && n.issueId && n.projectId).slice(0, 5);
  if (!items.length) return null;
  return <section className="home-card"><div className="home-card-head"><h2 className="flex items-center gap-2"><IcComment size={16} />{t("home.mentions")}</h2></div>
    {items.map(n => <button key={n.id} type="button" className="home-activity ds-focus" onClick={() => onOpen({ projectId: n.projectId!, issueId: n.issueId! })}><span className="font-mono text-faint">{n.payload.key}</span><span className="min-w-0 truncate">{n.payload.title ?? t("home.mentionedYou")}</span></button>)}
  </section>;
}
function RecentlyOpened({ onOpen }: Pick<ActivityProps, "onOpen">) {
  const { t } = useT();
  const [items] = useState(() => readRecent().slice(0, 5));
  if (!items.length) return null;
  return <section className="home-card"><div className="home-card-head"><h2>{t("home.recentlyOpened")}</h2></div>
    {items.map(r => <button key={r.id} type="button" className="home-activity ds-focus" onClick={() => onOpen({ projectId: r.projectId, issueId: r.id })}><StatusGlyph category={r.category} size={16} /><span className="font-mono text-faint">{r.key}</span><span className="min-w-0 truncate">{r.title}</span></button>)}
  </section>;
}
