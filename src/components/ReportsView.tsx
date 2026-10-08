import { useEffect, useMemo, useState } from "react";
import { downloadReportCsv, reportsApi, type ReportGroup, type ReportScope, type ReportSummary } from "../api";
import { useStore } from "../store";
import { useT, type TKey } from "../i18n";
import { Button } from "../ds/Button";
import { Checkbox } from "../ds/Field";
import { DatePicker } from "../ds/DatePicker";
import { EmptyState } from "../ds/Display";
import { Menu, Popover } from "../ds/Overlay";
import { Tabs } from "../ds/Tabs";
import { IcChevD, IcDownload, IcReport } from "../icons";
import { DashboardTabs, useDashboardList } from "../dashboards/DashboardTabs";
import { cssVars } from "../cssVars";
import { REPORT_PROJECT_LIMIT, selectReportProject } from "../reportProjectSelection";

const DAY = 86_400_000;
const date = (s: string) => new Date(`${s}T00:00:00Z`);
const shift = (s: string, days: number) => new Date(date(s).getTime() + days * DAY).toISOString().slice(0, 10);
export function previousPeriod(from: string, to: string) {
  const length = Math.round((date(to).getTime() - date(from).getTime()) / DAY) + 1;
  return { from: shift(from, -length), to: shift(from, -1) };
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const presets = [{ id: "month", days: 30 }, { id: "quarter", days: 90 }, { id: "year", days: 365 }] as const;
const groups: ReportGroup[] = ["project", "assignee", "type", "priority"];
const scopes: ReportScope[] = ["closed", "created", "open"];

function Trend({ report }: { report: ReportSummary }) {
  const { t, lang } = useT();
  const points = report.trend;
  const max = Math.max(1, ...points.flatMap(p => [p.created ?? 0, p.closed]));
  const W = Math.max(520, points.length * 68), H = 256, base = 218;
  const slot = (W - 36) / Math.max(1, points.length);
  const fmt = (s: string) => date(s).toLocaleDateString(lang, { day: "numeric", month: "short", timeZone: "UTC" });
  return <section className="reports-panel reports-chart">
    <div className="reports-panel-head"><h2>{t("reports.trend.title")}</h2><span className="reports-legend"><i data-series="created" />{t("reports.table.created")}<i data-series="closed" />{t("reports.table.closed")}</span></div>
    <div className="reports-chart-scroll ds-focus" tabIndex={0} role="region" aria-label={t("reports.trend.title")} ref={cssVars({ "--report-chart-width": `${W}px` })}>
      <svg role="img" aria-label={t("reports.trend.title")} viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        <title>{t("reports.trend.title")}</title>
        {[0, 1, 2, 3].map(i => <line key={i} x1={18} x2={W - 18} y1={base - i * 60} y2={base - i * 60} className="reports-gridline" />)}
        {points.map((p, i) => {
          const x = 18 + slot * (i + .5), bw = Math.min(22, slot * .28);
          return <g key={p.week}>
            <title>{`${fmt(p.week)}: ${t("reports.table.created")} ${p.created ?? "—"}, ${t("reports.table.closed")} ${p.closed}`}</title>
            {(["created", "closed"] as const).map((series, j) => {
              const value = p[series], h = ((value ?? 0) / max) * 174, bx = x + (j ? 3 : -bw - 3);
              return <g key={series}><rect data-series={series} x={bx} y={base - h} width={bw} height={h} rx={3} /><text x={bx + bw / 2} y={base - h - 8} textAnchor="middle">{value ?? "—"}</text></g>;
            })}
            <text x={x} y={base + 25} textAnchor="middle">{fmt(p.week)}</text>
          </g>;
        })}
      </svg>
    </div>
    <details className="reports-chart-data"><summary>{t("reports.chartData")}</summary><table><caption className="sr-only">{t("reports.trend.title")}</caption><thead><tr><th>{t("reports.period")}</th><th>{t("reports.table.created")}</th><th>{t("reports.table.closed")}</th></tr></thead><tbody>{points.map(p => <tr key={p.week}><th>{fmt(p.week)}</th><td>{p.created ?? "—"}</td><td>{p.closed}</td></tr>)}</tbody></table></details>
  </section>;
}

export default function ReportsView() {
  const { t, tn, lang, errText } = useT();
  const { data, toast } = useStore();
  const dashboards = useDashboardList();
  const [preset, setPreset] = useState<string>("month");
  const [range, setRange] = useState(() => { const to = today(); return { from: shift(to, -29), to }; });
  const [departmentId, setDepartmentId] = useState("");
  // null means all available projects; [] is an explicit empty selection.
  const [selected, setSelected] = useState<string[] | null>(null);
  const [groupBy, setGroupBy] = useState<ReportGroup>("project");
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [previous, setPrevious] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [exporting, setExporting] = useState(false);
  const departments = data.departments.filter(d => data.projects.some(p => p.departmentId === d.id));
  const projects = data.projects.filter(p => !departmentId || p.departmentId === departmentId);
  const projectIds = selected === null ? undefined : selected.filter(id => projects.some(p => p.id === id)).join(",");
  const count = selected === null ? projects.length : projectIds!.split(",").filter(Boolean).length;
  const comparison = useMemo(() => previousPeriod(range.from, range.to), [range]);
  const filter = { projectIds, departmentId: departmentId || undefined };
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null); setReport(null); setPrevious(null);
    if (projectIds === "") { setLoading(false); return; }
    const f = { projectIds, departmentId: departmentId || undefined, groupBy };
    void Promise.all([reportsApi.summary({ ...range, ...f }), reportsApi.summary({ ...comparison, ...f }).catch(() => null)])
      .then(([current, prev]) => { if (alive) { setReport(current); setPrevious(prev); } }, e => { if (alive) setError(errText(e, t("reports.loadFailed"))); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range, comparison, projectIds, departmentId, groupBy, tick, t, errText]);
  const applyPreset = (id: string) => {
    const p = presets.find(x => x.id === id); if (!p) return;
    const to = today(); setPreset(id); setRange({ from: shift(to, 1 - p.days), to });
  };
  const reset = () => { applyPreset("month"); setDepartmentId(""); setSelected(null); };
  const exportCsv = async (scope: ReportScope) => {
    setExporting(true);
    try { await downloadReportCsv({ ...range, ...filter, scope }); toast("success", t("reports.exported")); }
    catch (e) { toast("error", errText(e, t("reports.exportFailed"))); }
    finally { setExporting(false); }
  };
  const formatDate = (s: string) => date(s).toLocaleDateString(lang, { day: "numeric", month: "short", timeZone: "UTC" });
  const days = (n: number | null) => n === null ? "—" : t("reports.days", { count: n.toLocaleString(lang) });
  const delta = (n: number | null, old: number | null | undefined) => {
    if (n === null || old == null) return t("reports.noComparison");
    if (old === 0) return t("reports.previousValue", { count: old });
    const change = Math.round((n - old) / old * 100);
    return t("reports.change", { change: `${change > 0 ? "+" : ""}${change}%` });
  };
  const totals = report?.totals;
  const empty = !loading && !error && (!totals || (!totals.created && !totals.closed));
  const metrics: { label: TKey; value: string; hint: string; tone?: string }[] = totals ? [
    { label: "reports.closedPeriod", value: String(totals.closed), hint: delta(totals.closed, previous?.totals.closed), tone: "done" },
    { label: "reports.createdPeriod", value: String(totals.created), hint: delta(totals.created, previous?.totals.created) },
    { label: "reports.openNow", value: String(totals.open), hint: t("reports.currentSnapshot") },
    { label: "reports.overdue", value: String(totals.overdue), hint: t("reports.currentSnapshot"), tone: "danger" },
    { label: "reports.avgLead", value: days(totals.avgLeadDays), hint: `${t("reports.median").toLocaleLowerCase(lang)} ${days(totals.medianLeadDays)} · ${delta(totals.avgLeadDays, previous?.totals.avgLeadDays)}` },
  ] : [];
  return <div className="reports-view">
    <DashboardTabs current="reports" dashboards={dashboards.list} actions={<Menu label={t("reports.exportScope")} placement="bottom-end" trigger={p => <Button {...p} size="sm" variant="secondary" disabled={loading || exporting || count === 0} iconLeft={<IcDownload size={16} />} iconRight={<IcChevD size={14} />}>{t(exporting ? "reports.preparing" : "reports.export")}</Button>} items={scopes.map(scope => ({ id: scope, label: `${t("reports.scope." + scope as TKey)} · CSV`, onSelect: () => void exportCsv(scope) }))} />}/>
    <div className="reports-filters">
      <Tabs label={t("reports.period")} mode="filter" value={preset} onChange={applyPreset} items={presets.map(p => ({ id: p.id, label: t(`reports.preset.${p.id}`) }))} />
      <div className="reports-date-range"><DatePicker label={t("reports.from")} placeholder={t("date.empty")} lang={lang} markOverdue={false} value={range.from} max={range.to} onChange={v => { if (v) { setRange(r => ({ ...r, from: v })); setPreset("custom"); } }}/><span aria-hidden="true">—</span><DatePicker label={t("reports.to")} placeholder={t("date.empty")} lang={lang} markOverdue={false} value={range.to} min={range.from} onChange={v => { if (v) { setRange(r => ({ ...r, to: v })); setPreset("custom"); } }}/></div>
      <Menu label={t("reports.department")} trigger={p => <Button {...p} size="sm" variant="secondary" iconRight={<IcChevD size={14} />}>{departments.find(d => d.id === departmentId)?.name ?? t("reports.allDepartments")}</Button>} items={[{ id: "all", label: t("reports.allDepartments"), onSelect: () => { setDepartmentId(""); setSelected(null); } }, ...departments.map(d => ({ id: d.id, label: d.name, onSelect: () => { setDepartmentId(d.id); setSelected(null); } }))]} />
      <Popover label={t("reports.project")} className="reports-project-picker" trigger={p => <Button {...p} size="sm" variant="secondary" iconRight={<IcChevD size={14} />}>{t("reports.projectsSelected", { count, noun: tn(count, "noun.project.one", "noun.project.few", "noun.project.many").toLocaleLowerCase(lang) })}</Button>}>
        {projects.length > REPORT_PROJECT_LIMIT && <p className="px-2 py-1 text-[13px] text-sub">{t("reports.projectLimit", { count: REPORT_PROJECT_LIMIT })}</p>}
        <Checkbox label={t("reports.allProjects")} checked={count === projects.length && count > 0} indeterminate={count > 0 && count < projects.length} onChange={checked => setSelected(checked ? null : [])}/>
        {projects.map(p => <Checkbox key={p.id} label={`${p.key} · ${p.name}`} checked={selected === null || selected.includes(p.id)} disabled={selected === null ? projects.length > REPORT_PROJECT_LIMIT : selected.length >= REPORT_PROJECT_LIMIT && !selected.includes(p.id)} onChange={checked => setSelected(cur => selectReportProject(cur, projects.map(x => x.id), p.id, checked))}/>)}
      </Popover>
      <span className="reports-comparison">{t("reports.comparison", { from: formatDate(comparison.from), to: formatDate(comparison.to) })}</span>
    </div>
    <div className="reports-content" aria-busy={loading}>
      {error && <div role="alert" className="reports-error"><span>{error}</span><Button size="sm" variant="secondary" onClick={() => setTick(n => n + 1)}>{t("reports.retry")}</Button></div>}
      {loading && <div className="skeleton reports-loading" aria-label={t("common.loading")} />}
      {empty && <EmptyState icon={<IcReport size={24} />} title={t("reports.emptyTitle")} sub={t("reports.emptySub")} action={<Button size="sm" variant="secondary" onClick={reset}>{t("common.reset")}</Button>} />}
      {!loading && !empty && report && totals && <>
        <div className="reports-metrics">{metrics.map(m => <section key={m.label} className="reports-metric" data-tone={m.tone}><h2>{t(m.label)}</h2><strong>{m.value}</strong><p>{m.hint}</p></section>)}</div>
        <div className="reports-panels"><Trend report={report}/><section className="reports-panel reports-breakdown">
          <div className="reports-panel-head"><h2>{t(`reports.group.${groupBy}`)}</h2><Menu label={t("reports.grouping")} placement="bottom-end" trigger={p => <Button {...p} size="sm" variant="ghost" iconRight={<IcChevD size={14} />}>{t("reports.grouping")}</Button>} items={groups.map(g => ({ id: g, label: t(`reports.group.${g}`), onSelect: () => setGroupBy(g) }))}/></div>
          <div className="reports-table-scroll ds-focus" tabIndex={0} role="region" aria-label={t(`reports.group.${groupBy}`)}><table><caption className="sr-only">{t(`reports.group.${groupBy}`)}</caption><thead><tr><th>{t("reports.table.name")}</th><th>{t("reports.table.created")}</th><th>{t("reports.table.closed")}</th><th>{t("reports.overdue")}</th></tr></thead><tbody>{report.rows.map(r => <tr key={r.key}><th scope="row">{r.label}</th><td>{r.created}</td><td data-tone="done">{r.closed}</td><td data-tone="danger">{r.overdue ?? "—"}</td></tr>)}</tbody></table></div>
        </section></div>
        <p className="reports-footnote">{t("reports.footnote")}</p>
      </>}
    </div>
  </div>;
}
