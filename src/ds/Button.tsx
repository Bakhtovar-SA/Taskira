/** Button и IconButton (ТЗ 5.7). Недоступная кнопка — `aria-disabled`, а не `disabled`: она остаётся в
 *  порядке фокуса и показывает причину во всплывающей подсказке (ТЗ: «disabled с причиной»). */
import { forwardRef, lazy, Suspense, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";

/* Подсказка грузится отдельно: с ней приходит @floating-ui/dom, а кнопки стоят и на экранах из входного чанка
 * (доска). Пока модуль не пришёл, кнопка уже на месте — без подсказки, а не пустое место. */
const LazyTooltip = lazy(() => import("./Overlay").then((m) => ({ default: m.Tooltip })));
const Tooltip = ({ label, kbd, children }: { label: string; kbd?: string; children: ReactElement }) => (
  <Suspense fallback={children}>
    <LazyTooltip label={label} kbd={kbd}>
      {children}
    </LazyTooltip>
  </Suspense>
);

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

type Common = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Недоступна: строка — причина, её покажет подсказка. */
  disabled?: boolean | string;
  /** Для /dev/ui и визуальных тестов: принудительное состояние. */
  force?: "hover" | "focus" | "active";
};

export const Spinner = ({ label }: { label?: string }) => <span className="ds-spinner" role={label ? "status" : undefined} aria-label={label} />;

const Base = forwardRef<HTMLButtonElement, Common & { icon?: boolean; children?: ReactNode }>(function Base(
  { variant = "secondary", size = "md", loading, disabled, force, icon, className = "", onClick, children, type = "button", ...rest },
  ref,
) {
  const off = !!disabled || !!loading;
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      aria-disabled={off || undefined}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-size={size}
      data-icon={icon || undefined}
      data-loading={loading || undefined}
      data-force={force}
      className={`ds-btn ds-focus ${className}`}
      onClick={(e) => {
        if (off) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export const Button = forwardRef<HTMLButtonElement, Common & { iconLeft?: ReactNode; iconRight?: ReactNode; kbd?: string; children: ReactNode }>(
  function Button({ iconLeft, iconRight, kbd, children, disabled, ...rest }, ref) {
    const btn = (
      <Base ref={ref} disabled={disabled} {...rest}>
        {iconLeft && <span className="flex shrink-0">{iconLeft}</span>}
        <span className="truncate">{children}</span>
        {iconRight && <span className="flex shrink-0">{iconRight}</span>}
        {kbd && <span className="ds-btn-kbd">{kbd}</span>}
      </Base>
    );
    return typeof disabled === "string" ? <Tooltip label={disabled}>{btn}</Tooltip> : btn;
  },
);

/** Кнопка-иконка: подпись обязательна — это и доступное имя, и подсказка. */
export const IconButton = forwardRef<HTMLButtonElement, Common & { label: string; kbd?: string; children: ReactNode }>(function IconButton(
  { label, kbd, children, disabled, variant = "ghost", ...rest },
  ref,
) {
  return (
    <Tooltip label={typeof disabled === "string" ? disabled : label} kbd={typeof disabled === "string" ? undefined : kbd}>
      <Base ref={ref} icon variant={variant} disabled={disabled} aria-label={label} {...rest}>
        <span className="flex">{children}</span>
      </Base>
    </Tooltip>
  );
});
