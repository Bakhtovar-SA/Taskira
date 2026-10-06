import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { z } from "zod";
import type { ApiTokenCreateBody, ApiTokenDto, ApiTokenCreatedDto, ApiTokenAdminDto } from "../../../server/src/contract";
import { Button } from "../../ds/Button";
import { Dialog } from "../../ds/Dialog";
import { Input, RadioGroup } from "../../ds/Field";
import { Tag } from "../../ds/Display";
import { IcPlus } from "../../icons";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { LIMITS } from "../../validation";
import { SecretOnceDialog } from "./SecretOnceDialog";

type TokenInput = z.infer<typeof ApiTokenCreateBody>;
type TokenRow = ApiTokenDto & Partial<Pick<ApiTokenAdminDto,"owner">>;
export type TokenMethods = {
  list: () => Promise<TokenRow[]>;
  create?: (body: TokenInput) => Promise<ApiTokenCreatedDto>;
  revoke: (id: string) => Promise<void>;
};
export function TokenControls({ api,limit = LIMITS.apiToken.perUser,inactive = false,owners = false,headingLevel = 2,onChanged }: {
  api: TokenMethods; limit?: number; inactive?: boolean; owners?: boolean; headingLevel?: 2 | 3; onChanged?: () => void;
}) {
  const { t,lang,tn,errText } = useT(); const { toast } = useStore();
  const text = useRef({ t,errText }); text.current = { t,errText };
  const [rows,setRows] = useState<TokenRow[]>([]), [loading,setLoading] = useState(true), [error,setError] = useState<string | null>(null);
  const [form,setForm] = useState(false), [remove,setRemove] = useState<TokenRow | null>(null), [secret,setSecret] = useState<string | null>(null);
  const [busy,setBusy] = useState(false), [focusFallback,setFocusFallback] = useState(false);
  const epoch = useRef(0), addRef = useRef<HTMLButtonElement>(null), titleRef = useRef<HTMLHeadingElement>(null);
  const load = useCallback(() => {
    const current = ++epoch.current; setLoading(true); setError(null);
    api.list().then(result => { if (current === epoch.current) { setRows(result.filter(row => !row.revokedAt)); setLoading(false); } },failure => {
      if (current === epoch.current) { setError(text.current.errText(failure,text.current.t("tokens.loadFailed"))); setLoading(false); }
    });
  },[api]);
  useEffect(() => { setBusy(false); load(); return () => { ++epoch.current; }; },[load]);
  useEffect(() => { if (focusFallback) { (addRef.current ?? titleRef.current)?.focus(); setFocusFallback(false); } },[focusFallback]);
  const revoke = async (row: TokenRow) => {
    const current = epoch.current, index = rows.findIndex(value => value.id === row.id);
    setBusy(true); setRemove(null); setRows(old => old.filter(value => value.id !== row.id)); setFocusFallback(true);
    try {
      await api.revoke(row.id);
      if (current === epoch.current) { toast("success",text.current.t("tokens.revoked")); onChanged?.(); }
    } catch (failure) {
      if (current === epoch.current) {
        setRows(old => { if (old.some(value => value.id === row.id)) return old; const restored = [...old]; restored.splice(Math.max(0,index),0,row); return restored; });
        toast("error",text.current.errText(failure,text.current.t("tokens.revokeFailed")));
      }
    } finally { if (current === epoch.current) setBusy(false); }
  };
  const active = rows.filter(row => new Date(row.expiresAt).getTime() > Date.now()).length;
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const date = (value: string | null) => value ? <time dateTime={value}>{new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ru-RU",{ dateStyle: "short",timeStyle: "short" }).format(new Date(value))}</time> : t("tokens.never");
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Heading ref={titleRef} tabIndex={-1} className="ds-focus text-[14px] font-semibold text-ink">{t("tokens.list")}</Heading>
      {api.create && <Button ref={addRef} variant="primary" iconLeft={<IcPlus size={16} />} onClick={() => setForm(true)}
        disabled={loading || busy || (inactive ? t("tokens.inactiveOwner") : active >= limit ? t("tokens.limitHint",{ limit }) : false)}>{t("tokens.add")}</Button>}
    </div>
    {loading && <p role="status">{t("tokens.loading")}</p>}
    {error && <div role="alert"><p>{error}</p><Button disabled={busy} onClick={load}>{t("tokens.retry")}</Button></div>}
    {!loading && !error && rows.length === 0 && <p className="text-[13px] text-sub">{t("tokens.empty")}</p>}
    {rows.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-[12px]">
      <thead><tr>{[...(owners ? ["owner"] : []),"name","prefix","scope","created","expires","lastUsed","actions"].map(column =>
        <th key={column} scope="col" className="border-b border-line px-2 py-2 font-medium text-sub">{t(`tokens.column.${column}` as Parameters<typeof t>[0])}</th>)}</tr></thead>
      <tbody>{rows.map(row => {
        const remaining = new Date(row.expiresAt).getTime()-Date.now(), days = Math.ceil(remaining/86400_000);
        return <tr key={row.id} className="border-b border-linesoft">
          {owners && <td className="px-2 py-3"><div className="flex flex-wrap items-center gap-2">{row.owner?.name}{row.owner?.authSource === "service" && <Tag size="sm">{t("tokens.serviceTag")}</Tag>}</div></td>}
          <td className="px-2 py-3 font-medium text-ink">{row.name}</td>
          <td className="px-2 py-3 font-[family-name:var(--font-code)]">tsk_{row.prefix}…</td>
          <td className="px-2 py-3"><Tag size="sm">{t(row.scope === "read" ? "tokens.read" : "tokens.write")}</Tag></td>
          <td className="px-2 py-3">{date(row.createdAt)}</td>
          <td className="px-2 py-3">{date(row.expiresAt)}{remaining <= 0 ? <span className="block text-danger">{t("tokens.expired")}</span> : remaining < 7*86400_000 &&
            <span className="block text-danger">{t("tokens.expiresSoon",{ count: days,unit: tn(days,"tokens.day.one","tokens.day.few","tokens.day.many") })}</span>}</td>
          <td className="px-2 py-3">{date(row.lastUsedAt)}</td>
          <td className="px-2 py-3"><Button size="sm" disabled={busy || loading} aria-label={t("tokens.revokeNamed",{ name: row.name })} onClick={() => setRemove(row)}>{t("tokens.revoke")}</Button></td>
        </tr>;
      })}</tbody>
    </table></div>}
    {form && api.create && <TokenForm create={api.create} onClose={() => setForm(false)} onCreated={result => {
      setRows(old => [result.token,...old]); setForm(false); setSecret(result.secret); onChanged?.();
    }} />}
    {secret && <SecretOnceDialog key={secret} secret={secret} onClose={() => setSecret(null)}
      example={`curl -H "Authorization: Bearer ${secret}" "${window.location.origin}/api/projects"`} />}
    {remove && <Dialog open title={t("tokens.revokeTitle")} description={t("tokens.revokeHint",{ name: remove.name })} onClose={() => setRemove(null)}
      footer={<Button variant="danger" onClick={() => void revoke(remove)}>{t("tokens.revoke")}</Button>} />}
  </div>;
}
function TokenForm({ create,onClose,onCreated }: {
  create: NonNullable<TokenMethods["create"]>; onClose: () => void; onCreated: (value: ApiTokenCreatedDto) => void;
}) {
  const { t,errText } = useT(); const [name,setName] = useState(""), [scope,setScope] = useState<"read" | "write">("read"), [days,setDays] = useState(90);
  const { toast } = useStore(); const text = useRef({ t,errText }); text.current = { t,errText };
  const [busy,setBusy] = useState(false), [error,setError] = useState<string | null>(null), selectId = useId();
  const live = useRef(true); useEffect(() => { live.current = true; return () => { live.current = false; }; },[]);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const result = await create({ name: name.trim(),scope,expiresInDays: days });
      if (live.current) onCreated(result); else toast("success",text.current.t("tokens.createdAway"));
    }
    catch (failure) { if (live.current) setError(text.current.errText(failure,text.current.t("tokens.createFailed"))); }
    finally { if (live.current) setBusy(false); }
  };
  return <Dialog open title={t("tokens.add")} onClose={() => { if (!busy) onClose(); }}
    footer={<Button variant="primary" disabled={!name.trim()} loading={busy} onClick={() => void save()}>{t("tokens.create")}</Button>}>
    <div className="flex flex-col gap-4">
      <Input label={t("tokens.name")} value={name} onChange={event => setName(event.target.value)} maxLength={LIMITS.apiToken.name} data-autofocus />
      <RadioGroup label={t("tokens.scope")} value={scope} onChange={setScope} options={[{ value: "read",label: t("tokens.read") },{ value: "write",label: t("tokens.write") }]} />
      <div className="flex flex-col gap-1.5"><label htmlFor={selectId} className="ds-label">{t("tokens.lifetime")}</label>
        <select id={selectId} value={days} onChange={event => setDays(Number(event.target.value))} className="ds-focus rounded-md border border-line bg-panel px-3 py-2 text-[13px] text-ink">
          {[30,90,180,365].map(value => <option key={value} value={value}>{t("tokens.days",{ count: value })}</option>)}
        </select>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </div>
  </Dialog>;
}
