import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { RecurringConfigDto, RecurringRuleDto, RecurringRunDto } from "../../../server/src/contract";
import { recurringApi } from "../../api";
import { Button, IconButton } from "../../ds/Button";
import { Dialog, SidePanel } from "../../ds/Dialog";
import { Tag } from "../../ds/Display";
import { Menu, type MenuEntry } from "../../ds/Overlay";
import { IcDots, IcPlus } from "../../icons";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { LIMITS } from "../../validation";
import { recurrenceText, recurringDate } from "../../recurrenceText";
import { pathForIssue } from "../../router";
import { SettingsCard, SettingsPage } from "./parts";
const RecurringRuleForm = lazy(() => import("./RecurringRuleForm"));

function RunTag({ result }: { result: RecurringRunDto["result"] | null }) {
  const { t } = useT();
  return <Tag size="sm" tone={result === "created" ? "green" : result === "failed" ? "red" : result === "skipped_open" ? "amber" : "gray"}>
    {result ? t(`recurring.result.${result}`) : t("recurring.never")}</Tag>;
}
function RuleTime({ value, rule }: { value: string | null; rule: RecurringRuleDto }) {
  const { lang } = useT();
  return value ? <time dateTime={value} title={rule.timeZone}>{recurringDate(value, rule.timeZone, lang)}
    {rule.timeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone && <span className="block text-faint">{rule.timeZone}</span>}</time> : <>—</>;
}

