import { useState } from "react";
import { Logo } from "../icons";
import { ApiError, authApi } from "../api";
import { useT } from "../i18n";

type Props = {
  onSuccess: () => void;
};

export default function LoginForm({ onSuccess }: Props) {
  const { t, lang } = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await authApi.login(username.trim(), password);
      onSuccess();
    } catch (err) {
      // Причина от сервера пока русская: показываем её только в русской
      // локали, а в английской не допускаем смешивания языков.
      const msg = err instanceof ApiError && lang === "ru" ? err.message : t("login.failed");
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const field =
    "h-10 w-full rounded-lg border border-line bg-panel px-3 text-[14px] text-ink shadow-e1 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-line2 focus:border-accent focus:shadow-focus";

  return (
    <div className="relative flex h-full min-h-screen items-center justify-center overflow-hidden px-4">
      {/* Экран входа — бренд-поверхность: сетка точек, растворяющаяся к краям,
          и мягкое свечение за формой (атмосфера, ТЗ 5.12 a). */}
      <div aria-hidden className="dotgrid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_60%_55%_at_50%_45%,black,transparent_75%)]" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[42%] h-[520px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glow-a),transparent)] blur-2xl" />

      <div className="glass anim-dialog relative w-full max-w-[380px] rounded-2xl border border-line p-8 shadow-[var(--highlight-top),var(--elev-4)]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Logo size={44} />
          <div>
            <h1 className="font-disp text-[22px] font-semibold tracking-[-0.025em] text-ink">{t("login.appName")}</h1>
            <p className="mt-1 text-[13.5px] text-faint">{t("login.tagline")}</p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium text-sub">{t("login.username")}</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className={field}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-medium text-sub">{t("login.password")}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className={field}
            />
          </label>

          {error && (
            <div role="alert" className="rounded-lg bg-dangersoft px-3 py-2 text-[13px] text-[var(--status-danger-fg)] ring-1 ring-inset ring-danger/25">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-primary mt-1 h-10 rounded-lg text-[14px] font-medium disabled:opacity-60"
          >
            {busy ? t("login.submitting") : t("login.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
