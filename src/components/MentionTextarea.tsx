import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { commentsApi, type MentionCandidate } from "../api";
import { useT } from "../i18n";
import { Avatar } from "../ds/Display";
import { Textarea } from "../ds/Field";
import { hidePop, showPop, useAnchored } from "../ds/floating";
import { insertMention, mentionAt } from "../mentions";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  projectId: string; issueId: string; value: string; onValueChange: (value: string) => void;
  field?: boolean; maxChars?: number;
};

/** A plain-text composer: selecting a name inserts the exact @login understood by the server. */
const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea({
  projectId, issueId, value, onValueChange, field, maxChars, onKeyDown, onSelect, onFocus, onBlur,
  disabled, readOnly, ...rest
}, forwardedRef) {
  const { t } = useT();
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState("");
  const [active, setActive] = useState(0);
  const [retry, setRetry] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [state, setState] = useState<{ key: string; items: MentionCandidate[]; error: boolean }>({ key: "", items: [], error: false });
  const nextCaret = useRef<number | null>(null);
  const range = caret !== null && !disabled && !readOnly ? mentionAt(value, caret, input.current?.selectionEnd ?? caret) : null;
  const tokenKey = range ? `${projectId}:${issueId}:${range.start}:${range.end}:${range.query}` : "";
  const open = !!range && tokenKey !== dismissed;
  const queryKey = open ? `${projectId}:${issueId}:${range!.query}` : "";
  const loading = open && state.key !== queryKey;
  const items = open && state.key === queryKey ? state.items : [];
  const failed = open && state.key === queryKey && state.error;
  useAnchored(input, pop, open, { placement: "top-start", matchWidth: true });
  useLayoutEffect(() => { if (open) showPop(pop.current); else hidePop(pop.current); }, [open]);
  useLayoutEffect(() => {
    if (nextCaret.current === null || !input.current) return;
    input.current.focus();
    input.current.setSelectionRange(nextCaret.current, nextCaret.current);
    setCaret(nextCaret.current);
    nextCaret.current = null;
  }, [value]);
  useEffect(() => {
    if (!open || !range) return;
    const abort = new AbortController();
    setActive(0);
    setState({ key: "", items: [], error: false });
    const timer = setTimeout(() => {
      commentsApi.mentionCandidates(projectId, issueId, range.query, abort.signal).then(
        result => { if (!abort.signal.aborted) setState({ key: queryKey, items: result, error: false }); },
        () => { if (!abort.signal.aborted) setState({ key: queryKey, items: [], error: true }); },
      );
    }, range.query ? 150 : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [queryKey, retry]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!input.current?.contains(event.target as Node) && !pop.current?.contains(event.target as Node)) setDismissed(tokenKey);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open, tokenKey]);
  useEffect(() => { pop.current?.querySelector(`[data-mention-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" }); }, [active]);

  const pick = (person: MentionCandidate) => {
    if (!range || !items.some(item => item.id === person.id)) return;
    const next = insertMention(value, range, person.username, rest.maxLength);
    if (!next) { setAnnouncement(t("mention.tooLong")); return; }
    nextCaret.current = next.caret;
    setDismissed("");
    setCaret(null);
    setAnnouncement("");
    onValueChange(next.text);
  };
  const rememberCaret = (element: HTMLTextAreaElement) => {
    setCaret(element.selectionStart === element.selectionEnd ? element.selectionStart : null);
  };
  const textareaProps: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref: (el: HTMLTextAreaElement | null) => void } = {
    ...rest, value, disabled, readOnly,
    ref: el => {
      input.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    "aria-autocomplete": "list", "aria-haspopup": "listbox",
    "aria-controls": open ? `${id}-list` : undefined,
    "aria-activedescendant": items[active] ? `${id}-${items[active].id}` : undefined,
    onChange: event => { setDismissed(""); setAnnouncement(""); rememberCaret(event.currentTarget); onValueChange(event.target.value); },
    onSelect: event => { rememberCaret(event.currentTarget); onSelect?.(event); },
    onFocus: event => { rememberCaret(event.currentTarget); onFocus?.(event); },
    onBlur: event => { setCaret(null); onBlur?.(event); },
    onKeyDown: event => {
      if (event.nativeEvent.isComposing) return;
      if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(tokenKey); return; }
      if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        setActive(index => Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
        return;
      }
      if (open && items[active] && (event.key === "Tab" || event.key === "Enter" && !event.ctrlKey && !event.metaKey)) {
        event.preventDefault(); pick(items[active]); return;
      }
      onKeyDown?.(event);
    },
  };

  return <>
    {field ? <Textarea {...textareaProps} maxChars={maxChars} /> : <textarea {...textareaProps} />}
    {announcement && <p className="ds-hint" role="status">{announcement}</p>}
    {open && <div ref={pop} popover="manual" className="ds-pop mention-pop">
      <p className="px-2 py-1 text-[12.5px] font-medium text-faint">{t("mention.choose")}</p>
      {loading && <p className="px-2 py-2 text-[13px] text-faint" role="status">{t("picker.searching")}</p>}
      {failed && <div className="px-2 py-2 text-[13px] text-sub"><p role="status">{t("mention.error")}</p><button type="button" className="mt-1 text-accent" onMouseDown={event => event.preventDefault()} onClick={() => setRetry(n => n + 1)}>{t("common.retry")}</button></div>}
      {!loading && !failed && items.length === 0 && <p className="px-2 py-2 text-[13px] text-faint" role="status">{t("mention.empty")}</p>}
      <div id={`${id}-list`} role="listbox" aria-label={t("mention.choose")} aria-busy={loading}>
        {items.map((person, index) => <button key={person.id} id={`${id}-${person.id}`} type="button" role="option"
            aria-selected={index === active} data-mention-index={index} tabIndex={-1}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${index === active ? "bg-accentsoft" : "hover:bg-hover"}`}
            onMouseDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => pick(person)}>
            <Avatar person={{ id: person.id, name: person.name }} size={24} showTitle={false} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{person.name}</span>
              <span className="block truncate text-[12px] text-faint">@{person.username}</span></span>
          </button>)}
      </div>
    </div>}
  </>;
});

export default MentionTextarea;
