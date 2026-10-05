import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { WebhookDeliveryDetailDto, WebhookDeliveryDto, WebhookDto } from "../../../server/src/contract";
import { issuesApi, webhooksApi } from "../../api";
import { Button } from "../../ds/Button";
import { Dialog, SidePanel } from "../../ds/Dialog";
import { Tag } from "../../ds/Display";
import { Tabs } from "../../ds/Tabs";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { pathForIssue } from "../../router";
import { webhookErrorName, webhookEventName } from "./webhookUi";

type Filter = "all" | "failed" | "pending";
export default function WebhookDeliveries({ projectId,hook,enabled,onClose }: {
  projectId: string; hook: WebhookDto; enabled: boolean; onClose: () => void;
}) {
  const { t,lang,errText } = useT(); const { data,toast,openIssue,switchProject } = useStore();
  const [filter,setFilter] = useState<Filter>("all"), [rows,setRows] = useState<WebhookDeliveryDto[]>([]), [cursor,setCursor] = useState<string | null>(null);
  const [loading,setLoading] = useState(true), [error,setError] = useState<string | null>(null), [busy,setBusy] = useState(false);
  const [expanded,setExpanded] = useState<string | null>(null), [detail,setDetail] = useState<WebhookDeliveryDetailDto | null>(null);
  const [detailError,setDetailError] = useState<string | null>(null), [confirm,setConfirm] = useState(false);
  const [count,setCount] = useState<number | null>(null); const epoch = useRef(0), detailEpoch = useRef(0);
  const text = useRef({ t,errText }); text.current = { t,errText };
  const load = useCallback((next?: string) => {
    const current = ++epoch.current; setLoading(true); setError(null);
    webhooksApi.deliveries(projectId,hook.id,{ ...(filter === "all" ? {} : { state: filter }),...(next ? { cursor: next } : {}) }).then(page => {
      if (current === epoch.current) {
        setRows(old => next ? [...old,...page.items.filter(row => !old.some(existing => existing.id === row.id))] : page.items);
        setCursor(page.nextCursor); setLoading(false);
      }
    },failure => { if (current === epoch.current) { setError(text.current.errText(failure,text.current.t("integrations.loadFailed"))); setLoading(false); } });
  },[projectId,hook.id,filter]);
  useEffect(() => {
    setBusy(false); setRows([]); setCursor(null); setExpanded(null); setDetail(null); ++detailEpoch.current; load();
    return () => { ++epoch.current; ++detailEpoch.current; };
  },[load]);
  const details = (id: string) => {
    const current = ++detailEpoch.current; setDetail(null); setDetailError(null);
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    webhooksApi.delivery(projectId,hook.id,id).then(result => { if (current === detailEpoch.current) setDetail(result); },failure => {
      if (current === detailEpoch.current) setDetailError(text.current.errText(failure,text.current.t("integrations.loadFailed")));
    });
  };
  const resend = async (id?: string) => {
    const current = epoch.current; setBusy(true);
    try {
      if (id) { await webhooksApi.redeliver(projectId,hook.id,id); if (current === epoch.current) toast("success",text.current.t("integrations.redelivered")); }
      else {
        const result = await webhooksApi.redeliverFailed(projectId,hook.id);
        if (current === epoch.current) { setCount(result.count); setConfirm(false); }
      }
      if (current === epoch.current) { setBusy(false); load(); }
    } catch (failure) {
      if (current === epoch.current) { setBusy(false); toast("error",text.current.errText(failure,text.current.t("integrations.actionFailed"))); }
    }
  };
  const issue = async (key: string) => {
    const current = epoch.current;
    try { const found = await issuesApi.resolve(key); if (current === epoch.current) {
      onClose(); if (found.projectId === data.currentProjectId) openIssue(found.id,"panel"); else switchProject(found.projectId,found.id,"panel");
    } }
    catch (failure) { if (current === epoch.current) toast("error",errText(failure,t("integrations.actionFailed"))); }
  };
  return <SidePanel open title={t("integrations.journalFor",{ name: hook.name })} description={hook.urlDisplay} onClose={onClose} size="lg">
    <div className="flex flex-col gap-4">
      <Tabs label={t("integrations.deliveryFilter")} value={filter} onChange={setFilter} items={[
        { id: "all",label: t("integrations.all") },{ id: "failed",label: t("integrations.failed") },{ id: "pending",label: t("integrations.queued") },
      ]} />
      {enabled && <Button disabled={busy || hook.state !== "active"} onClick={() => { setCount(null); setConfirm(true); }}>{t("integrations.redeliver24h")}</Button>}
      {count !== null && <p role="status" className="text-[13px] text-sub">{t("integrations.redeliverCount",{ count })}</p>}
      {error && <div role="alert"><p>{error}</p><Button onClick={() => load()}>{t("integrations.retry")}</Button></div>}
      {loading && <p role="status">{t("integrations.loading")}</p>}
      {!loading && !error && rows.length === 0 && <p className="text-[13px] text-sub">{t("integrations.noDeliveries")}</p>}
      {rows.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-[12px]">
        <thead><tr>{["time","event","issue","state","attempts","response"].map(column => <th key={column} scope="col" className="border-b border-line px-2 py-2 font-medium text-sub">{t(`integrations.column.${column}` as Parameters<typeof t>[0])}</th>)}</tr></thead>
        <tbody>{rows.map(row => <Fragment key={row.id}><tr className="border-b border-linesoft">
          <td className="px-2 py-2"><Button size="sm" variant="ghost" onClick={() => details(row.id)} aria-expanded={expanded === row.id}>{new Date(row.createdAt).toLocaleString(lang)}</Button></td>
          <td className="px-2 py-2">{webhookEventName(t,row.eventType)}{row.manual && <span className="block text-faint">{t("integrations.manual")}</span>}</td>
          <td className="px-2 py-2">{row.issueKey ? <a className="ds-focus text-accenttext underline" href={pathForIssue(data.projects.find(project => project.id === projectId)?.key ?? data.project.key,row.issueKey)}
            onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); void issue(row.issueKey!); }}>{row.issueKey}</a> : "—"}</td>
          <td className="px-2 py-2"><Tag tone={row.state === "succeeded" ? "green" : row.state === "failed" ? "red" : "gray"}>{t(`webhook.deliveryState.${row.state}`)}</Tag></td>
          <td className="px-2 py-2">{row.attempts}</td><td className="px-2 py-2">{row.lastStatus ?? "—"}{row.lastError && <span className="block text-danger">{webhookErrorName(t,row.lastError)}</span>}</td>
        </tr>{expanded === row.id && <tr><td colSpan={6} className="bg-sunken px-3 py-3">
          {detailError ? <p role="alert">{detailError}</p> : !detail ? <p role="status">{t("integrations.loading")}</p> : <div className="flex flex-col gap-3">
            <h3 className="font-semibold">{t("integrations.payload")}</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[12px] font-[family-name:var(--font-code)]">{JSON.stringify(detail.payload,null,2)}</pre>
            <h3 className="font-semibold">{t("integrations.responseExcerpt")}</h3><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[12px] font-[family-name:var(--font-code)]">{detail.responseExcerpt ?? "—"}</pre>
          </div>}
          {enabled && <Button className="mt-3" size="sm" disabled={busy || hook.state !== "active"} onClick={() => void resend(row.id)}>{t("integrations.redeliver")}</Button>}
        </td></tr>}</Fragment>)}</tbody>
      </table></div>}
      {cursor && <Button loading={loading} onClick={() => load(cursor)}>{t("integrations.more")}</Button>}
      {confirm && <Dialog open title={t("integrations.redeliver24h")} description={t("integrations.redeliverHint")} onClose={() => { if (!busy) setConfirm(false); }}
        footer={<Button variant="primary" loading={busy} onClick={() => void resend()}>{t("integrations.redeliver")}</Button>} />}
    </div>
  </SidePanel>;
}
