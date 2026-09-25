import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useStore } from "../store";
import {
  downloadReportCsv,
  reportsApi,
  ApiError,
  type ReportGroup,
  type ReportScope,
  type ReportSummary,
} from "../api";
import { IcDownload, IcReport, IcSearch } from "../icons";
import { Empty } from "../ui";
import { useT } from "../i18n";

/** Готовые периоды — закрывают почти все реальные запросы «что сделали за…». */
type PresetId = "month" | "quarter" | "year" | "custom";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

const PRESETS: { id: PresetId; labelKey: "reports.preset.month" | "reports.preset.quarter" | "reports.preset.year"; from: () => string }[] = [
  { id: "month", labelKey: "reports.preset.month", from: () => daysAgo(30) },
  { id: "quarter", labelKey: "reports.preset.quarter", from: () => daysAgo(90) },
  { id: "year", labelKey: "reports.preset.year", from: () => daysAgo(365) },
];

const GROUPS: ReportGroup[] = ["project", "assignee", "type", "priority"];
const SCOPES: ReportScope[] = ["closed", "created", "open"];

/** Крупная цифра сводки. Четыре таких плитки — это и есть суть экрана,
 *  поэтому здесь заливка уместна; ниже по странице её уже нет. */
function Tile({ n, label, hint, tone }: { n: string; label: string; hint?: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-danger" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <p className={`font-disp text-[26px] font-semibold leading-none tracking-tight tabular-nums ${color}`}>{n}</p>
      <p className="mt-1.5 text-[12px] font-semibold text-faint">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-sub">{hint}</p>}
    </div>
  );
}

/** Недельный тренд закрытий: площадь с градиентом и линия, без библиотеки
 *  (данных — десяток точек, чарт-пакет был бы лишним весом). Всё — атрибуты
 *  SVG из данных, а не инлайн-стили: под CSP не плодит динамических правил
 *  (ADR-0010). Наведение на неделю подсвечивает её и показывает число. */
function Trend({ points }: { points: { week: string; closed: number }[] }) {
  const { t, lang } = useT();
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  if (points.length < 2) return null;
  const W = 600;
  const H = 120;
  const PAD = 10;
  const max = Math.max(...points.map((p) => p.closed), 1);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => PAD + (1 - v / max) * (H - PAD * 2);
  // Сглаженная кривая: кубические Безье через середины отрезков.
  let line = `M${x(0)},${y(points[0].closed)}`;
  for (let i = 1; i < points.length; i++) {
    const mx = (x(i - 1) + x(i)) / 2;
    line += ` C${mx},${y(points[i - 1].closed)} ${mx},${y(points[i].closed)} ${x(i)},${y(points[i].closed)}`;
  }
  const area = `${line} L${W},${H} L0,${H}Z`;
  const fmt = (w: string) => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "short" }).format(new Date(w));
  const hi = hover ?? points.length - 1;
  return (
    <section className="mt-5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[13px] font-medium text-sub">{t("reports.trend.title")}</h2>
        <span className="ml-auto text-[12px] tabular text-faint">
          {t("reports.trend.week", { week: fmt(points[hi].week), count: points[hi].closed })}
        </span>
      </div>
      <div className="surface-raised relative mt-2.5 overflow-hidden rounded-xl px-0 pb-2 pt-3 ring-1 ring-inset ring-line/70">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-32 w-full" onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id={`tr-fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent-solid)" stopOpacity="0.32" />
              <stop offset="1" stopColor="var(--accent-solid)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`tr-line-${gid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--status-todo)" />
              <stop offset="1" stopColor="var(--accent-solid)" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={W} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)} stroke="var(--border-subtle)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={area} fill={`url(#tr-fill-${gid})`} />
          <path d={line} fill="none" stroke={`url(#tr-line-${gid})`} strokeWidth="2.25" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <line x1={x(hi)} x2={x(hi)} y1="0" y2={H} stroke="var(--accent-solid)" strokeOpacity="0.35" vectorEffect="non-scaling-stroke" />
          {points.map((p, i) => (
            <rect
              key={p.week}
              x={x(i) - W / (points.length - 1) / 2}
              y="0"
              width={W / (points.length - 1)}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            >
              <title>{t("reports.trend.week", { week: fmt(p.week), count: p.closed })}</title>
            </rect>
          ))}
        </svg>
        <div className="mt-1 flex justify-between px-3 text-[10.5px] tabular text-faint">
          <span>{fmt(points[0].week)}</span>
          <span>{fmt(points[points.length - 1].week)}</span>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-faint">{t("reports.trend.hint", { max })}</p>
    </section>
  );
}

