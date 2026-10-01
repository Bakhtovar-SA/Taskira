import { Button } from "../ds/Button";
import { EmptyState } from "../ds/Display";
import { Progress, Tag } from "../ds";
import { useLocation } from "wouter";
import { PersonAvatar } from "../components/settings/parts";
/** Содержимое виджетов дашборда (ADR-0022): по одному компоненту на тип, данные — из POST /api/dashboards/data.
 *  Здесь только отрисовка; где открыть задачу или список, решает DashboardView через `WidgetNav`. */
import { useEffect, useState, type ReactNode } from "react";
import { useT, type TKey } from "../i18n";
import { roadmapApi, type WidgetDataDto } from "../api";
import { useStore } from "../store";
import { relTime } from "../store/mappers";
import { activityLine } from "../activityText";
import { ProjectMark } from "../ui";
import { lookOf } from "../projectLook";
import { DueRing, IcCheck, PriorityIcon, StatusGlyph, TypeIcon } from "../icons";
import { BarList, Donut, Legend, Lines, Meter, OTHER_COLOR, StackedRow, chartColor, type Part } from "./charts";
import type { Widget } from "./catalog";

const HEALTH_TONE = { completed: "green", overdue: "red", atRisk: "amber", onTrack: "blue", noDate: "gray" } as const;
const HEALTH_COLOR = { completed: "var(--status-done)", overdue: "var(--status-danger)", atRisk: "var(--status-warn)", onTrack: "var(--status-progress)", noDate: "var(--status-todo)" };
function ProjectsBody({ data, nav }: { data: Data<"projects">; nav: WidgetNav }) {
  const { t } = useT();
  const { data: store } = useStore();
  if (!data.items.length) return <Empty text={t("portfolio.empty")} />;
  return <div className="h-full overflow-auto"><table className="w-full text-left text-[12px]">
    <thead className="text-faint"><tr>{["dash.w.projects", "portfolio.team", "portfolio.progress", "portfolio.open", "portfolio.overdue", "portfolio.target", "portfolio.health"].map(k => <th key={k} className="px-2 pb-2 font-medium">{t(k as TKey)}</th>)}</tr></thead>
    <tbody>{data.items.map(p => <tr key={p.projectId} className="border-t border-linesoft">
      <td className="px-2 py-2"><Button size="sm" variant="ghost" onClick={() => nav.openProject(p.projectId)}><span className="flex items-center gap-2"><ProjectMark projectKey={p.key} {...lookOf(store.projects, p.projectId)} size={16} />{p.name}</span></Button></td>
      <td className="px-2">{p.team}</td><td className="min-w-24 px-2"><Progress value={p.total ? (p.total - p.open) / p.total * 100 : 0} label={`${p.name}: ${t("portfolio.progress")}`} /><span>{p.total ? Math.round((p.total - p.open) / p.total * 100) : 0}%</span></td>
      <td className="px-2 tabular">{p.open}</td><td className="px-2 tabular">{p.overdue}</td><td className="whitespace-nowrap px-2">{p.targetDate ?? "—"}</td>
      <td className="px-2"><Tag tone={HEALTH_TONE[p.health]} dot>{t(`health.${p.health}`)}</Tag></td>
    </tr>)}</tbody>
  </table></div>;
}
function HealthBody({ data }: { data: Data<"projectHealth"> }) {
  const { t } = useT();
  const parts = data.items.map(i => ({ key: i.health, label: t(`health.${i.health}`), value: i.count, color: HEALTH_COLOR[i.health] }));
  return <Donut parts={parts} total={data.items.reduce((s, i) => s + i.count, 0)} centerLabel={t("dash.w.projects")} />;
}
function MilestonesBody({ data }: { data: Data<"milestones"> }) {
  const { t, lang } = useT();
  const store = useStore();
  const [, navigate] = useLocation();
  const [editable, setEditable] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let alive = true;
    roadmapApi.get().then(r => { if (alive) setEditable(new Set(r.projects.filter(p => p.canEdit).map(p => p.id))); }, () => {});
    return () => { alive = false; };
  }, []);
  if (!data.items.length) return <Empty text={t("portfolio.empty")} />;
  const open = (projectId: string) => {
    const key = store.data.projects.find(p => p.id === projectId)?.key;
    const canEdit = projectId === store.data.currentProjectId ? store.can("editRoadmap") : editable.has(projectId);
    navigate(canEdit && key ? `/p/${encodeURIComponent(key)}/settings/roadmap` : "/roadmap");
  };
  return <ul className="h-full space-y-1 overflow-y-auto">{data.items.map(m => <li key={m.id}>
    <Button size="sm" variant="ghost" onClick={() => open(m.projectId)} className="w-full text-left [&>span.truncate]:w-full">
      <span className="flex items-center gap-3"><span className={`shrink-0 tabular ${m.overdue ? "text-danger" : "text-sub"}`}>{new Date(`${m.date}T12:00:00`).toLocaleDateString(lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "short" })}</span>
        <span className="min-w-0 flex-1 truncate">{m.name}</span><span className="text-faint">{m.projectKey}</span></span>
    </Button>
  </li>)}</ul>;
}

