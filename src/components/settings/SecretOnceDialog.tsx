/** A credential stays in component memory until the user explicitly acknowledges saving it. */
import { useState } from "react";
import { Dialog } from "../../ds/Dialog";
import { Button } from "../../ds/Button";
import { Checkbox, Input } from "../../ds/Field";
import { useT } from "../../i18n";
import { useStore } from "../../store";

export function SecretOnceDialog({ secret,onClose,previousValidUntil,example,text }: {
  secret: string; onClose: () => void; previousValidUntil?: string; example?: string;
  /** Свои подписи (временный пароль SEC-PWD-01); по умолчанию — про секрет токена/вебхука. */
  text?: { title: string; warning: string; label: string; saved: string };
}) {
  const { t,lang,errText } = useT(); const { toast } = useStore();
  const [savedSecret,setSavedSecret] = useState<string | null>(null);
  const saved = savedSecret === secret;
  const close = () => { if (saved) onClose(); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(secret); toast("success",t("secretOnce.copied")); }
    catch (error) { toast("error",errText(error,t("secretOnce.copyFailed"))); }
  };
  return <Dialog open onClose={close} title={text?.title ?? t("secretOnce.title")} description={text?.warning ?? t("secretOnce.warning")} dismissable={false}
    footer={<Button variant="primary" disabled={!saved} onClick={close}>{t("secretOnce.done")}</Button>}>
    <div className="flex flex-col gap-4" onKeyDown={event => { if (event.key === "Escape" && !saved) event.preventDefault(); }}>
      <Input label={text?.label ?? t("secretOnce.secret")} value={secret} readOnly spellCheck={false} autoComplete="off" className="font-[family-name:var(--font-code)]" />
      <Button onClick={copy}>{t("secretOnce.copy")}</Button>
      {previousValidUntil && <p className="ds-hint">{t("secretOnce.previous",{ time: new Date(previousValidUntil).toLocaleString(lang) })}</p>}
      {example && <pre tabIndex={0} role="region" aria-label={t("secretOnce.example")} className="ds-focus overflow-x-auto rounded-lg bg-sunken p-3 text-[13px] font-[family-name:var(--font-code)]">{example}</pre>}
      <Checkbox checked={saved} onChange={checked => setSavedSecret(checked ? secret : null)} label={text?.saved ?? t("secretOnce.saved")} />
    </div>
  </Dialog>;
}