export default function ReportsView() {
  const { t, tn, lang } = useT();
  const { data, toast } = useStore();

  const [preset, setPreset] = useState<PresetId>("month");
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(iso(new Date()));
  const [groupBy, setGroupBy] = useState<ReportGroup>("project");
  const [scope, setScope] = useState<ReportScope>("closed");
  /** "" — по всем видимым проектам (свод), иначе конкретный проект. */
  const [projectId, setProjectId] = useState("");
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const applyPreset = (id: PresetId) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setFrom(p.from());
    setTo(iso(new Date()));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await reportsApi.summary({ from, to, groupBy, projectId: projectId || undefined }));
    } catch (e) {
      setError(e instanceof ApiError && lang === "ru" ? e.message : t("reports.loadFailed"));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, groupBy, projectId, t, lang]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadReportCsv({ from, to, scope, projectId: projectId || undefined });
      toast("success", t("reports.exported"));
    } catch (e) {
      toast("error", e instanceof ApiError && lang === "ru" ? e.message : t("reports.exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  const totals = report?.totals;
  const maxRow = useMemo(() => Math.max(1, ...(report?.rows ?? []).map((r) => r.closed)), [report]);

  const field =
    "h-8 rounded-md border border-line bg-panel px-2 text-[12.5px] text-ink focus:border-accent focus:outline-none";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* шапка + фильтры */}
      <div className="px-4 pb-3 pt-5 sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-2">
            <h1 className="font-disp text-[20px] font-semibold tracking-[-0.02em] text-ink">{t("reports.title")}</h1>
            <p className="mt-0.5 text-[11.5px] text-faint">
              {report
                ? t("reports.projectCount", { count: report.projectCount, noun: tn(report.projectCount, "noun.project.one", "noun.project.few", "noun.project.many").toLowerCase() })
                : t("common.loading")}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                className={`h-8 rounded-md border px-2.5 text-[12.5px] font-medium transition-colors ${
                  preset === p.id ? "border-accent bg-accentsoft text-accent" : "border-line bg-panel text-sub hover:border-line2"
                }`}
              >
                {t(p.labelKey)}
              </button>
            ))}
            <label className="flex items-center gap-1.5 text-[11.5px] text-faint">
              {t("reports.from")}
              <input
                type="date"
                id="report-from"
                value={from}
                max={to}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPreset("custom");
                }}
                className={field}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11.5px] text-faint">
              {t("reports.to")}
              <input
                type="date"
                id="report-to"
                value={to}
                min={from}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPreset("custom");
                }}
                className={field}
              />
            </label>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <select
            id="report-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            aria-label={t("reports.project")}
            className={field}
          >
            <option value="">{t("reports.allProjects")}</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} · {p.name}
              </option>
            ))}
          </select>

          <select
            id="report-group"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as ReportGroup)}
            aria-label={t("reports.grouping")}
            className={field}
          >
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {t(`reports.group.${g}`)}
              </option>
            ))}
          </select>

          <span className="ml-auto flex items-center gap-2">
            <select
              id="report-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as ReportScope)}
              aria-label={t("reports.exportScope")}
              className={field}
            >
              {SCOPES.map((sc) => (
                <option key={sc} value={sc}>
                  {t("reports.exportOption", { scope: t(`reports.scope.${sc}`) })}
                </option>
              ))}
            </select>
            <button
              onClick={exportCsv}
              disabled={exporting || loading}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12.5px] font-semibold text-onaccent transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <IcDownload size={13} />
              {t(exporting ? "reports.preparing" : "reports.downloadCsv")}
            </button>
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 py-4 sm:px-6">
        {error && (
          <div className="mb-4 rounded-lg border border-danger/40 bg-dangersoft px-4 py-3 text-[13px] text-danger">
            {error}
            <button onClick={() => void load()} className="ml-2 font-semibold underline">
              {t("reports.retry")}
            </button>
          </div>
        )}

        {loading && !report && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-[84px] rounded-lg" />
            ))}
          </div>
        )}

        {report && totals && (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Tile n={String(totals.closed)} label={t("reports.closedPeriod")} tone="ok" />
              <Tile n={String(totals.created)} label={t("reports.createdPeriod")} />
              <Tile n={String(totals.open)} label={t("reports.openNow")} />
              <Tile
                n={String(totals.overdue)}
                label={t("reports.overdue")}
                tone={totals.overdue > 0 ? "warn" : undefined}
              />
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Tile
                n={totals.avgLeadDays === null ? "—" : t("reports.days", { count: totals.avgLeadDays })}
                label={t("reports.avgLead")}
                hint={t("reports.avgLeadHint")}
              />
              <Tile
                n={totals.medianLeadDays === null ? "—" : t("reports.days", { count: totals.medianLeadDays })}
                label={t("reports.median")}
                hint={t("reports.medianHint")}
              />
            </div>

            <Trend points={report.trend} />

            <section className="mt-5">
              <h2 className="text-[13px] font-medium text-sub">
                {t(`reports.group.${groupBy}`)}
              </h2>

              {report.rows.length === 0 ? (
                <div className="mt-2.5">
                  <Empty
                    icon={<IcReport size={22} />}
                    title={t("reports.emptyTitle")}
                    sub={t("reports.emptySub")}
                  />
                </div>
              ) : (
                <div className="mt-2.5 overflow-x-auto rounded-lg border border-line bg-panel">
                  <table className="w-full min-w-[560px] text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-[12px] text-faint">
                        <th className="px-3 py-2 text-left font-semibold">{t("reports.table.name")}</th>
                        <th className="px-3 py-2 text-right font-semibold">{t("reports.table.closed")}</th>
                        <th className="px-3 py-2 text-right font-semibold">{t("reports.table.created")}</th>
                        <th className="px-3 py-2 text-right font-semibold">{t("reports.table.open")}</th>
                        <th className="px-3 py-2 text-right font-semibold">{t("reports.table.avgDays")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((r) => (
                        <tr key={r.key} className="border-b border-line last:border-0">
                          <td className="px-3 py-2">
                            <span className="text-ink">{r.label}</span>
                            {/* Полоска доли: сравнивать строки глазами быстрее, чем цифры. */}
                            <span className="mt-1 block h-1 rounded-full bg-todosoft">
                              <span
                                className="block h-1 rounded-full bg-accent"
                                style={{ width: `${(r.closed / maxRow) * 100}%` }}
                              />
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-ok">{r.closed}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-sub">{r.created}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-sub">{r.open}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-sub">
                            {r.avgLeadDays === null ? "—" : r.avgLeadDays}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-faint">
              <IcSearch size={12} className="mt-0.5 shrink-0" />
              <span>
                {t("reports.footnote")}
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
