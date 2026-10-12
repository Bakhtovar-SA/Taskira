/** Окна правки дашборда (ADR-0022): «Добавить виджет» — каталог по группам; «Настройки виджета» — заголовок,
 *  область и настройки типа. Изменения применяются сразу — виджет на дашборде перестраивается за окном. */
import { useId } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { Dialog, Button, Input } from "../ds";
import { Select } from "../ds/Select";
import { LIMITS } from "../validation";
import { COUNT_METRICS, BREAKDOWN_GROUPS, ISSUE_PRESETS, WIDGET_PERIODS, PROJECT_WIDGET_LIMITS, MILESTONE_PERIOD_LIMITS } from "./spec";
import { catalogFor, CATALOG_GROUPS, defaultTitleKey, type CatalogItem, type Widget } from "./catalog";

function Row({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-medium text-sub">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

export function AddWidgetDialog({ open, onClose, onPick, project = false }: { open: boolean; onClose: () => void; onPick: (item: CatalogItem) => void; project?: boolean }) {
  const { t } = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t("dash.addWidget")} size="lg">
      <div className="space-y-4">
        {CATALOG_GROUPS.filter(g => catalogFor(project).some(c => c.group === g.id)).map((g) => (
          <section key={g.id}>
            <h3 className="mb-1.5 text-[13px] font-semibold text-faint">{t(g.labelKey)}</h3>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {catalogFor(project).filter((c) => c.group === g.id).map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onPick(c)}
                  className="rounded-lg px-3 py-2 text-left text-[14px] text-ink ring-1 ring-inset ring-line/70 transition-colors hover:bg-hover hover:ring-accent/50"
                >
                  {t(c.titleKey)}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

export function WidgetSettingsDialog({ w, orgScope, onChange, onClose }: { w: Widget; orgScope: boolean; onChange: (next: Widget) => void; onClose: () => void }) {
  const { t, tn } = useT();
  const { data } = useStore();
  const set = (patch: Partial<Widget>) => onChange({ ...w, ...patch } as Widget);
  const days = (n: number) => t("dash.days", { n, noun: tn(n, "noun.day.one", "noun.day.few", "noun.day.many") });
  const withProjects = new Set(data.projects.map((p) => p.departmentId));
  const departments = data.departments.filter((d) => withProjects.has(d.id));
  const scope = w.projectId ? `p:${w.projectId}` : w.departmentId ? `d:${w.departmentId}` : "";
  const limits = w.type === "projects" ? [PROJECT_WIDGET_LIMITS.min, 10, 20, 30, PROJECT_WIDGET_LIMITS.max] : w.type === "activity" ? [5, 10, 15, 20, 30] : w.type === "progress" ? [5, 10, 15, 20, 30] : [3, 5, 8, 10, 15, 20];

  return (
    <Dialog open onClose={onClose} title={t("dash.widgetSettings")} size="sm" footer={<Button variant="primary" onClick={onClose}>{t("dash.done")}</Button>}>
      <div className="space-y-3">
        <Input
          label={t("dash.widgetTitle")}
          value={w.title ?? ""}
          placeholder={t(defaultTitleKey(w))}
          maxLength={LIMITS.dashboard.widgetTitle.max}
          onChange={(e) => set({ title: e.target.value || undefined })}
        />
        {orgScope && (
          <Row label={t("dash.scope")}>
            {(id) => (
              <Select
                id={id}
                value={scope}
                onChange={(v) => set({ projectId: v.startsWith("p:") ? v.slice(2) : undefined, departmentId: v.startsWith("d:") ? v.slice(2) : undefined })}
                options={[
                  { value: "", label: t("dash.scopeAll") },
                  ...(departments.length > 1 ? [{ group: t("dash.scopeDepartments"), options: departments.map((d) => ({ value: `d:${d.id}`, label: d.name })) }] : []),
                  { group: t("dash.scopeProjects"), options: data.projects.map((p) => ({ value: `p:${p.id}`, label: `${p.key} · ${p.name}` })) },
                ]}
              />
            )}
          </Row>
        )}
        {w.type === "count" && (
          <Row label={t("dash.metric")}>
            {(id) => <Select id={id} value={w.metric} onChange={(metric) => set({ metric })} options={COUNT_METRICS.map((m) => ({ value: m, label: t(`dash.w.count.${m}`) }))} />}
          </Row>
        )}
        {((w.type === "count" && (w.metric === "closed" || w.metric === "created")) || w.type === "trend") && (
          <Row label={t("dash.period")}>
            {(id) => <Select id={id} value={w.periodDays} onChange={(periodDays) => set({ periodDays })} options={WIDGET_PERIODS.map((d) => ({ value: d, label: days(d) }))} />}
          </Row>
        )}
        {w.type === "breakdown" && (
          <>
            <Row label={t("dash.groupBy")}>
              {(id) => <Select id={id} value={w.groupBy} onChange={(groupBy) => set({ groupBy })} options={BREAKDOWN_GROUPS.map((g) => ({ value: g, label: t(`dash.w.breakdown.${g}`) }))} />}
            </Row>
            <Row label={t("dash.chart")}>
              {(id) => <Select id={id} value={w.chart} onChange={(chart) => set({ chart })} options={[{ value: "donut" as const, label: t("dash.chart.donut") }, { value: "bars" as const, label: t("dash.chart.bars") }]} />}
            </Row>
          </>
        )}
        {w.type === "issues" && (
          <Row label={t("dash.preset")}>
            {(id) => <Select id={id} value={w.preset} onChange={(preset) => set({ preset })} options={ISSUE_PRESETS.map((p) => ({ value: p, label: t(`dash.w.issues.${p}`) }))} />}
          </Row>
        )}
        {w.type === "milestones" && <Input label={t("dash.period")} type="number" min={MILESTONE_PERIOD_LIMITS.min} max={MILESTONE_PERIOD_LIMITS.max} value={w.periodDays} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= MILESTONE_PERIOD_LIMITS.min && n <= MILESTONE_PERIOD_LIMITS.max) set({ periodDays: n }); }} />}
        {(w.type === "issues" || w.type === "workload" || w.type === "progress" || w.type === "activity" || w.type === "projects") && (
          <Row label={t("dash.limit")}>
            {(id) => (
              <Select id={id} value={w.limit} onChange={(limit) => set({ limit })} options={[...new Set([...limits, w.limit])].sort((a, b) => a - b).map((n) => ({ value: n, label: String(n) }))} />
            )}
          </Row>
        )}
      </div>
    </Dialog>
  );
}