export default function ProjectRecurring() {
  const { t, tn, errText } = useT(); const { data, can, toast } = useStore(); const pid = data.currentProjectId;
  const editable = can("manageRecurring");
  const [rows, setRows] = useState<RecurringRuleDto[]>([]), [config, setConfig] = useState<RecurringConfigDto | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState<RecurringRuleDto | "new" | null>(null), [history, setHistory] = useState<RecurringRuleDto | null>(null);
  const [confirm, setConfirm] = useState<{ action: "remove" | "runNow"; rule: RecurringRuleDto } | null>(null), [busy, setBusy] = useState(false);
  const epoch = useRef(0), latch = useRef(false);
  const text = useRef({ t, errText }); text.current = { t, errText };
  const load = useCallback(() => {
    const current = ++epoch.current; setLoading(true); setError(null);
    Promise.all([recurringApi.config(), recurringApi.list(pid)]).then(([cfg, rules]) => {
      if (current === epoch.current) { setConfig(cfg); setRows(rules); setLoading(false); }
    }, failure => { if (current === epoch.current) { setError(failure); setLoading(false); } });
  }, [pid]);
  useEffect(() => { load(); return () => { ++epoch.current; }; }, [load]);
  const replace = (rule: RecurringRuleDto) => setRows(old => old.map(value => value.id === rule.id ? rule : value));
  const act = async (action: "pause" | "resume" | "remove" | "runNow", rule: RecurringRuleDto) => {
    if (!editable || latch.current) return;
    latch.current = true; setBusy(true); const current = epoch.current;
    try {
      if (action === "pause" || action === "resume") {
        const saved = await recurringApi[action](pid, rule.id);
        if (current === epoch.current) replace(saved);
      } else if (action === "remove") {
        await recurringApi.remove(pid, rule.id);
        if (current === epoch.current) { setRows(old => old.filter(value => value.id !== rule.id)); toast("info", text.current.t("recurring.removed")); }
      } else {
        const run = await recurringApi.runNow(pid, rule.id);
        if (current === epoch.current) {
          replace({ ...rule, lastResult: run.result, lastRunAt: run.ranAt });
          toast(run.result === "failed" ? "error" : run.result === "created" ? "success" : "info", text.current.t(`recurring.result.${run.result}`));
        }
      }
      if (current === epoch.current) setConfirm(null);
    } catch (failure) {
      if (current === epoch.current) toast("error", text.current.errText(failure, text.current.t("recurring.actionFailed")));
    } finally {
      if (action === "runNow" && current === epoch.current) {
        try { const fresh = await recurringApi.list(pid); if (current === epoch.current) setRows(fresh); }
        catch { /* The run result is already shown; a failed refresh must not suggest retrying a committed run. */ }
      }
      latch.current = false; if (current === epoch.current) setBusy(false);
    }
  };
  return <SettingsPage title={t("settings.project.recurring")} desc={t("settings.desc.recurring")}>
    {config && !config.enabled && <p role="status" className="mb-4 text-[13px] text-sub"><Tag size="sm">env</Tag> <code>RECURRING_ENABLED</code> · {t("recurring.disabled")}</p>}
    {!editable && <p className="mb-4 text-[13px] text-sub">{t("recurring.readOnly")}</p>}
    <div className="mb-4 flex justify-end">{editable && <Button iconLeft={<IcPlus size={16} />} variant="primary"
      disabled={loading || busy || !!error || (rows.length >= LIMITS.recurring.perProject ? t("apiError.RECURRING_LIMIT") : false)} onClick={() => setForm("new")}>{t("recurring.add")}</Button>}</div>
    {loading && <p role="status">{t("recurring.loading")}</p>}
    {!!error && <div role="alert"><p>{errText(error, t("recurring.loadFailed"))}</p><Button disabled={busy} onClick={load}>{t("common.retry")}</Button></div>}
    {!loading && !error && rows.length === 0 && <SettingsCard><p className="px-5 py-5 text-[13px] text-sub">{t("recurring.empty")}</p></SettingsCard>}
    {rows.length > 0 && <SettingsCard><div className="overflow-x-auto"><table className="w-full text-left text-[13px]">
      <thead><tr>{["name", "template", "schedule", "next", "last", "actions"].map(key => <th key={key} scope="col" className="border-b border-line px-4 py-3 font-medium text-sub">
        {key === "actions" ? <span className="sr-only">{t("common.actions")}</span> : t(`recurring.${key}` as Parameters<typeof t>[0])}</th>)}</tr></thead>
      <tbody>{rows.map(rule => {
        const items: MenuEntry[] = [{ id: "history", label: t("recurring.history"), onSelect: () => setHistory(rule) }];
        if (editable) items.unshift(
          { id: "edit", label: t("recurring.edit"), disabled: busy, onSelect: () => setForm(rule) },
          { id: "run", label: t("recurring.runNow"), disabled: busy, onSelect: () => setConfirm({ action: "runNow", rule }) },
          { id: "state", label: t(rule.state === "active" ? "recurring.pause" : "recurring.resume"), disabled: busy, onSelect: () => void act(rule.state === "active" ? "pause" : "resume", rule) },
        );
        if (editable) items.push({ id: "remove", label: t("recurring.remove"), danger: true, disabled: busy, onSelect: () => setConfirm({ action: "remove", rule }) });
        return <tr key={rule.id} className="border-b border-linesoft last:border-0">
          <th scope="row" className="max-w-64 px-4 py-4 font-medium text-ink">{rule.name}
            {rule.state === "paused" && rule.pausedReason && <p className="mt-1 text-[12px] font-normal text-sub">{t(`recurring.paused.${rule.pausedReason}`)}</p>}</th>
          <td className="px-4 py-4 text-sub">{data.issueTemplates.find(template => template.id === rule.templateId)?.name ?? "—"}</td>
          <td className="px-4 py-4 text-sub">{recurrenceText(rule.schedule, t, tn, rule.timeOfDay)}</td>
          <td className="px-4 py-4"><RuleTime value={rule.nextRunAt} rule={rule} /></td>
          <td className="px-4 py-4"><RunTag result={rule.lastResult} /></td>
          <td className="px-3 py-4"><Menu items={items} label={t("common.actions")} trigger={props => <IconButton {...props} label={t("recurring.actions", { name: rule.name })}><IcDots size={16} /></IconButton>} /></td>
        </tr>;
      })}</tbody>
    </table></div></SettingsCard>}
    {form && editable && config && <Suspense fallback={<p role="status">{t("recurring.loading")}</p>}><RecurringRuleForm key={form === "new" ? "new" : form.id}
      projectId={pid} rule={form === "new" ? undefined : form} defaultTimeZone={config.defaultTimeZone} onClose={() => setForm(null)} onSaved={rule => {
        setRows(old => old.some(value => value.id === rule.id) ? old.map(value => value.id === rule.id ? rule : value) : [...old, rule]);
        setForm(null); toast("success", t("recurring.saved"));
      }} /></Suspense>}
    {history && <RecurringHistory key={history.id} projectId={pid} rule={history} onClose={() => setHistory(null)} />}
    {confirm && editable && <Dialog open title={t(confirm.action === "remove" ? "recurring.remove" : "recurring.runNow")}
      description={t(confirm.action === "remove" ? "recurring.removeHint" : "recurring.runHint", { name: confirm.rule.name })}
      onClose={() => { if (!latch.current) setConfirm(null); }} footer={<Button variant={confirm.action === "remove" ? "danger" : "primary"} loading={busy}
        onClick={() => void act(confirm.action, confirm.rule)}>{t(confirm.action === "remove" ? "recurring.remove" : "recurring.runNow")}</Button>} />}
  </SettingsPage>;
}