type Data<T extends WidgetDataDto["type"]> = Extract<WidgetDataDto, { type: T }>;

/** Куда ведут клики внутри виджета. */
export interface WidgetNav {
  openIssue: (projectId: string, issueId: string) => void;
  /** Открыть список задач с фильтром — есть только там, где известен проект (обзор или виджет с проектом). */
  openList?: (projectId: string, query: Record<string, string>) => void;
  openProject: (projectId: string) => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/* ---------------- число ---------------- */

const COUNT_QUERY: Partial<Record<Extract<Widget, { type: "count" }>["metric"], () => Record<string, string>>> = {
  open: () => ({}),
  overdue: () => ({ overdue: "1" }),
  dueSoon: () => ({ dueFrom: today(), dueTo: plusDays(7) }),
  unassigned: () => ({ assignee: "none" }),
};

function CountBody({ w, data, projectId, nav }: { w: Extract<Widget, { type: "count" }>; data: Data<"count">; projectId: string | null; nav: WidgetNav }) {
  const { t, tn } = useT();
  const query = COUNT_QUERY[w.metric];
  const period = w.metric === "closed" || w.metric === "created" ? t("dash.forDays", { n: w.periodDays, noun: tn(w.periodDays, "noun.day.one", "noun.day.few", "noun.day.many") }) : null;
  const tone = w.metric === "overdue" && data.value > 0 ? "text-[var(--status-danger-fg)]" : "text-ink";
  const value = <span className={`font-disp text-[34px] font-bold leading-none tracking-[-0.03em] ${tone}`}>{data.value.toLocaleString()}</span>;
  return (
    <div className="flex h-full flex-col justify-end gap-1">
      {projectId && query && nav.openList ? (
        <Button variant="ghost" size="sm" type="button" onClick={() => nav.openList!(projectId, query())} className="w-fit text-left [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0" title={t("dash.openList")}>
          {value}
        </Button>
      ) : (
        value
      )}
      {period && <span className="text-[11.5px] text-faint">{period}</span>}
    </div>
  );
}

/* ---------------- разбивка ---------------- */

const PRIORITY_SLOT: Record<string, number> = { critical: 7, high: 1, medium: 3, low: 6 };
const TYPE_SLOT: Record<string, number> = { task: 0, bug: 7, request: 2 };

function breakdownLabel(t: (k: TKey, p?: Record<string, string | number>) => string, groupBy: string, key: string, label: string): string {
  if (key === "_other") return t("dash.other");
  if (groupBy === "assignee" && key === "none") return t("dash.noAssignee");
  if (groupBy === "priority") return t(`priority.${label}` as TKey);
  if (groupBy === "type") return t(`issueType.${label}` as TKey);
  return label;
}

function BreakdownBody({ w, data }: { w: Extract<Widget, { type: "breakdown" }>; data: Data<"breakdown"> }) {
  const { t } = useT();
  const parts: Part[] = data.items.map((it, i) => ({
    key: it.key,
    label: breakdownLabel(t, w.groupBy, it.key, it.label),
    value: it.count,
    // Цвет закреплён за сущностью: у приоритета и типа — по значению; «прочее» и «без исполнителя» — нейтральные.
    color:
      it.key === "_other" || it.key === "none"
        ? OTHER_COLOR
        : w.groupBy === "priority"
          ? chartColor(PRIORITY_SLOT[it.key] ?? i)
          : w.groupBy === "type"
            ? chartColor(TYPE_SLOT[it.key] ?? i)
            : chartColor(i),
  }));
  if (!parts.length) return <Empty text={t("dash.noOpen")} />;
  // Кольцо — только для немногих частей; иначе сравнивать доли по дугам нельзя, рисуем полосы.
  if (w.chart === "donut" && parts.length <= 6) return <Donut parts={parts} total={data.total} centerLabel={t("dash.openShort")} />;
  const lead = (key: string) =>
    w.groupBy === "priority" ? <PriorityIcon p={key as never} size={13} /> : w.groupBy === "type" ? <TypeIcon type={key} size={13} /> : null;
  // Одна серия — один цвет на все полосы.
  return <BarList rows={parts.map((p) => ({ ...p, color: p.key === "_other" || p.key === "none" ? OTHER_COLOR : chartColor(0), lead: lead(p.key) }))} />;
}

/* ---------------- тренд ---------------- */

function TrendBody({ data, height }: { data: Data<"trend">; height: number }) {
  const { t, lang } = useT();
  if (data.weeks.length < 2) return <Empty text={t("dash.noData")} />;
  const fmt = (w: string) => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "short" }).format(new Date(w));
  const series = [
    { key: "created", label: t("dash.created"), color: chartColor(0), values: data.weeks.map((w) => w.created) },
    { key: "closed", label: t("dash.closed"), color: chartColor(2), values: data.weeks.map((w) => w.closed) },
  ];
  const sum = (k: "created" | "closed") => data.weeks.reduce((s, w) => s + w[k], 0);
  return (
    <div className="flex h-full flex-col gap-2">
      <Legend line items={series.map((s) => ({ key: s.key, label: s.label, color: s.color, value: sum(s.key as "created" | "closed") }))} />
      <Lines xs={data.weeks.map((w) => w.week)} series={series} fmtX={fmt} height={Math.max(90, height - 30)} label={t("dash.w.trend")} />
    </div>
  );
}

