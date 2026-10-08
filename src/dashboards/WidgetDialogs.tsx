/** Окна правки дашборда (ADR-0022): «Добавить виджет» — каталог по группам; «Настройки виджета» — заголовок,
 *  область и настройки типа. Изменения применяются сразу — виджет на дашборде перестраивается за окном. */
import { useId } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { Dialog, Button, Input } from "../ds";
import { LIMITS } from "../validation";
import { COUNT_METRICS, BREAKDOWN_GROUPS, ISSUE_PRESETS, WIDGET_PERIODS, PROJECT_WIDGET_LIMITS, MILESTONE_PERIOD_LIMITS } from "./spec";
import { catalogFor, CATALOG_GROUPS, defaultTitleKey, type CatalogItem, type Widget } from "./catalog";

const selectCls =
  "h-8 w-full rounded-lg border border-linesoft bg-sunken px-2 text-[13.5px] font-medium text-ink outline-none transition-[border-color,box-shadow] hover:border-line focus:border-accent focus:shadow-focus";

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
              <select
                id={id}
                className={selectCls}
                value={scope}
                onChange={(e) => {
                  const v = e.target.value;
                  set({ projectId: v.startsWith("p:") ? v.slice(2) : undefined, departmentId: v.startsWith("d:") ? v.slice(2) : undefined });
                }}
              >
                <option value="">{t("dash.scopeAll")}</option>
                {departments.length > 1 && (
                  <optgroup label={t("dash.scopeDepartments")}>
                    {departments.map((d) => (
                      <option key={d.id} value={`d:${d.id}`}>
                        {d.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={t("dash.scopeProjects")}>
                  {data.projects.map((p) => (
                    <option key={p.id} value={`p:${p.id}`}>
                      {p.key} · {p.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            )}
          </Row>
        )}
        {w.type === "count" && (
          <Row label={t("dash.metric")}>
            {(id) => (
              <select id={id} className={selectCls} value={w.metric} onChange={(e) => set({ metric: e.target.value as typeof w.metric })}>
                {COUNT_METRICS.map((m) => (
                  <option key={m} value={m}>
                    {t(`dash.w.count.${m}`)}
                  </option>
                ))}
              </select>
            )}
          </Row>
        )}
        {((w.type === "count" && (w.metric === "closed" || w.metric === "created")) || w.type === "trend") && (
          <Row label={t("dash.period")}>
            {(id) => (
              <select id={id} className={selectCls} value={w.periodDays} onChange={(e) => set({ periodDays: Number(e.target.value) as typeof w.periodDays })}>
                {WIDGET_PERIODS.map((d) => (
                  <option key={d} value={d}>
                    {days(d)}
                  </option>
                ))}
              </select>
            )}
          </Row>
        )}
        {w.type === "breakdown" && (
          <>
            <Row label={t("dash.groupBy")}>
              {(id) => (
                <select id={id} className={selectCls} value={w.groupBy} onChange={(e) => set({ groupBy: e.target.value as typeof w.groupBy })}>
                  {BREAKDOWN_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {t(`dash.w.breakdown.${g}`)}
                    </option>
                  ))}
                </select>
              )}
            </Row>
            <Row label={t("dash.chart")}>
              {(id) => (
                <select id={id} className={selectCls} value={w.chart} onChange={(e) => set({ chart: e.target.value as typeof w.chart })}>
                  <option value="donut">{t("dash.chart.donut")}</option>
                  <option value="bars">{t("dash.chart.bars")}</option>
                </select>
              )}
            </Row>
          </>
        )}
        {w.type === "issues" && (
          <Row label={t("dash.preset")}>
            {(id) => (
              <select id={id} className={selectCls} value={w.preset} onChange={(e) => set({ preset: e.target.value as typeof w.preset })}>
                {ISSUE_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {t(`dash.w.issues.${p}`)}
                  </option>
                ))}
              </select>
            )}
          </Row>
        )}
        {w.type === "milestones" && <Input label={t("dash.period")} type="number" min={MILESTONE_PERIOD_LIMITS.min} max={MILESTONE_PERIOD_LIMITS.max} value={w.periodDays} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= MILESTONE_PERIOD_LIMITS.min && n <= MILESTONE_PERIOD_LIMITS.max) set({ periodDays: n }); }} />}
        {(w.type === "issues" || w.type === "workload" || w.type === "progress" || w.type === "activity" || w.type === "projects") && (
          <Row label={t("dash.limit")}>
            {(id) => (
              <select id={id} className={selectCls} value={w.limit} onChange={(e) => set({ limit: Number(e.target.value) })}>
                {[...new Set([...limits, w.limit])].sort((a, b) => a - b).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
          </Row>
        )}
      </div>
    </Dialog>
  );
}
