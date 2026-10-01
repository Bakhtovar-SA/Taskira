/** Dialog и SidePanel на нативном `<dialog>` + showModal() (ADR-0014): верхний слой, инертный фон и Esc
 *  — от браузера; начальный фокус и возврат фокуса на вызвавший элемент — здесь. */
import { useOptionalT } from "../i18n";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./Button";
import { dsId } from "./ids";
import { DIALOG_EXIT_MS } from "./Presence";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Подпись кнопки закрытия (доступное имя). */
  closeLabel?: string;
  /** Не закрывать кликом по подложке (форма с несохранённым вводом). */
  dismissable?: boolean;
  /** Без шапки ds: содержимое рисует свою (карточка задачи — ключ, действия, крестик). Заголовок остаётся для
   *  экранного чтения (aria-labelledby), тело — без отступов. */
  headless?: boolean;
};

function useNativeDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose; // см. CLAUDE.md про Modal: onClose приходит новым на каждый рендер
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const back = document.activeElement as HTMLElement | null;
    if (el.showModal && !el.open) el.showModal();
    else el.setAttribute("open", ""); // jsdom
    // Первый доступный элемент тела: выключенная кнопка фокус не принимает, и он оставался на body (карточка задачи:
    // первая кнопка — «предыдущая задача», выключена без соседей).
    (el.querySelector<HTMLElement>("[data-autofocus]") ??
      el.querySelector<HTMLElement>(".ds-dialog-body :is(input, textarea, select, button, [href], [tabindex]):not([disabled], [tabindex='-1'], [aria-disabled='true'])") ??
      el
    )?.focus();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    el.addEventListener("cancel", onCancel);
    return () => {
      el.removeEventListener("cancel", onCancel);
      if (el.open) el.close?.();
      back?.focus?.();
    };
  }, [open]);
  return ref;
}

function Frame({ kind, open, onClose, title, description, children, footer, size = "md", closeLabel, dismissable = true, headless }: DialogProps & { kind: "dialog" | "panel" }) {
  const t = useOptionalT()?.t;
  closeLabel ??= t ? t("common.close") : "Закрыть";
  // Закрытие с анимацией: после open=false диалог ещё виден, пока не доиграет уход (data-closing в ds.css), и только
  // потом снимается. Раньше он исчезал за один кадр. Без анимаций (jsdom, prefers-reduced-motion) — сразу, как было.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const closing = shown && !open;
  const ref = useNativeDialog(shown, onClose);
  useEffect(() => {
    if (!closing) return;
    const el = ref.current;
    const done = () => setShown(false);
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || reduce || typeof el.getAnimations !== "function") return done();
    const timer = setTimeout(done, DIALOG_EXIT_MS); // страховка, если animationend не придёт
    el.addEventListener("animationend", done, { once: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener("animationend", done);
    };
  }, [closing, ref]);
  const [id] = useState(() => dsId("dlg"));
  // Клик по подложке: у <dialog> подложка — сам элемент за пределами содержимого.
  useEffect(() => {
    const el = ref.current;
    if (!open || !el || !dismissable) return;
    const onDown = (e: MouseEvent) => {
      if (e.target !== el) return;
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
    };
    el.addEventListener("mousedown", onDown);
    return () => el.removeEventListener("mousedown", onDown);
  }, [open, dismissable, onClose, ref]);
  if (!shown) return null;
  return (
    <dialog
      ref={ref}
      className="ds-dialog"
      data-kind={kind}
      data-size={size}
      data-headless={headless || undefined}
      data-closing={closing || undefined}
      aria-labelledby={`${id}-t`}
      aria-describedby={description ? `${id}-d` : undefined}
      tabIndex={-1}
      onKeyDown={(e) => {
        // Esc закрывает окно явно, а не только нативным cancel: так же работает и в jsdom. Если Esc уже обработали внутри
        // (меню, поле с отменой правки — preventDefault), окно остаётся; preventDefault здесь гасит и нативный cancel.
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        onClose();
      }}
    >
      {headless ? (
        <h2 id={`${id}-t`} className="sr-only">
          {title}
        </h2>
      ) : (
      <div className="ds-dialog-head">
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-t`} className="ds-dialog-title">
            {title}
          </h2>
          {description && (
            <p id={`${id}-d`} className="ds-dialog-desc">
              {description}
            </p>
          )}
        </div>
        <IconButton label={closeLabel} size="sm" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </IconButton>
      </div>
      )}
      <div className="ds-dialog-body">{children}</div>
      {footer && <div className="ds-dialog-foot">{footer}</div>}
    </dialog>
  );
}

export const Dialog = (p: DialogProps) => <Frame kind="dialog" {...p} />;
/** Выезжающая справа панель на всю высоту — тот же <dialog>, другая геометрия. */
export const SidePanel = (p: DialogProps) => <Frame kind="panel" {...p} />;
