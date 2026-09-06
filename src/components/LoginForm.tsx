import { useState } from "react";
import { Logo } from "../icons";
import { ApiError, authApi, setToken } from "../api";

type Props = {
  onSuccess: () => void;
};

export default function LoginForm({ onSuccess }: Props) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await authApi.login(username.trim(), password);
      setToken(res.token);
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Не удалось войти";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[400px] rounded-xl border border-line bg-panel p-8 shadow-[0_20px_60px_rgba(15,27,45,0.12)]">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo size={40} />
          <h1 className="text-[20px] font-bold text-ink">Taskira</h1>
          <p className="text-[13px] text-faint">Корпоративный трекер задач</p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-faint">Логин</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="h-10 w-full rounded-md border border-line bg-white px-3 text-[14px] outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(11,95,217,0.12)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-faint">Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="h-10 w-full rounded-md border border-line bg-white px-3 text-[14px] outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(11,95,217,0.12)]"
            />
          </label>

          {error && (
            <div className="rounded-md border border-[#f5c2c0] bg-[#fdeae8] px-3 py-2 text-[13px] text-[#a02a21]">{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 h-10 rounded-md bg-accent text-[14px] font-semibold text-white shadow-[0_2px_8px_rgba(11,95,217,0.3)] transition hover:bg-accentdeep disabled:opacity-60"
          >
            {busy ? "Вход…" : "Войти"}
          </button>
        </form>

        <p className="mt-5 text-center text-[11px] text-faint">
          API: задайте <code className="rounded bg-canvas px-1">VITE_API_URL</code> (по умолчанию localhost:8080)
        </p>
      </div>
    </div>
  );
}
