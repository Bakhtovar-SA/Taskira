/** SEC-PWD-01: смена своего пароля — в личных настройках и обязательная смена после входа временным паролем
 *  (LoginForm). Модуль попадает в entry-чанк через LoginForm, поэтому ds берётся из файлов, а не из барреля.
 *  Проверки здесь — только для мгновенной подсказки (длина, совпадение); политику целиком проверяет сервер. */
import { useRef, useState } from "react";
import { authApi } from "../api";
import { useT } from "../i18n";
import { Button } from "../ds/Button";
import { Input } from "../ds/Field";
import { LIMITS } from "../validation";

/** Зеркало PASSWORD_MIN_LENGTH из server/src/passwordPolicy.ts (символы, не байты). */
export const PASSWORD_MIN_LENGTH = LIMITS.password.min;

type Props = {
  /** Текущий пароль уже известен (только что введён на форме входа) — поле не показывается. */
  currentPassword?: string;
  onDone: () => void;
  submitLabel?: string;
};

export function ChangePasswordForm({ currentPassword, onDone, submitLabel }: Props) {
  const { t, errText } = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const cur = currentPassword ?? current;
  const length = [...next].length;
  const tooShort = next.length > 0 && length < PASSWORD_MIN_LENGTH;
  const tooLong = length > LIMITS.password.max;
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = !!cur && length >= PASSWORD_MIN_LENGTH && !tooLong && next === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current || !ready) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword(cur, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      onDone();
    } catch (err) {
      setError(errText(err, t("password.failed")));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {currentPassword === undefined && (
        <Input label={t("password.current")} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      )}
      <Input
        label={t("password.new")}
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        required
        hint={t("password.hint", { n: PASSWORD_MIN_LENGTH })}
        error={tooShort ? t("password.tooShort", { n: PASSWORD_MIN_LENGTH }) : tooLong ? t("password.tooLong", { n: LIMITS.password.max }) : undefined}
      />
      <Input
        label={t("password.confirm")}
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
        error={mismatch ? t("password.mismatch") : undefined}
      />
      {error && (
        <div role="alert" className="rounded-lg bg-dangersoft px-3 py-2 text-[13px] leading-relaxed text-[var(--status-danger-fg)] ring-1 ring-inset ring-danger/25">
          {error}
        </div>
      )}
      <Button type="submit" variant="primary" loading={busy} disabled={ready ? false : t("password.fillAll")} className="self-start">
        {submitLabel ?? t("password.submit")}
      </Button>
    </form>
  );
}
