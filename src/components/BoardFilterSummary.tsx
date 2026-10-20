import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { Popover } from "../ds/LazyOverlay";
import type { TriggerProps } from "../ds/Overlay";
import { enter, stopMotion } from "../motion";

/** One logical appearance, including LazyOverlay replacing its fallback trigger. */
export function BoardFilterSummary({ label, summary, open, onOpenChange, children }: {
  label: string; summary: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode;
}) {
  const appeared = useRef(false);
  const show = useCallback((node: HTMLButtonElement) => {
    if (appeared.current) return;
    appeared.current = true;
    enter(node, "pop");
  }, []);
  return <Popover label={label} placement="bottom-end" open={open} onOpenChange={onOpenChange}
    trigger={props => <SummaryButton trigger={props} label={label} summary={summary} onAppear={show} />}>{children}</Popover>;
}

function SummaryButton({ trigger, label, summary, onAppear }: {
  trigger: TriggerProps; label: string; summary: string; onAppear: (node: HTMLButtonElement) => void;
}) {
  const button = useRef<HTMLButtonElement | null>(null);
  const forwarded = trigger.ref;
  const mergeRef = useCallback((node: HTMLButtonElement | null) => {
    button.current = node;
    const cleanup = typeof forwarded === "function" ? forwarded(node) : undefined;
    if (forwarded && typeof forwarded !== "function") forwarded.current = node;
    return () => {
      if (button.current === node) button.current = null;
      if (typeof cleanup === "function") cleanup();
      else if (typeof forwarded === "function") forwarded(null);
      else if (forwarded) forwarded.current = null;
    };
  }, [forwarded]);
  useLayoutEffect(() => {
    const node = button.current;
    if (!node) return;
    onAppear(node);
    return () => stopMotion(node);
  }, [onAppear]);
  return <button {...trigger} ref={mergeRef} type="button" className="ds-focus cursor-pointer rounded text-accenttext hover:underline" aria-label={`${label}: ${summary}`}>{summary}</button>;
}
