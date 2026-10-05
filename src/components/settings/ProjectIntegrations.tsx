import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { IntegrationsConfigDto, WebhookCreatedDto, WebhookDto, WebhookEventType } from "../../../server/src/contract";
import { ApiError, integrationsApi, webhooksApi } from "../../api";
import { Button, IconButton } from "../../ds/Button";
import { Dialog } from "../../ds/Dialog";
import { Checkbox, Input } from "../../ds/Field";
import { Tag } from "../../ds/Display";
import { Menu } from "../../ds/Overlay";
import { IcPlus, IcDots } from "../../icons";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { LIMITS } from "../../validation";
import { SettingsCard, SettingsPage } from "./parts";
import { SecretOnceDialog } from "./SecretOnceDialog";
import { webhookErrorName } from "./webhookUi";

const WebhookDeliveries = lazy(() => import("./WebhookDeliveries"));
export const WEBHOOK_EVENTS: WebhookEventType[] = ["issue.created","issue.updated","issue.statusChanged","issue.assigned","issue.commented","issue.due"];
export function WebhookTime({ value }: { value: string | null }) {
  const { t,lang } = useT();
  if (!value) return <>{t("integrations.never")}</>;
  const age = (Date.now()-new Date(value).getTime())/1000;
  const unit = age < 3600 ? "minute" : age < 86400 ? "hour" : "day";
  const scale = unit === "minute" ? 60 : unit === "hour" ? 3600 : 86400;
  return <time dateTime={value} title={new Date(value).toLocaleString(lang)}>{new Intl.RelativeTimeFormat(lang,{ numeric: "auto" }).format(-Math.round(age/scale),unit)}</time>;
}
function pause(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort",finish); resolve(); };
    const timer = setTimeout(finish,1000); signal.addEventListener("abort",finish,{ once: true });
    if (signal.aborted) finish();
  });
}
export default function ProjectIntegrations() {
  const { t,errText } = useT(); const { data,toast } = useStore(); const projectId = data.currentProjectId;
  const [config,setConfig] = useState<IntegrationsConfigDto | null>(null), [hooks,setHooks] = useState<WebhookDto[]>([]);
  const [error,setError] = useState<string | null>(null), [loading,setLoading] = useState(true);
  const [form,setForm] = useState<WebhookDto | "new" | null>(null), [remove,setRemove] = useState<WebhookDto | null>(null);
  const [journal,setJournal] = useState<WebhookDto | null>(null);
  const [secret,setSecret] = useState<{ secret: string; previousValidUntil?: string } | null>(null);
  const [busy,setBusy] = useState<string | null>(null), [messages,setMessages] = useState<Record<string,string>>({});
  const epoch = useRef(0), abort = useRef(new AbortController());
  const reload = useCallback(() => {
    const current = ++epoch.current; setLoading(true); setError(null);
    Promise.all([integrationsApi.config(),webhooksApi.list(projectId)]).then(([cfg,rows]) => {
      if (current === epoch.current) { setConfig(cfg); setHooks(rows); setLoading(false); }
    },failure => { if (current === epoch.current) { setError(errText(failure,t("integrations.loadFailed"))); setLoading(false); } });
  },[projectId,errText,t]);
  useEffect(() => {
    abort.current = new AbortController(); setBusy(null); setMessages({}); reload();
    return () => { ++epoch.current; abort.current.abort(); };
  },[reload]);
  const replace = (hook: WebhookDto) => setHooks(rows => rows.map(row => row.id === hook.id ? hook : row));
  const run = async <T,>(id: string,fn: () => Promise<T>,done: (result: T) => void) => {
    const current = epoch.current; setBusy(id);
    try { const result = await fn(); if (current === epoch.current) done(result); }
    catch (failure) { if (current === epoch.current) toast("error",errText(failure,t("integrations.actionFailed"))); }
    finally { if (current === epoch.current) setBusy(null); }
  };
  const ping = (hook: WebhookDto) => run(hook.id,async () => {
    const current = epoch.current, parent = abort.current.signal;
    const queued = await webhooksApi.ping(projectId,hook.id,parent);
    if (current !== epoch.current) return;
    setMessages(rows => ({ ...rows,[hook.id]: t("integrations.pingQueued") }));
    const controller = new AbortController(), signal = controller.signal;
    const cancel = () => controller.abort(); parent.addEventListener("abort",cancel,{ once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; cancel(); },15_000);
    try {
      while (!signal.aborted) {
        await pause(signal); if (signal.aborted) break;
        const delivery = await webhooksApi.delivery(projectId,hook.id,queued.deliveryId,signal);
        if (current !== epoch.current || signal.aborted) break;
        if (["succeeded","failed","cancelled"].includes(delivery.state)) {
          const message = delivery.state === "succeeded" ? t("integrations.pingOk",{ status: delivery.lastStatus ?? 200,ms: delivery.lastDurationMs ?? 0 })
            : t("integrations.pingFailed",{ error: delivery.lastError ? webhookErrorName(t,delivery.lastError) : delivery.lastStatus ?? t("integrations.unknown") });
          setMessages(rows => ({ ...rows,[hook.id]: message })); return;
        }
      }
    } catch (failure) { if (!signal.aborted) throw failure; }
    finally { clearTimeout(timer); parent.removeEventListener("abort",cancel); }
    if (timedOut && current === epoch.current) {
      setMessages(rows => ({ ...rows,[hook.id]: t("integrations.pingTimeout") }));
    }
  },() => {});
  const enabled = config?.webhooksEnabled === true;
  return <SettingsPage title={t("settings.project.integrations")} desc={t("settings.desc.integrations")}>
    {loading ? <p role="status">{t("integrations.loading")}</p> : error ? <div role="alert"><p>{error}</p><Button onClick={reload}>{t("integrations.retry")}</Button></div> : <>
      {!enabled && <SettingsCard title={t("integrations.disabled")}><div className="flex flex-col gap-3 px-5 py-4">
        <Tag>env</Tag><p className="text-[13px] text-sub">{t("integrations.disabledHint")}</p>
        <code className="break-words text-[12px] font-[family-name:var(--font-code)]">WEBHOOKS_ENABLED · WEBHOOK_ALLOWED_TARGETS · WEBHOOK_SECRET_KEY</code>
        <a href="/help" className="text-[13px] text-accenttext underline">{t("integrations.help")}</a>
      </div></SettingsCard>}
      {enabled && <Button variant="primary" className="self-start" iconLeft={<IcPlus size={16} />} onClick={() => setForm("new")} disabled={!!busy || hooks.length >= LIMITS.webhook.perProject}>
        {t("integrations.add")}</Button>}
      <SettingsCard title={t("integrations.subscriptions")}>
        {hooks.length === 0 ? <p className="px-5 py-6 text-[13px] text-sub">{t("integrations.empty")}</p> : hooks.map(hook => <div key={hook.id} className="flex items-start gap-3 px-5 py-4">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-[14px] font-semibold text-ink">{hook.name}</h3>
            <Tag tone={hook.state === "active" ? "green" : hook.state === "disabled" ? "red" : "gray"}>{t(`webhook.state.${hook.state}`)}</Tag></div>
            <code className="mt-1 block break-all text-[12px] text-sub font-[family-name:var(--font-code)]">{hook.urlDisplay}</code>
            <div className="my-2 flex flex-wrap gap-1">{hook.events.map(event => <Tag key={event} size="sm">{t(`webhook.event.${event}`)}</Tag>)}</div>
            {hook.disabledReason && <p className="text-[12px] text-danger">{t(`webhook.disabledReason.${hook.disabledReason}`)}</p>}
            <p className="text-[12px] text-faint">{t("integrations.lastSuccess")}: <WebhookTime value={hook.lastSuccessAt} /></p>
            {messages[hook.id] && <p className="mt-2 text-[12px] text-sub" role="status">{messages[hook.id]}</p>}
            {enabled && hook.state === "disabled" && <Button size="sm" disabled={!!busy} onClick={() => void run(hook.id,() => webhooksApi.update(projectId,hook.id,{ state: "active" }),replace)}>{t("integrations.enable")}</Button>}
          </div>
          <Menu label={t("integrations.actions")} trigger={(props) => <IconButton {...props} label={t("integrations.actionsFor",{ name: hook.name })} disabled={!!busy}><IcDots size={16} /></IconButton>}
            items={[
              { id: "journal",label: t("integrations.journal"),onSelect: () => setJournal(hook) },
              ...(enabled ? [
                { id: "edit",label: t("integrations.edit"),onSelect: () => setForm(hook) },
                { id: "ping",label: t("integrations.ping"),disabled: hook.state !== "active",onSelect: () => { void ping(hook); } },
                { id: "rotate",label: t("integrations.rotate"),onSelect: () => { void run(hook.id,() => webhooksApi.rotateSecret(projectId,hook.id),setSecret); } },
                { id: "state",label: t(hook.state === "active" ? "integrations.pause" : "integrations.resume"),onSelect: () => { void run(hook.id,() => webhooksApi.update(projectId,hook.id,{ state: hook.state === "active" ? "paused" : "active" }),replace); } },
                { id: "delete",label: t("integrations.remove"),danger: true,onSelect: () => setRemove(hook) },
              ] : []),
            ]} />
        </div>)}
      </SettingsCard>
    </>}
    {form && config && <WebhookForm key={form === "new" ? "new" : form.id} projectId={projectId} hook={form === "new" ? null : form} config={config}
      onClose={() => setForm(null)} onSaved={result => { if ("webhook" in result) { setHooks(rows => [...rows,result.webhook]); setSecret({ secret: result.secret }); } else replace(result); setForm(null); }} />}
    {secret && <SecretOnceDialog key={secret.secret} {...secret} onClose={() => setSecret(null)} />}
    {remove && <Dialog open title={t("integrations.removeTitle")} description={t("integrations.removeHint",{ name: remove.name })} onClose={() => { if (!busy) setRemove(null); }}
      footer={<Button variant="danger" loading={!!busy} onClick={() => void run(remove.id,() => webhooksApi.remove(projectId,remove.id),() => { setHooks(rows => rows.filter(row => row.id !== remove.id)); setRemove(null); })}>{t("integrations.remove")}</Button>} />}
    {journal && <Suspense fallback={<p role="status">{t("integrations.loading")}</p>}><WebhookDeliveries key={journal.id} projectId={projectId} hook={journal} enabled={enabled} onClose={() => setJournal(null)} /></Suspense>}
  </SettingsPage>;
}
function WebhookForm({ projectId,hook,config,onClose,onSaved }: {
  projectId: string; hook: WebhookDto | null; config: IntegrationsConfigDto; onClose: () => void;
  onSaved: (value: WebhookDto | WebhookCreatedDto) => void;
}) {
  const { t,errText } = useT(); const [name,setName] = useState(hook?.name ?? ""), [url,setUrl] = useState("");
  const [events,setEvents] = useState<WebhookEventType[]>(hook?.events ?? ["issue.created"]);
  const [busy,setBusy] = useState(false), [error,setError] = useState<string | null>(null), [urlError,setUrlError] = useState<string | null>(null);
  const live = useRef(true); useEffect(() => { live.current = true; return () => { live.current = false; }; },[]);
  const save = async () => {
    setBusy(true); setError(null); setUrlError(null);
    try {
      const result = hook ? await webhooksApi.update(projectId,hook.id,{ name: name.trim(),events,...(url.trim() ? { url: url.trim() } : {}) })
        : await webhooksApi.create(projectId,{ name: name.trim(),url: url.trim(),events });
      if (live.current) onSaved(result);
    } catch (failure) {
      if (live.current) { const message = errText(failure,t("integrations.saveFailed"));
        if (failure instanceof ApiError && failure.code === "WEBHOOK_TARGET_NOT_ALLOWED") setUrlError(message); else setError(message); }
    } finally { if (live.current) setBusy(false); }
  };
  return <Dialog open title={t(hook ? "integrations.edit" : "integrations.add")} onClose={() => { if (!busy) onClose(); }}
    footer={<Button variant="primary" loading={busy} disabled={!name.trim() || (!hook && !url.trim()) || events.length === 0} onClick={() => void save()}>{t("integrations.save")}</Button>}>
    <div className="flex flex-col gap-4"><Input label={t("integrations.name")} value={name} onChange={event => setName(event.target.value)} maxLength={LIMITS.webhook.name} data-autofocus />
      <Input label={t("integrations.url")} value={url} onChange={event => { setUrl(event.target.value); setUrlError(null); }} placeholder={hook?.urlDisplay ?? "https://"}
        maxLength={LIMITS.webhook.url} error={urlError} hint={t(hook ? "integrations.urlUnchanged" : "integrations.urlHint")} autoComplete="off" spellCheck={false} />
      <p className="ds-hint">{t("integrations.allowed")}: {config.allowedTargets.join(", ") || t("integrations.none")}</p>
      <fieldset className="flex flex-col gap-2"><legend className="ds-label mb-2">{t("integrations.events")}</legend>
        {WEBHOOK_EVENTS.map(event => <Checkbox key={event} checked={events.includes(event)} label={t(`webhook.event.${event}`)} description={t(`webhook.eventDesc.${event}`)}
          onChange={checked => setEvents(rows => checked ? rows.includes(event) ? rows : [...rows,event] : rows.filter(row => row !== event))} />)}
      </fieldset>{error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </div>
  </Dialog>;
}
