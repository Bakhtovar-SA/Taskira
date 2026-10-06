import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ServiceAccountDto } from "../../../server/src/contract";
import { adminTokensApi, serviceAccountsApi } from "../../api";
import { Button } from "../../ds/Button";
import { Dialog, SidePanel } from "../../ds/Dialog";
import { Input, Switch } from "../../ds/Field";
import { Tag } from "../../ds/Display";
import { Tabs } from "../../ds/Tabs";
import { IcPlus } from "../../icons";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { pathForView } from "../../router";
import { LIMITS } from "../../validation";
import { SettingsCard, SettingsPage } from "./parts";
import { TokenControls, type TokenMethods } from "./TokenControls";

const allTokens: TokenMethods = { list: () => adminTokensApi.list({ active: "1" }),revoke: id => adminTokensApi.revoke(id) };
export default function ServiceAccounts() {
  const { t,errText } = useT(); const { data } = useStore();
  const [tab,setTab] = useState<"accounts" | "tokens">("accounts"), [accounts,setAccounts] = useState<ServiceAccountDto[]>([]);
  const [loading,setLoading] = useState(true), [error,setError] = useState<string | null>(null), [form,setForm] = useState(false), [selected,setSelected] = useState<string | null>(null);
  const epoch = useRef(0), text = useRef({ t,errText }); text.current = { t,errText };
  const tabsId = useId();
  const load = useCallback(() => {
    const current = ++epoch.current; setLoading(true); setError(null);
    serviceAccountsApi.list().then(result => { if (current === epoch.current) { setAccounts(result); setLoading(false); } },failure => {
      if (current === epoch.current) { setError(text.current.errText(failure,text.current.t("serviceAccounts.loadFailed"))); setLoading(false); }
    });
  },[]);
  useEffect(() => { load(); return () => { ++epoch.current; }; },[load]);
  const account = accounts.find(row => row.id === selected);
  const replace = (value: ServiceAccountDto) => { ++epoch.current; setLoading(false); setAccounts(rows => rows.map(row => row.id === value.id ? value : row)); };
  const projectKey = (id: string) => data.projects.find(project => project.id === id)?.key ?? t("serviceAccounts.unknownProject");
  return <SettingsPage wide title={t("settings.org.service-accounts")} desc={t("serviceAccounts.hint")}>
    <Tabs mode="tabs" label={t("serviceAccounts.tabs")} value={tab} onChange={setTab} items={[
      { id: "accounts",label: t("serviceAccounts.list"),tabId: tabsId+"-accounts",panelId: tabsId+"-accounts-panel" },
      { id: "tokens",label: t("serviceAccounts.allTokens"),tabId: tabsId+"-tokens",panelId: tabsId+"-tokens-panel" },
    ]} />
    <div role="tabpanel" id={tabsId+"-"+tab+"-panel"} aria-labelledby={tabsId+"-"+tab} className="flex flex-col gap-5">
    {tab === "tokens" ? <TokenControls api={allTokens} owners /> : <>
      <Button className="self-start" variant="primary" iconLeft={<IcPlus size={16} />} onClick={() => setForm(true)}>{t("serviceAccounts.add")}</Button>
      {loading && <p role="status">{t("tokens.loading")}</p>}
      {error && <div role="alert"><p>{error}</p><Button onClick={load}>{t("tokens.retry")}</Button></div>}
      {!loading && !error && accounts.length === 0 && <p className="text-[13px] text-sub">{t("serviceAccounts.empty")}</p>}
      {accounts.length > 0 && <SettingsCard title={t("serviceAccounts.list")}><div className="overflow-x-auto p-4"><table className="w-full text-left text-[12px]">
        <thead><tr>{["name","username","state","projects","tokens"].map(column => <th key={column} scope="col" className="border-b border-line px-2 py-2 font-medium text-sub">
          {t(`serviceAccounts.column.${column}` as Parameters<typeof t>[0])}</th>)}</tr></thead>
        <tbody>{accounts.map(row => <tr key={row.id} className="border-b border-linesoft">
          <td className="px-2 py-3"><Button size="sm" variant="ghost" onClick={() => setSelected(row.id)}>{row.name}</Button></td>
          <td className="px-2 py-3 font-[family-name:var(--font-code)]">{row.username}</td>
          <td className="px-2 py-3"><Tag size="sm" tone={row.isActive ? "green" : "gray"}>{t(row.isActive ? "serviceAccounts.active" : "serviceAccounts.inactive")}</Tag></td>
          <td className="px-2 py-3">{row.projects.map(project => projectKey(project.projectId)).join(", ") || t("serviceAccounts.noProjects")}</td>
          <td className="px-2 py-3">{row.activeTokens}</td>
        </tr>)}</tbody>
      </table></div></SettingsCard>}
    </>}
    </div>
    <div role="tabpanel" id={tabsId+(tab === "accounts" ? "-tokens-panel" : "-accounts-panel")} aria-labelledby={tabsId+(tab === "accounts" ? "-tokens" : "-accounts")} hidden />
    {form && <AccountForm onClose={() => setForm(false)} onCreated={value => {
      ++epoch.current; setLoading(false); setAccounts(rows => [value,...rows]); setForm(false); setSelected(value.id);
    }} />}
    {account && <AccountPanel key={account.id} account={account} onClose={() => setSelected(null)} onChanged={replace} onTokensChanged={load} />}
  </SettingsPage>;
}
function AccountPanel({ account,onClose,onChanged,onTokensChanged }: {
  account: ServiceAccountDto; onClose: () => void; onChanged: (value: ServiceAccountDto) => void; onTokensChanged: () => void;
}) {
  const { t,errText } = useT(); const { data,toast } = useStore(); const [confirm,setConfirm] = useState(false), [busy,setBusy] = useState(false);
  const live = useRef(true), text = useRef({ t,errText }); text.current = { t,errText };
  useEffect(() => { live.current = true; return () => { live.current = false; }; },[]);
  const api = useMemo<TokenMethods>(() => ({
    list: () => serviceAccountsApi.tokens(account.id),create: body => serviceAccountsApi.createToken(account.id,body),revoke: id => serviceAccountsApi.revokeToken(account.id,id),
  }),[account.id]);
  const active = async (isActive: boolean) => {
    setBusy(true);
    try { const result = await serviceAccountsApi.update(account.id,{ isActive }); if (live.current) { onChanged(result); setConfirm(false); } }
    catch (failure) { if (live.current) toast("error",text.current.errText(failure,text.current.t("serviceAccounts.updateFailed"))); }
    finally { if (live.current) setBusy(false); }
  };
  return <SidePanel open size="lg" title={account.name} description={account.username} onClose={() => { if (!busy) onClose(); }}>
    <div className="flex flex-col gap-5">
      <Switch checked={account.isActive} disabled={busy} label={t("serviceAccounts.activeSwitch")} onChange={value => { if (value) void active(true); else setConfirm(true); }} />
      <section><h3 className="mb-2 text-[14px] font-semibold text-ink">{t("serviceAccounts.projects")}</h3>
        {account.projects.length === 0 ? <p className="text-[13px] text-sub">{t("serviceAccounts.noProjectsHint")}</p> : <ul className="flex flex-col gap-2">
          {account.projects.map(membership => {
            const project = data.projects.find(value => value.id === membership.projectId);
            return <li key={membership.projectId} className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-medium text-ink">{project?.key ?? t("serviceAccounts.unknownProject")}</span><Tag size="sm">{t(`role.${membership.role}.name`)}</Tag>
              {project && <a className="ds-focus text-accenttext underline" href={pathForView(project.key,"projectSettings","access")}>{t("serviceAccounts.manageAccess")}</a>}
            </li>;
          })}
        </ul>}
      </section>
      <TokenControls api={api} limit={LIMITS.apiToken.perService} inactive={!account.isActive} headingLevel={3} onChanged={onTokensChanged} />
    </div>
    {confirm && <Dialog open title={t("serviceAccounts.deactivateTitle")} description={t("serviceAccounts.deactivateHint")} onClose={() => { if (!busy) setConfirm(false); }}
      footer={<Button variant="danger" loading={busy} onClick={() => void active(false)}>{t("serviceAccounts.deactivate")}</Button>} />}
  </SidePanel>;
}
function AccountForm({ onClose,onCreated }: { onClose: () => void; onCreated: (value: ServiceAccountDto) => void }) {
  const { t,errText } = useT(); const [name,setName] = useState(""), [username,setUsername] = useState("");
  const [busy,setBusy] = useState(false), [error,setError] = useState<string | null>(null), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; },[]);
  const save = async () => {
    setBusy(true); setError(null);
    try { const result = await serviceAccountsApi.create({ name: name.trim(),username: username.trim() }); if (live.current) onCreated(result); }
    catch (failure) { if (live.current) setError(errText(failure,t("serviceAccounts.createFailed"))); }
    finally { if (live.current) setBusy(false); }
  };
  return <Dialog open title={t("serviceAccounts.add")} onClose={() => { if (!busy) onClose(); }}
    footer={<Button variant="primary" loading={busy} disabled={!name.trim() || username.trim().length < LIMITS.username.min} onClick={() => void save()}>{t("tokens.create")}</Button>}>
    <div className="flex flex-col gap-4">
      <Input label={t("serviceAccounts.username")} value={username} onChange={event => setUsername(event.target.value)} maxLength={LIMITS.username.max} autoComplete="off" spellCheck={false} data-autofocus />
      <Input label={t("serviceAccounts.name")} value={name} onChange={event => setName(event.target.value)} maxLength={LIMITS.serviceAccount.name} />
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </div>
  </Dialog>;
}
