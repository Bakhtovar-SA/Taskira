import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { RecurrenceSchedule, RecurringRuleBody, RecurringRuleDto, RecurringRulePatchBody } from "../../../server/src/contract";
import { recurringApi, usersApi } from "../../api";
import { Button } from "../../ds/Button";
import { Dialog } from "../../ds/Dialog";
import { Checkbox, Input } from "../../ds/Field";
import { Combobox, type ComboOption } from "../../ds/Combobox";
import { DatePicker } from "../../ds/DatePicker";
import { Tabs } from "../../ds/Tabs";
import { useT, type TKey } from "../../i18n";
import { useStore } from "../../store";
import { LIMITS } from "../../validation";
import { recurringDate } from "../../recurrenceText";

const localDay = (timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const field = (kind: string) => parts.find(part => part.type === kind)!.value;
  return `${field("year")}-${field("month")}-${field("day")}`;
};
const integer = (value: string, min: number, max: number) => /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;

export default function RecurringRuleForm({ projectId, rule, defaultTimeZone, onClose, onSaved }: {
  projectId: string; rule?: RecurringRuleDto; defaultTimeZone: string; onClose: () => void; onSaved: (rule: RecurringRuleDto) => void;
}) {
  const { t, lang, errText } = useT(); const { data, setView } = useStore(); const formId = useId();
  const [name, setName] = useState(rule?.name ?? ""), [templateId, setTemplateId] = useState(rule?.templateId ?? data.issueTemplates[0]?.id ?? "");
  const initialKind = rule?.schedule?.kind;
  const [title, setTitle] = useState(rule?.title ?? ""), [kind, setKind] = useState<RecurrenceSchedule["kind"]>(initialKind === "daily" || initialKind === "monthly" ? initialKind : "weekly");
  const [every, setEvery] = useState(String(rule?.schedule?.every ?? 1));
  const [weekdays, setWeekdays] = useState(rule?.schedule?.kind === "weekly" && Array.isArray(rule.schedule.weekdays) ? rule.schedule.weekdays : [1]);
  const [monthDay, setMonthDay] = useState(String(rule?.schedule?.kind === "monthly" && rule.schedule.day !== "last" ? rule.schedule.day : 31));
  const [lastDay, setLastDay] = useState(rule?.schedule?.kind === "monthly" && rule.schedule.day === "last");
  const [time, setTime] = useState(rule?.timeOfDay ?? "09:00"), [zone, setZone] = useState(rule?.timeZone ?? defaultTimeZone);
  const [start, setStart] = useState(rule?.startDate ?? localDay(defaultTimeZone));
  const [assignees, setAssignees] = useState<string[]>(rule?.assigneeIds ?? []);
  const [due, setDue] = useState(rule?.dueInDays == null ? "" : String(rule.dueInDays)), [skip, setSkip] = useState(rule?.skipIfOpen ?? false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState<string[]>([]), [previewLoading, setPreviewLoading] = useState(false), [previewError, setPreviewError] = useState<unknown>(null);
  const live = useRef(true), seq = useRef(0), saving = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; ++seq.current; }; }, []);
  const schedule = useMemo<RecurrenceSchedule>(() => kind === "daily" ? { kind, every: Number(every) }
    : kind === "weekly" ? { kind, every: Number(every), weekdays: [...weekdays].sort((a, b) => a - b) }
    : { kind, every: Number(every), day: lastDay ? "last" : Number(monthDay) }, [kind, every, weekdays, lastDay, monthDay]);
  const timing = useMemo(() => ({ schedule, timeOfDay: time, timeZone: zone, startDate: start }), [schedule, time, zone, start]);
  useEffect(() => {
    const current = ++seq.current, controller = new AbortController();
    setPreview([]); setPreviewError(null); setPreviewLoading(true);
    const timer = window.setTimeout(() => {
      recurringApi.preview(projectId, timing, controller.signal).then(result => {
        if (current === seq.current) { setPreview(result.next); setPreviewLoading(false); }
      }, failure => { if (current === seq.current) { setPreviewError(failure); setPreviewLoading(false); } });
    }, 300);
    return () => { ++seq.current; window.clearTimeout(timer); controller.abort(); };
  }, [projectId, timing]);
  const zones = useMemo(() => [...new Set(["UTC", zone, ...Intl.supportedValuesOf("timeZone")])], [zone]);
  const zoneValue = useMemo(() => ({ id: zone, label: zone }), [zone]);
  const loadZones = useCallback(async (query: string) => zones.filter(value => value.toLowerCase().includes(query.toLowerCase())).map(value => ({ id: value, label: value })), [zones]);
  const loadPeople = useCallback(async (query: string) => {
    const people = query.trim().length < 2 ? data.users : await usersApi.pickable(query);
    return people.filter(user => data.members[user.id] && user.authSource !== "service" && !assignees.includes(user.id))
      .filter(user => !query || user.name.toLowerCase().includes(query.toLowerCase())).slice(0, 20).map(user => ({ id: user.id, label: user.name }));
  }, [data.users, data.members, assignees]);
  const body: RecurringRuleBody = { ...timing, name: name.trim(), templateId, title: title.trim() || null, assigneeIds: assignees, dueInDays: due === "" ? null : Number(due), skipIfOpen: skip };
  const patch: RecurringRulePatchBody = Object.fromEntries(Object.entries(body).filter(([key, value]) => !rule || JSON.stringify(value) !== JSON.stringify(rule[key as keyof RecurringRuleDto])));
  const template = data.issueTemplates.find(value => value.id === templateId);
  const expanded = (body.title ?? template?.title ?? body.name).replace(/\{date\}/g, "2000-01-01");
  const valid = !!body.name && !!template && integer(every, 1, kind === "daily" ? 30 : 12)
    && (kind !== "weekly" || weekdays.length > 0) && (kind !== "monthly" || lastDay || integer(monthDay, 1, 31))
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && !!zone && /^\d{4}-\d{2}-\d{2}$/.test(start)
    && (due === "" || integer(due, 0, 365)) && (rule && patch.title === undefined && patch.templateId === undefined || expanded.length <= LIMITS.title.max);
  const save = async () => {
    if (!valid || saving.current) return;
    saving.current = true;
    setBusy(true); setError(null);
    try {
      const saved = rule ? await recurringApi.update(projectId, rule.id, Object.keys(patch).length ? patch : { name: body.name }) : await recurringApi.create(projectId, body);
      if (live.current) onSaved(saved);
    } catch (failure) { if (live.current) setError(failure); }
    finally { saving.current = false; if (live.current) setBusy(false); }
  };
  return <Dialog open size="lg" title={t(rule ? "recurring.edit" : "recurring.add")} onClose={() => { if (!saving.current) onClose(); }}
    footer={<Button type="submit" form={formId} variant="primary" loading={busy} disabled={!valid ? t("recurring.formInvalid") : false}>{t("common.save")}</Button>}>
    <form id={formId} onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
        <Input label={t("recurring.name")} value={name} onChange={event => setName(event.target.value)} maxLength={LIMITS.recurring.name} data-autofocus />
        <label className="ds-field"><span className="ds-label">{t("recurring.template")}</span>
          <select className="ds-input ds-focus" value={templateId} onChange={event => setTemplateId(event.target.value)}>
            {!data.issueTemplates.length && <option value="">{t("recurring.noTemplates")}</option>}
            {data.issueTemplates.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
          </select>
        </label>
        {!data.issueTemplates.length && <Button onClick={() => { onClose(); setView("projectSettings", "templates"); }}>{t("recurring.createTemplate")}</Button>}
        <Tabs label={t("recurring.schedule")} value={kind} onChange={value => { setKind(value); setEvery("1"); }} items={[
          { id: "daily", label: t("recurring.daily") }, { id: "weekly", label: t("recurring.weekly") }, { id: "monthly", label: t("recurring.monthly") },
        ]} />
        <Input type="number" min={1} max={kind === "daily" ? 30 : 12} label={t("recurring.every")} value={every} onChange={event => setEvery(event.target.value)} />
        {kind === "weekly" && <div role="group" aria-label={t("recurring.weekdays")} className="flex flex-wrap gap-1">
          {[1, 2, 3, 4, 5, 6, 7].map(day => <Button key={day} size="sm" aria-pressed={weekdays.includes(day)} variant={weekdays.includes(day) ? "secondary" : "ghost"}
            onClick={() => setWeekdays(old => old.includes(day) ? old.filter(value => value !== day) : [...old, day])}>{t(`recurring.weekday.${day}` as TKey)}</Button>)}
        </div>}
        {kind === "monthly" && <><Checkbox label={t("recurring.lastDay")} checked={lastDay} onChange={setLastDay} />
          <Input type="number" min={1} max={31} label={t("recurring.dayOfMonth")} disabled={lastDay} value={monthDay} onChange={event => setMonthDay(event.target.value)} /></>}
        <div className="grid gap-4 sm:grid-cols-2"><Input type="time" label={t("recurring.time")} value={time} onChange={event => setTime(event.target.value)} />
          <Combobox label={t("recurring.timeZone")} value={zoneValue} load={loadZones} onSelect={option => setZone(option.id)} /></div>
        <DatePicker label={t("recurring.start")} value={start || null} onChange={value => setStart(value ?? "")} lang={lang} markOverdue={false} block />
        <div className="flex flex-col gap-2"><fieldset disabled={assignees.length >= LIMITS.recurring.assignees}>
          <Combobox label={t("recurring.assignees")} clearOnSelect load={loadPeople} hint={t("recurring.assigneeHint", { limit: LIMITS.recurring.assignees })}
            onSelect={option => { if (assignees.length < LIMITS.recurring.assignees && !assignees.includes(option.id)) setAssignees(old => [...old, option.id]); }} /></fieldset>
          <div className="flex flex-wrap gap-1">{assignees.map(id => { const name = data.users.find(user => user.id === id)?.name ?? id; return <Button key={id} size="sm"
            aria-label={t("recurring.assigneeRemove", { name })} onClick={() => setAssignees(old => old.filter(value => value !== id))}>{name} ×</Button>; })}</div>
        </div>
        <Input type="number" min={0} max={365} label={t("recurring.due")} hint={t("recurring.dueHint")} value={due} onChange={event => setDue(event.target.value)} />
        <Checkbox label={t("recurring.skipOpen")} checked={skip} onChange={setSkip} />
        <Input label={t("recurring.title")} hint={t("recurring.titleHint")} value={title} onChange={event => setTitle(event.target.value)} maxLength={LIMITS.title.max} />
        <p className="ds-hint">{t("recurring.ownerHint")}</p>
      </fieldset>
    </form>
    <div className="mt-5 flex flex-col gap-2" aria-live="polite"><h3 className="text-[13px] font-semibold">{t("recurring.preview")}</h3>
      {previewLoading && <p role="status" className="ds-hint">{t("recurring.previewLoading")}</p>}
      {!!previewError && <p role="alert" className="text-[13px] text-danger">{errText(previewError, t("recurring.previewFailed"))}</p>}
      {preview.map(value => <time key={value} dateTime={value} className="text-[13px] text-sub">{recurringDate(value, zone, lang)} · {zone}</time>)}
    </div>
    {!!error && <p role="alert" className="mt-3 text-[13px] text-danger">{errText(error, t("recurring.actionFailed"))}</p>}
  </Dialog>;
}