function RecurringHistory({ projectId, rule, onClose }: { projectId: string; rule: RecurringRuleDto; onClose: () => void }) {
  const { t, errText } = useT(); const { data, openIssue } = useStore();
  const [rows, setRows] = useState<RecurringRunDto[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(null);
  const epoch = useRef(0);
  const load = useCallback(() => { const current = ++epoch.current; setLoading(true); setError(null);
    recurringApi.runs(projectId, rule.id).then(items => { if (current === epoch.current) { setRows(items); setLoading(false); } },
      failure => { if (current === epoch.current) { setError(failure); setLoading(false); } });
  }, [projectId, rule.id]);
  useEffect(() => { load(); return () => { ++epoch.current; }; }, [load]);
  return <SidePanel open size="lg" title={t("recurring.historyFor", { name: rule.name })} description={rule.timeZone} onClose={onClose}>
    <div className="flex flex-col gap-4">
      {loading && <p role="status">{t("recurring.loading")}</p>}
      {!!error && <div role="alert"><p>{errText(error, t("recurring.loadFailed"))}</p><Button onClick={load}>{t("common.retry")}</Button></div>}
      {!loading && !error && rows.length === 0 && <p className="text-[13px] text-sub">{t("recurring.noRuns")}</p>}
      {rows.map(run => <div key={run.id} className="flex flex-col gap-2 border-b border-linesoft pb-4 text-[13px]">
        <div className="flex flex-wrap items-center gap-2"><RuleTime value={run.scheduledFor} rule={rule} /><RunTag result={run.result} />
          {run.manual && <Tag size="sm">{t("recurring.manual")}</Tag>}</div>
        {run.issueId && run.issueKey && <a className="ds-focus w-fit text-accenttext underline" href={pathForIssue(data.project.key, run.issueKey)}
          onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); onClose(); openIssue(run.issueId, "panel"); }}>{run.issueKey}</a>}
        {run.missedCount > 0 && <p className="text-sub">{t("recurring.missed", { count: run.missedCount })}</p>}
        {run.details.droppedAssignees.length > 0 && <p className="text-sub">{t("recurring.dropped", { names: run.details.droppedAssignees.map(id => data.users.find(user => user.id === id)?.name ?? id).join(", ") })}</p>}
        {run.errorCode && <p className="text-danger">{t("recurring.error", { code: run.errorCode })}</p>}
      </div>)}
    </div>
  </SidePanel>;
}
