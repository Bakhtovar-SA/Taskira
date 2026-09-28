/** Вход (ТЗ 5.12 a): первое впечатление — знак и спокойная атмосфера; ошибки говорят, что случилось и что делать.
 *  Поведение, которое пережило переписывание, закреплено в LoginForm.test.tsx. */
import { useEffect, useRef, useState } from "react";
import { IcEye } from "../icons";
import { BrandMark } from "./BrandMark";
import { useBrandName } from "../brand";
import { ApiError, authApi } from "../api";
import { useT } from "../i18n";
import { Button } from "../ds/Button";
import { Input } from "../ds/Field";

type Props = {
  onSuccess: () => void;
};

export default function LoginForm({ onSuccess }: Props) {
  const { t, lang, errText } = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [ldap, setLdap] = useState(false);
  const busyRef = useRef(false);
  const brandName = useBrandName();

  useEffect(() => {
    authApi.config().then((c) => setLdap(c.authMode === "ldap"), () => undefined);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || !username.trim() || !password) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    try {
      await authApi.login(username.trim(), password);
      onSuccess();
    } catch (err) {
      // Что случилось и что делать. 401 здесь — неверный логин или пароль, а не «сессия закончилась»,
      // поэтому по-английски — свой текст формы, а не общий перевод кода UNAUTHORIZED.
      if (err instanceof ApiError && err.status === 0) setError(t("login.offline"));
      else if (err instanceof ApiError && err.status === 429) setError(t("login.tooMany"));
      else if (err instanceof ApiError && err.status === 401 && lang !== "ru") setError(t("login.failed"));
      else setError(errText(err, t("login.failed")));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const capsCheck = (e: React.KeyboardEvent) => setCaps(e.getModifierState?.("CapsLock") ?? false);

  return (
    <div className="relative flex h-full min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* Бренд-поверхность: сетка точек, растворяющаяся к краям, и мягкое свечение атмосферы за формой. */}
      <div aria-hidden className="dotgrid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_60%_55%_at_50%_45%,black,transparent_75%)]" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[42%] h-[520px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glow-a),transparent)] blur-2xl" />

      <main className="glass relative w-full max-w-[400px] rounded-2xl border border-line p-8 shadow-[var(--highlight-top),var(--elev-4)] max-sm:p-6">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <BrandMark size={48} variant="app" />
          <div>
            <h1 className="font-disp text-[22px] font-semibold tracking-[-0.025em] text-ink">{brandName}</h1>
            <p className="mt-1 text-[13.5px] text-faint">{t("login.tagline")}</p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Input
            label={ldap ? t("login.usernameLdap") : t("login.username")}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            hint={ldap ? t("login.ldapHint") : undefined}
          />
          <Input
            label={t("login.password")}
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={capsCheck}
            onKeyUp={capsCheck}
            autoComplete="current-password"
            required
            hint={caps ? t("login.capsLock") : undefined}
            right={
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-pressed={show}
                aria-label={show ? t("login.hidePassword") : t("login.showPassword")}
                title={show ? t("login.hidePassword") : t("login.showPassword")}
                className={`ds-focus grid h-7 w-7 place-items-center rounded-md hover:bg-hover ${show ? "text-accent" : "text-faint"}`}
              >
                <IcEye size={15} />
              </button>
            }
          />

          {error && (
            <div role="alert" className="rounded-lg bg-dangersoft px-3 py-2 text-[13px] leading-relaxed text-[var(--status-danger-fg)] ring-1 ring-inset ring-danger/25">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!username.trim() || !password ? t("login.fillBoth") : false} className="mt-1 w-full justify-center">
            {busy ? t("login.submitting") : t("login.submit")}
          </Button>
        </form>
      </main>
      <p className="relative mt-6 text-center text-[12px] text-faint">{t("login.forgot")}</p>
    </div>
  );
}