/* ---------------- список задач ---------------- */

function IssuesBody({ data, nav, showProject }: { data: Data<"issues">; nav: WidgetNav; showProject: boolean }) {
  const { t, lang } = useT();
  const { data: store } = useStore();
  if (!data.items.length) return <Empty text={t("dash.noIssues")} ok />;
  const now = today();
  return (
    <div className="flex h-full flex-col">
      <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto">
        {data.items.map((i) => (
          <li key={i.issueId}>
            <Button variant="ghost" size="sm" type="button" onClick={() => nav.openIssue(i.projectId, i.issueId)} className="w-full text-left [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0">
              <StatusGlyph category={i.statusCategory} size={13} />
              {showProject && <ProjectMark projectKey={i.projectKey} {...lookOf(store.projects, i.projectId)} size={16} />}
              <span className="w-[64px] shrink-0 truncate font-mono text-[11px] text-faint">{i.key}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={i.title}>
                {i.title}
              </span>
              <PriorityIcon p={i.priorityId} size={13} />
              {i.dueDate && (
                <span className="flex shrink-0 items-center gap-1 text-[11px] tabular text-faint">
                  <DueRing due={i.dueDate} today={now} size={12} done={i.statusCategory === "done"} />
                  {new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "short" }).format(new Date(i.dueDate))}
                </span>
              )}
            </Button>
          </li>
        ))}
      </ul>
      {data.truncated && <p className="pt-1 text-[11px] text-faint">{t("dash.truncated", { n: data.items.length })}</p>}
    </div>
  );
}

/* ---------------- нагрузка ---------------- */

