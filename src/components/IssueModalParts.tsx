/** Мелкие части карточки задачи: заблокированное поле, редактируемый заголовок, кнопка подписки. */
import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "../store";
import type { Issue } from "../types";
import { IcLock, IcPencil } from "../icons";
import { Button } from "../ds/Button";
import { Tooltip } from "../ds/LazyTooltip";
import { useT } from "../i18n";
import { issuesApi } from "../api";

/** Поле, которое человек не может менять: значение текстом, причина доступна скринридеру и по наведению на замок. Не кнопка: у читателя иначе было бы
 *  по лишней остановке Tab на каждое поле (была LockedField из ui.tsx). */
export function Locked({ reason, children }: { reason: string; children: React.ReactNode }) {
  const reasonId = useId();
  return (
    <div role="group" aria-describedby={reasonId} className="issue-locked flex w-full cursor-not-allowed items-center gap-2 rounded-lg border border-linesoft bg-sunken px-2.5 py-1.5 text-[14px] text-faint">
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-left">{children}</span>
      <Tooltip label={reason}><span className="inline-flex shrink-0" aria-hidden="true"><IcLock size={14} /></span></Tooltip>
      <span id={reasonId} className="sr-only">{reason}</span>
    </div>
  );
}

/** `viewHeading` — только в режиме страницы: заголовок становится целью фокуса после смены вида
 *  (`focusViewHeading` в motion.ts). В боковой панели (`?issue=KEY`) метки нет, иначе смена вида
 *  при открытой панели увела бы фокус в её заголовок. */
export function EditableTitle({ issue, readOnly = false, viewHeading = false }: { issue: Issue; readOnly?: boolean; viewHeading?: boolean }) {
  const { t } = useT();
  const { updateIssue } = useStore();
  const [draft, setDraft] = useState(issue.title);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const baseline = useRef(issue.updatedAt);
  const pending = useRef(false);
  const currentId = useRef(issue.id);
  currentId.current = issue.id;
  useEffect(() => { if (!editing) setDraft(issue.title); }, [issue.title, issue.id, editing]);
  useEffect(() => { setEditing(false); setBusy(false); pending.current = false; }, [issue.id]);
  const start = () => { baseline.current = issue.updatedAt; setDraft(issue.title); setEditing(true); };
  const save = async () => {
    if (pending.current) return;
    if (!draft.trim() || draft.trim() === issue.title) { setEditing(false); return; }
    const id = issue.id;
    pending.current = true;
    setBusy(true);
    try {
      const saved = await updateIssue(id, { title: draft.trim() }, baseline.current);
      if (currentId.current === id && saved) setEditing(false);
    } finally { if (currentId.current === id) { pending.current = false; setBusy(false); } }
  };

  if (readOnly) return <h2 data-view-heading={viewHeading || undefined} className="px-0 py-1 issue-title font-bold leading-snug text-ink">{issue.title}</h2>;

  if (editing)
    return (
      <><textarea
        autoFocus
        aria-label={t("issue.renameAria", { title: issue.title })}
        value={draft}
        readOnly={busy}
        aria-busy={busy || undefined}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLTextAreaElement).blur();
          if (e.key === "Escape") {
            e.preventDefault(); // отменить правку, не закрывая панель (Esc у <dialog> — закрытие)
            setDraft(issue.title);
            setEditing(false);
          }
        }}
        className="w-full resize-none rounded-md border border-accent bg-panel p-2 issue-title font-bold leading-snug text-ink outline-none ring-2 ring-accent/15"
      />{baseline.current !== issue.updatedAt && <div role="status" className="text-[13px] text-sub">
        <p>{t("issue.concurrentEdit")}</p>
        <p>{t("issue.latestValue", { value: issue.title })}</p>
        <Button variant="secondary" size="sm" disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => { baseline.current = issue.updatedAt; void save(); }}>{t("issue.saveMine")}</Button>
      </div>}</>
    );
  // Заголовок редактируется по клику, но должен открываться и с клавиатуры:
  // без tabIndex/роли переименовать задачу без мыши было нельзя (аудит UX-04).
  return (
    <h2 data-view-heading={viewHeading || undefined} className="-mx-2">
      <span
        role="button"
        tabIndex={0}
        onClick={start}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            start();
          }
        }}
        title={t("issue.clickToRename")}
        aria-label={t("issue.renameAria", { title: issue.title })}
        className="group block cursor-text rounded-md px-2 py-1 issue-title font-bold leading-snug text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {issue.title}
        <IcPencil size={15} className="ml-2 inline text-faint opacity-0 transition-opacity group-focus-visible:opacity-100 group-hover:opacity-100" />
      </span>
    </h2>
  );
}

/** «Следить» (issue_watchers): подписка на уведомления о всех изменениях задачи. Состояние приходит в детальном
 *  ответе (`issue.watch`); переключение — сразу в кнопке, сервер подтверждает числом подписчиков. */
export function WatchButton({ projectId, issueId, watch }: { projectId: string; issueId: string; watch: { watching: boolean; watchers: number } | null }) {
  const { t, errText } = useT();
  const { toast } = useStore();
  const [state, setState] = useState(watch);
  const [busy, setBusy] = useState(false);
  useEffect(() => setState(watch), [watch, issueId]);
  if (!state) return null;
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const next = !state.watching;
    setState({ watching: next, watchers: state.watchers + (next ? 1 : -1) });
    try {
      setState(await issuesApi.watch(projectId, issueId, next));
    } catch (e) {
      setState(state);
      toast("error", errText(e, t("issue.watchFailed")));
    } finally {
      setBusy(false);
    }
  };
  const label = state.watching ? t("issue.unsubscribe") : t("issue.subscribe");
  return <div className="issue-watch">
    <span>{t(state.watching ? "issue.watchingText" : "issue.notWatchingText")}</span>
    <button onClick={() => void toggle()} aria-pressed={state.watching} aria-disabled={busy || undefined} className="ds-focus text-accenttext" title={t("issue.watchers", { n: state.watchers })}>{label}</button>
  </div>;
}
