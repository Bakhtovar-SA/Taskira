/** Поля формы (ТЗ 5.7): Input, Textarea, Checkbox, Radio/RadioGroup, Switch. Подпись, подсказка и
 *  ошибка связаны с полем через aria-* — экранный диктор читает их вместе с полем. */
import { forwardRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { dsId } from "./ids";

type FieldShell = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Недоступно: строка — причина (показывается подсказкой под полем). */
  disabled?: boolean | string;
  force?: "hover" | "focus";
};

function Shell({ id, label, hint, error, disabled, children }: FieldShell & { id: string; children: ReactNode }) {
  const note = error ?? (typeof disabled === "string" ? disabled : hint);
  return (
    <div className="ds-field">
      {label && (
        <label htmlFor={id} className="ds-label">
          {label}
        </label>
      )}
      {children}
      {note && (
        <p id={`${id}-note`} className="ds-hint" data-tone={error ? "error" : undefined} role={error ? "alert" : undefined}>
          {note}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "disabled"> & FieldShell & { iconLeft?: ReactNode; right?: ReactNode }>(
  function Input({ label, hint, error, disabled, force, iconLeft, right, id: idProp, className = "", ...rest }, ref) {
    const [auto] = useState(() => dsId("in"));
    const id = idProp ?? auto;
    const noted = !!(error || hint || typeof disabled === "string");
    return (
      <Shell id={id} label={label} hint={hint} error={error} disabled={disabled}>
        <div className={`ds-input ${className}`} data-invalid={error ? "" : undefined} aria-disabled={disabled ? true : undefined} data-force={force}>
          {iconLeft && <span className="ds-adorn">{iconLeft}</span>}
          <input ref={ref} id={id} disabled={!!disabled} aria-invalid={!!error || undefined} aria-describedby={noted ? `${id}-note` : undefined} {...rest} />
          {right && <span className="ds-adorn">{right}</span>}
        </div>
      </Shell>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "disabled"> & FieldShell & { maxChars?: number }>(
  function Textarea({ label, hint, error, disabled, force, maxChars, id: idProp, className = "", value, ...rest }, ref) {
    const [auto] = useState(() => dsId("ta"));
    const id = idProp ?? auto;
    const len = typeof value === "string" ? value.length : 0;
    const noted = !!(error || hint || typeof disabled === "string");
    return (
      <Shell
        id={id}
        label={label}
        error={error}
        disabled={disabled}
        hint={
          maxChars ? (
            <span className="flex gap-2">
              <span>{hint}</span>
              <span className="ds-counter" data-over={len > maxChars || undefined}>
                {len} / {maxChars}
              </span>
            </span>
          ) : (
            hint
          )
        }
      >
        <div className={`ds-input ${className}`} data-invalid={error ? "" : undefined} aria-disabled={disabled ? true : undefined} data-force={force}>
          <textarea ref={ref} id={id} value={value} disabled={!!disabled} aria-invalid={!!error || undefined} aria-describedby={noted || maxChars ? `${id}-note` : undefined} {...rest} />
        </div>
      </Shell>
    );
  },
);

const Tick = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
    <path d="m2.5 6.25 2.25 2.25L9.5 3.75" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Dash = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

type CheckProps = {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  indeterminate?: boolean;
  disabled?: boolean | string;
  force?: "hover" | "focus";
  name?: string;
  /** Подпись только для экранного чтения (флажок «выделить строку» в таблице, на карточке доски). */
  labelHidden?: boolean;
  /** -1 — не отдельная остановка Tab (флажок на карточке, которая сама в фокусе и переключается Enter). */
  tabIndex?: number;
};

export function Checkbox({ checked, onChange, label, description, indeterminate, disabled, force, name, labelHidden, tabIndex }: CheckProps) {
  return (
    <label className="ds-check" aria-disabled={disabled ? true : undefined} data-force={force} title={typeof disabled === "string" ? disabled : undefined}>
      <input
        type="checkbox"
        name={name}
        tabIndex={tabIndex}
        checked={checked}
        disabled={!!disabled}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate;
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ds-box">{indeterminate ? <Dash /> : <Tick />}</span>
      {labelHidden ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span>
          {label}
          {description && <span className="ds-check-desc">{description}</span>}
        </span>
      )}
    </label>
  );
}

/** Группа переключателей: нативные radio с общим name — стрелки и Tab работают как у браузера. */
export function RadioGroup<T extends string>({
  value,
  onChange,
  options,
  label,
  name,
  disabled,
  force,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; description?: ReactNode; disabled?: boolean | string }[];
  label?: ReactNode;
  name?: string;
  disabled?: boolean;
  force?: "hover" | "focus";
}) {
  const [auto] = useState(() => dsId("rg"));
  return (
    <div role="radiogroup" aria-labelledby={label ? `${auto}-l` : undefined} className="flex flex-col gap-2">
      {label && (
        <p id={`${auto}-l`} className="ds-label">
          {label}
        </p>
      )}
      {options.map((o, i) => {
        const off = disabled || o.disabled;
        return (
          <label key={o.value} className="ds-check" data-kind="radio" aria-disabled={off ? true : undefined} data-force={i === 0 ? force : undefined} title={typeof o.disabled === "string" ? o.disabled : undefined}>
            <input type="radio" name={name ?? auto} value={o.value} checked={value === o.value} disabled={!!off} onChange={() => onChange(o.value)} />
            <span className="ds-box">
              <span className="ds-dot" />
            </span>
            <span>
              {o.label}
              {o.description && <span className="ds-check-desc">{o.description}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Переключатель: role="switch", подпись справа (или слева через labelFirst). */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  force,
  labelFirst,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  /** Имя переключателя без видимой подписи рядом (подпись — у строки настройки). */
  "aria-label"?: string;
  description?: ReactNode;
  disabled?: boolean | string;
  force?: "hover" | "focus";
  labelFirst?: boolean;
}) {
  const [id] = useState(() => dsId("sw"));
  const sw = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled ? true : undefined}
      aria-labelledby={label ? `${id}-l` : undefined}
      aria-label={label ? undefined : ariaLabel}
      title={typeof disabled === "string" ? disabled : undefined}
      data-force={force}
      className="ds-switch ds-focus"
      onClick={() => !disabled && onChange(!checked)}
    >
      <span>
        <Tick />
      </span>
    </button>
  );
  if (!label) return sw;
  const text = (
    <span id={`${id}-l`} className="min-w-0 flex-1">
      <span className="block text-[14px] font-medium text-ink">{label}</span>
      {description && <span className="ds-check-desc">{description}</span>}
    </span>
  );
  return (
    <div className="flex items-start gap-3" onClick={(e) => e.target === e.currentTarget && !disabled && onChange(!checked)}>
      {labelFirst ? (
        <>
          {text}
          {sw}
        </>
      ) : (
        <>
          {sw}
          {text}
        </>
      )}
    </div>
  );
}
