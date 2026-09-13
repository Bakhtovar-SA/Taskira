import { useCallback, useEffect, useMemo, useState } from "react";
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

/** Готовые периоды — закрывают почти все реальные запросы «что сделали за…». */
type PresetId = "month" | "quarter" | "year" | "custom";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

const PRESETS: { id: PresetId; label: string; from: () => string }[] = [
  { id: "month", label: "30 дней", from: () => daysAgo(30) },
  { id: "quarter", label: "Квартал", from: () => daysAgo(90) },
  { id: "year", label: "Год", from: () => daysAgo(365) },
];

const GROUPS: { id: ReportGroup; label: string }[] = [
  { id: "project", label: "По проектам" },
  { id: "assignee", label: "По исполнителям" },
  { id: "type", label: "По типам" },
  { id: "priority", label: "По приоритетам" },
];

const SCOPES: { id: ReportScope; label: string }[] = [
  { id: "closed", label: "закрытые за период" },
  { id: "created", label: "созданные за период" },
  { id: "open", label: "открытые сейчас" },
];

const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1) return one;
  if (m10 >= 2 && m10 <= 4) return few;
  return many;
};

/** Крупная цифра сводки. Четыре таких плитки — это и есть суть экрана,
 *  поэтому здесь заливка уместна; ниже по странице её уже нет. */
function Tile({ n, label, hint, tone }: { n: string; label: string; hint?: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-danger" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <p className={`font-disp text-[26px] font-bold leading-none tracking-tight tabular-nums ${color}`}>{n}</p>
      <p className="mt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-sub">{hint}</p>}
    </div>
  );
}

/** Недельный тренд закрытий. Своя мини-диаграмма, без библиотеки: данных мало,
 *  а тянуть чарт-пакет ради десятка столбиков — лишний вес в бандле. */
function Trend({ points }: { points: { week: string; closed: number }[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points.map((p) => p.closed), 1);
  return (
    <section className="mt-5">
      <h2 className="text-[12px] font-bold uppercase tracking-wider text-sub">Закрытия по неделям</h2>
      <div className="mt-2.5 flex h-24 items-end gap-1 overflow-x-auto rounded-lg border border-line bg-panel p-3">
        {points.map((p) => (
          <div key={p.week} className="flex min-w-[18px] flex-1 flex-col items-center gap-1" title={`Неделя с ${p.week}: ${p.closed}`}>
            <span className="text-[9.5px] font-semibold tabular-nums text-faint">{p.closed}</span>
            <div
              className="w-full rounded-t bg-accent transition-all"
              style={{ height: `${Math.max(3, (p.closed / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10.5px] text-faint">
        Каждый столбик — неделя; подпись — сколько задач закрыто. Максимум за период: {max}.
      </p>
    </section>
  );
}

export default function ReportsView() {
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
      setError(e instanceof ApiError ? e.message : "Не удалось загрузить отчёт");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, groupBy, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadReportCsv({ from, to, scope, projectId: projectId || undefined });
      toast("success", "Выгрузка скачана");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Не удалось сформировать выгрузку");
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
      <div className="border-b border-line bg-panel/70 px-4 py-3.5 sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-2">
            <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">Отчёты</h1>
            <p className="mt-0.5 text-[11.5px] text-faint">
              {report
                ? `${report.projectCount} ${plural(report.projectCount, "проект", "проекта", "проектов")} в отчёте`
                : "Загрузка…"}
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
                {p.label}
              </button>
            ))}
            <label className="flex items-center gap-1.5 text-[11.5px] text-faint">
              с
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
              по
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
            aria-label="Проект"
            className={field}
          >
            <option value="">Все доступные проекты</option>
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
            aria-label="Разбивка"
            className={field}
          >
            {GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>

          <span className="ml-auto flex items-center gap-2">
            <select
              id="report-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as ReportScope)}
              aria-label="Что выгружать"
              className={field}
            >
              {SCOPES.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  Выгрузить: {sc.label}
                </option>
              ))}
            </select>
            <button
              onClick={exportCsv}
              disabled={exporting || loading}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <IcDownload size={13} />
              {exporting ? "Готовим…" : "Скачать CSV"}
            </button>
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 py-4 sm:px-6">
        {error && (
          <div className="mb-4 rounded-lg border border-danger/40 bg-dangersoft px-4 py-3 text-[13px] text-danger">
            {error}
            <button onClick={() => void load()} className="ml-2 font-bold underline">
              Повторить
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
              <Tile n={String(totals.closed)} label="Закрыто за период" tone="ok" />
              <Tile n={String(totals.created)} label="Создано за период" />
              <Tile n={String(totals.open)} label="Открыто сейчас" />
              <Tile
                n={String(totals.overdue)}
                label="Просрочено"
                tone={totals.overdue > 0 ? "warn" : undefined}
              />
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Tile
                n={totals.avgLeadDays === null ? "—" : `${totals.avgLeadDays} дн`}
                label="Среднее время в работе"
                hint="от создания до закрытия"
              />
              <Tile
                n={totals.medianLeadDays === null ? "—" : `${totals.medianLeadDays} дн`}
                label="Медиана"
                hint="устойчивее среднего к единичным «хвостам»"
              />
            </div>

            <Trend points={report.trend} />

            <section className="mt-5">
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-sub">
                {GROUPS.find((g) => g.id === groupBy)?.label}
              </h2>

              {report.rows.length === 0 ? (
                <div className="mt-2.5">
                  <Empty
                    icon={<IcReport size={22} />}
                    title="За этот период данных нет"
                    sub="Измените период или выберите другой проект."
                  />
                </div>
              ) : (
                <div className="mt-2.5 overflow-x-auto rounded-lg border border-line bg-panel">
                  <table className="w-full min-w-[560px] text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-[11px] uppercase tracking-wide text-faint">
                        <th className="px-3 py-2 text-left font-semibold">Название</th>
                        <th className="px-3 py-2 text-right font-semibold">Закрыто</th>
                        <th className="px-3 py-2 text-right font-semibold">Создано</th>
                        <th className="px-3 py-2 text-right font-semibold">Открыто</th>
                        <th className="px-3 py-2 text-right font-semibold">Ср. дней</th>
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
                В отчёт входят только проекты, доступные вам в интерфейсе. Архивные задачи из истории
                не выпадают — архив убирает их с доски, но не из отчётов.
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