function WorkloadBody({ data }: { data: Data<"workload"> }) {
  const { t } = useT();
  if (!data.items.length) return <Empty text={t("dash.noOpen")} />;
  const keys = [
    { key: "overdue", label: t("dash.load.overdue"), color: "var(--status-danger)" },
    { key: "dueSoon", label: t("dash.load.dueSoon"), color: "var(--status-progress)" },
    { key: "other", label: t("dash.load.other"), color: "var(--status-todo)" },
  ] as const;
  const max = Math.max(1, ...data.items.map((u) => u.overdue + u.dueSoon + u.other));
  return (
    <div className="flex h-full flex-col gap-2.5">
      <Legend items={keys.map((k) => ({ key: k.key, label: k.label, color: k.color }))} />
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {data.items.map((u) => (
          <li key={u.userId} className="flex items-center gap-2">
            <PersonAvatar user={{ id: u.userId, name: u.name, initials: u.initials, color: u.color }} size={20} />
            <span className="w-[30%] min-w-0 truncate text-[12px] text-sub" title={u.name}>
              {u.name}
            </span>
            <StackedRow label={u.name} max={max} segments={keys.map((k) => ({ key: k.key, label: k.label, color: k.color, value: u[k.key] }))} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- прогресс проектов ---------------- */

function ProgressBody({ data, nav }: { data: Data<"progress">; nav: WidgetNav }) {
  const { t } = useT();
  const { data: store } = useStore();
  if (!data.items.length) return <Empty text={t("dash.noProjects")} />;
  return (
    <ul className="h-full space-y-2.5 overflow-y-auto">
      {data.items.map((p) => {
        const share = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
        return (
          <li key={p.projectId}>
            <Button variant="ghost" size="sm" type="button" onClick={() => nav.openProject(p.projectId)} className="block w-[calc(100%+0.5rem)] text-left [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0">
              <span className="flex items-center gap-2 text-[12.5px]">
                <ProjectMark projectKey={p.key} {...lookOf(store.projects, p.projectId)} size={16} />
                <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                {p.overdue > 0 && <span className="text-[11px] tabular text-[var(--status-danger-fg)]">{t("dash.overdueN", { n: p.overdue })}</span>}
                <span className="text-[11.5px] tabular text-faint">
                  {p.done}/{p.total}
                </span>
                <span className="w-9 text-right text-[12px] font-semibold tabular text-ink">{p.total > 0 ? `${share}%` : "—"}</span>
              </span>
              <span className="mt-1 block">
                <Meter value={p.done} total={p.total} label={t("dash.progressOf", { name: p.name })} />
              </span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- активность ---------------- */

function ActivityBody({ data, nav }: { data: Data<"activity">; nav: WidgetNav }) {
  const { t, lang } = useT();
  if (!data.items.length) return <Empty text={t("dash.noActivity")} />;
  return (
    <ul className="-mx-1 h-full space-y-0.5 overflow-y-auto">
      {data.items.map((a) => (
        <li key={a.id}>
          <Button variant="ghost" size="sm" type="button" onClick={() => nav.openIssue(a.projectId, a.issueId)} className="w-full text-left [&>span.truncate]:flex [&>span.truncate]:items-center [&>span.truncate]:gap-2 [&>span.truncate]:min-w-0">
            <span className="min-w-0 flex-1 text-[12px] leading-snug text-sub">
              <span className="font-semibold text-ink">{a.actorName}</span> {activityLine(a.event ?? null, a.text, t, lang)}{" "}
              <span className="font-mono text-[11px] text-faint">{a.issueKey}</span>
            </span>
            <span className="shrink-0 text-[10.5px] tabular text-faint">{relTime(Date.parse(a.createdAt), lang)}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function Empty({ text, ok = false }: { text: string; ok?: boolean }) {
  return (
      <div className="flex h-full items-center justify-center [&_.ds-empty]:py-3 [&_.ds-empty-art]:hidden [&_.ds-empty-title]:text-[12px]">
        <EmptyState icon={null} title={<span className="flex items-center gap-1.5">{ok && <IcCheck size={13} className="text-[var(--status-done-fg)]" />}{text}</span>} />
    </div>
  );
}

/** Содержимое одного виджета. `projectId` — проект, если область виджета — один проект (обзор или выбран в
 *  настройках): тогда числа ведут в список с фильтром. */
export function WidgetBody({ w, data, nav, projectId, height }: { w: Widget; data: WidgetDataDto; nav: WidgetNav; projectId: string | null; height: number }): ReactNode {
  const { t } = useT();
  if (data.type === "error") return <Empty text={t("dash.widgetFailed")} />;
  if (data.type !== w.type) return null;
  switch (w.type) {
    case "projects": return <ProjectsBody data={data as Data<"projects">} nav={nav} />;
    case "projectHealth": return <HealthBody data={data as Data<"projectHealth">} />;
    case "milestones": return <MilestonesBody data={data as Data<"milestones">} />;
    case "count":
      return <CountBody w={w} data={data as Data<"count">} projectId={projectId} nav={nav} />;
    case "breakdown":
      return <BreakdownBody w={w} data={data as Data<"breakdown">} />;
    case "trend":
      return <TrendBody data={data as Data<"trend">} height={height} />;
    case "issues":
      return <IssuesBody data={data as Data<"issues">} nav={nav} showProject={!projectId} />;
    case "workload":
      return <WorkloadBody data={data as Data<"workload">} />;
    case "progress":
      return <ProgressBody data={data as Data<"progress">} nav={nav} />;
    case "activity":
      return <ActivityBody data={data as Data<"activity">} nav={nav} />;
  }
}
