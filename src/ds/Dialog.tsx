/** Dialog и SidePanel на нативном `<dialog>` + showModal() (ADR-0014): верхний слой, инертный фон и Esc
 *  — от браузера; начальный фокус и возврат фокуса на вызвавший элемент — здесь. */
import { useOptionalT } from "../i18n";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./Button";
import { dsId } from "./ids";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Подпись кнопки закрытия (доступное имя). */
  closeLabel?: string;
  /** Не закрывать кликом по подложке (форма с несохранённым вводом). */
  dismissable?: boolean;
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
    (el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>(".ds-dialog-body :is(input, textarea, select, button, [href])") ?? el)?.focus();
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

function Frame({ kind, open, onClose, title, description, children, footer, size = "md", closeLabel, dismissable = true }: DialogProps & { kind: "dialog" | "panel" }) {
  const t = useOptionalT()?.t;
  closeLabel ??= t ? t("common.close") : "Закрыть";
  const ref = useNativeDialog(open, onClose);
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
  if (!open) return null;
  return (
    <dialog ref={ref} className="ds-dialog" data-kind={kind} data-size={size} aria-labelledby={`${id}-t`} aria-describedby={description ? `${id}-d` : undefined} tabIndex={-1}>
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
      <div className="ds-dialog-body">{children}</div>
      {footer && <div className="ds-dialog-foot">{footer}</div>}
    </dialog>
  );
}

export const Dialog = (p: DialogProps) => <Frame kind="dialog" {...p} />;
/** Выезжающая справа панель на всю высоту — тот же <dialog>, другая геометрия. */
export const SidePanel = (p: DialogProps) => <Frame kind="panel" {...p} />;
