import { AutomationFields, AutomationPopover, type AutomationKind } from "./IssueAutomationControls";
import { usePendingMarks } from "../usePendingMarks";
import { useIssueAutomation } from "../issueAutomation";
import { useEffect, useId, useRef, useState } from "react";
import { cssVars } from "../cssVars";
import { localToday } from "../calendarLayout";
import { useStore } from "../store";
import { canTransition, fmtDate, relTime } from "../store/mappers";
import { pathForIssue } from "../router";
import { denialText } from "../permissions";
import { LIMITS } from "../validation";
import type { ComplexityId, PriorityId } from "../types";
import { COMPLEXITY_ORDER, PRIORITY_ORDER } from "../types";
import { IcCalendar, IcCheck, IcChevD, IcExpand, IcLink, IcLock, IcPencil, IcSend, IcSubtasks, IcTrash, IcX, PriorityIcon, StatusGlyph, TypeIcon } from "../icons";
import { directionColor } from "../ui";
import { Button } from "../ds/Button";
import { DatePicker } from "../ds/DatePicker";
import { Dialog, SidePanel } from "../ds/Dialog";
import { Menu, Popover } from "../ds/LazyOverlay";
import { Tag } from "../ds/Display";
import { Tabs } from "../ds/Tabs";
import { DeleteIssueDialog } from "./DeleteIssueDialog";
import { UserAvatar, UserAvatarGroup } from "./UserAvatar";
import { useT } from "../i18n";
import MentionTextarea from "./MentionTextarea";
import AssigneePicker from "./AssigneePicker";
import IssueSearchBox from "./IssueSearchBox";
import { useIssue } from "../issuePages";
import { workflowStatusName } from "../workflowStatus";
import { activityLine } from "../activityText";
import { neighborIssue, revealIssue } from "../issueNav";
import type { IssueMode } from "../store/mappers";
import { VIEW_LABEL } from "./Topbar";
import { EnterScope } from "../EnterScope";
import { Flash } from "../Flash";
import { MentionText } from "./MentionText";
import { DIRECTION_COLORS, Field, selectCls, CollaboratorField, AttachmentField, SubtasksField, ChecklistField, CustomFieldsSection, IssueActions, LinksField } from "./IssueModalFields";
import { Locked, EditableTitle, WatchButton } from "./IssueModalParts";

/** `open` — от Presence в App.tsx (режим панели): после закрытия панель ещё доигрывает уход. */
export default function IssueModal({ mode = "panel", open = true }: { mode?: IssueMode; open?: boolean }) {
  const { t, tn, lang } = useT();
  const feedId = useId();
  const { data, ui, openIssue, updateIssue, moveStatus, addComment, deleteIssue, toast, can, uploadAttachment, setIssueRepeat } = useStore();
  const live = data.issues.find((i) => i.id === ui.selectedIssueId);
  // Закрытие снимает selectedIssueId сразу, а панель ещё ~200 мс уходит с анимацией: на это время держим последнюю
  // показанную задачу, иначе содержимое исчезло бы за один кадр.
  const [held, setHeld] = useState(live);
  if (live && live !== held) setHeld(live);
  const issue = live ?? (open ? undefined : held);
  const automation=useIssueAutomation(data.currentProjectId,issue?.id,(id,r)=>setIssueRepeat(id,r&&{schedule:r.schedule,timeOfDay:r.timeOfDay,paused:r.state==='paused'}));
  const [automationKind,setAutomationKind]=useState<AutomationKind|null>(null);
  const [automationAnchor,setAutomationAnchor]=useState<HTMLElement|null>(null);
  const openAutomation=(kind:AutomationKind,anchor:HTMLElement)=>{if(automation.error)automation.load();setAutomationKind(kind);setAutomationAnchor(anchor)};
  useEffect(()=>{setAutomationKind(null);setAutomationAnchor(null)},[issue?.id]);
  const [feed, setFeed] = useState<"all" | "comments" | "history">("comments");
  const [comment, setComment] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const descVersion = useRef<number | undefined>(undefined);
  const [labelInput, setLabelInput] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [commentBusy, setCommentBusy] = useState(false);
  const [descBusy, setDescBusy] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const activeIssueRef = useRef(ui.selectedIssueId);
  activeIssueRef.current = ui.selectedIssueId;
  const commentPending = useRef(false);
  const descPending = useRef(false);
  const mark = usePendingMarks(`${data.currentProjectId}:${ui.selectedIssueId ?? ""}`);
  const [pendingComment, setPendingComment] = useState<string | null>(null);
  const pendingCommentRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const commentSendRef = useRef<HTMLButtonElement>(null);
  const assigneeRef = useRef<HTMLSpanElement>(null);
  const assigneePending = useRef(false);
  const [assigneeBusy, setAssigneeBusy] = useState(false);
  const labelsRef = useRef<HTMLDivElement>(null);
  const labelsPending = useRef(false);
  const [labelsBusy, setLabelsBusy] = useState(false);
  const pendingEpoch = useRef(0);

  useEffect(() => {
    pendingEpoch.current++;
    setFeed("comments");
    setEditingDesc(false);
    setComment("");
    setConfirmDel(false);
    setLabelInput("");
    setCommentBusy(false);
    setPendingComment(null);
    setAssigneeBusy(false);
    setLabelsBusy(false);
    assigneePending.current = false;
    labelsPending.current = false;
    setDescBusy(false);
    setDetailsExpanded(false);
    commentPending.current = false;
    descPending.current = false;
  }, [ui.selectedIssueId]);

  // J / K — соседняя задача текущего представления, панель не закрывается (ADR-0013 §3).
  const selectedId = ui.selectedIssueId;
  const go = (dir: 1 | -1) => {
    const next = selectedId ? neighborIssue(selectedId, dir) : null;
    if (!next) return false;
    openIssue(next);
    revealIssue(next);
    return true;
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (mode !== "panel" || !open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const dir = k === "j" || k === "о" ? 1 : k === "k" || k === "л" ? -1 : 0;
      if (dir && goRef.current(dir)) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, open]);

  // Эпик и родитель открытой задачи — точечные запросы по id (или кэш), а не поиск в списке всех задач.
  const epic = useIssue(issue?.epicId);
  const parentIssue = useIssue(issue?.parentId);
  if (!issue) {
    if (!selectedId) return null;
    const loading = (
      <div className="space-y-4 p-5" aria-busy="true">
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="text-[14px] text-sub">{t("solo.loadingIssue")}</p>
          <button onClick={() => openIssue(null)} aria-label={t("common.close")} className="rounded-md p-2 text-faint hover:bg-hover">
            <IcX size={16} />
          </button>
        </div>
        <div className="skeleton h-6 w-3/4 rounded-md" />
        <div className="skeleton h-24 rounded-lg" />
      </div>
    );
    return mode === "page" ? loading : (
      <SidePanel open={open} focusReady={false} onClose={() => openIssue(null)} size="xl" headless title={t("solo.loadingIssue")}>{loading}</SidePanel>
    );
  }

  // Без non-null-утверждений: раньше `!` глушил TypeScript, но при отсутствии
  // профиля или статуса рендер падал исключением и гасил всё приложение
  // (аудит BUG-03). Теперь — честный ранний выход с понятным текстом.
  const me = data.users.find((u) => u.id === data.currentUserId);
  const assignees = issue.assigneeIds.map((id) => data.users.find((u) => u.id === id)).filter((u): u is NonNullable<typeof u> => !!u);
  const reporter = data.users.find((u) => u.id === issue.reporterId);
  const status = data.workflow.statuses.find((s) => s.id === issue.statusId);
  if (!me || !status) {
    return (
      <Dialog
        open={open}
        onClose={() => openIssue(null)}
        size="sm"
        title={t("issue.unavailable")}
        description={
          <>
            <span className="block font-semibold text-ink">{t("issue.openFailed")}</span>
            {t("issue.openFailedHint")}
          </>
        }
        footer={
          <Button variant="primary" onClick={() => openIssue(null)}>
            {t("common.close")}
          </Button>
        }
      />
    );
  }
  // Срок горит: дата в прошлом и задача не в финальной категории статуса.
  const overdueDays = issue.dueDate ? Math.max(0, Math.round((Date.parse(localToday()) - Date.parse(issue.dueDate)) / 864e5)) : 0;
  const overdue = status.category !== "done" && overdueDays > 0;
  // Тип "epic" упразднён (миграция 002): «направление» — задача, на которую ссылаются другие
  // через epicId. Признак приходит в детальном ответе (epicChildrenCount), а не выводится
  // обходом всех задач проекта; направление не может выбрать себе направление.
  const isDirection = (issue.epicChildrenCount ?? 0) > 0;

  /* права доступа: что можно делать с этой задачей */
  const editOk = can("edit", issue);
  const canDelete = can("delete");
  const canComment = can("comment", issue);
  const transitionOk = can("transition", issue);
  const denyMsg = denialText(me, "edit", issue, t);

  const submitComment = async () => {
    if (!comment.trim() || commentPending.current) return;
    const issueId = issue.id, epoch = pendingEpoch.current;
    const draft = comment;
    commentPending.current = true;
    setCommentBusy(true);
    setPendingComment(draft);
    let saved = false;
    try { saved = await mark([commentInputRef.current, commentSendRef.current, () => pendingCommentRef.current], () => addComment(issueId, draft)); }
    finally {
      if (activeIssueRef.current === issueId && pendingEpoch.current === epoch) {
        commentPending.current = false;
        setCommentBusy(false);
        setPendingComment(null);
        if (saved) setComment(current => current === draft ? "" : current);
      }
    }
  };

  // Blur saves, Escape cancels. Keep the editor and draft on failure.
  const saveDesc = async () => {
    if (descPending.current) return;
    const next = descDraft.trim();
    if (next === issue.description) { setEditingDesc(false); return; }
    const issueId = issue.id;
    descPending.current = true;
    setDescBusy(true);
    const saved = await updateIssue(issueId, { description: next }, descVersion.current);
    if (activeIssueRef.current !== issueId) return;
    descPending.current = false;
    setDescBusy(false);
    if (saved) {
      setEditingDesc(false);
      toast("success", t("issue.descriptionSaved"));
    }
  };

  const changeAssignees = async (ids: string[]) => {
    if (assigneePending.current) return;
    const issueId = issue.id, epoch = pendingEpoch.current;
    assigneePending.current = true;
    setAssigneeBusy(true);
    try { await mark([assigneeRef.current], () => updateIssue(issueId, { assigneeIds: ids })); }
    finally { if (activeIssueRef.current === issueId && pendingEpoch.current === epoch) { assigneePending.current = false; setAssigneeBusy(false); } }
  };
  const startDesc = () => {
    descVersion.current = issue.updatedAt;
    setDescDraft(issue.description);
    setEditingDesc(true);
  };
  const changeLabels = async (labels: string[], target: HTMLElement | null): Promise<boolean> => {
    if (labelsPending.current) return false;
    const issueId = issue.id, epoch = pendingEpoch.current;
    labelsPending.current = true;
    setLabelsBusy(true);
    try { return await mark([target], () => updateIssue(issueId, { labels })); }
    finally { if (activeIssueRef.current === issueId && pendingEpoch.current === epoch) { labelsPending.current = false; setLabelsBusy(false); } }
  };
  const addLabel = async (target: HTMLInputElement) => {
    const value = labelInput, epoch = pendingEpoch.current;
    const l = value.trim().toLowerCase();
    if (!l || labelsPending.current) return;
    if (issue.labels.includes(l)) { setLabelInput(""); return; }
    if (await changeLabels([...issue.labels, l], target) && activeIssueRef.current === issue.id && pendingEpoch.current === epoch) setLabelInput(current => current === value ? "" : current);
  };

  const copyLink = async () => {
    // Человекочитаемая форма (ТЗ 3.1) — резолвится сервером по ключу
    // (GET /api/issues/resolve), в том числе для приглашённых (одиночный режим).
    const url = `${location.origin}${pathForIssue(data.project.key, issue.key)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("success", t("issue.linkCopied", { key: issue.key }));
    } catch {
      toast("info", url);
    }
  };

  const page = mode === "page";
  const hasPrev = !page && !!neighborIssue(issue.id, -1);
  const hasNext = !page && !!neighborIssue(issue.id, 1);
  const iconBtn = "flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35";

  const statusControl = transitionOk ? <Menu label={t("issue.status")}
    trigger={p => <Button {...p} variant="secondary" size="sm" className="issue-status-button" iconLeft={<StatusGlyph category={status.category} size={16} />} iconRight={<IcChevD size={14} />}>{workflowStatusName(status, t)}</Button>}
    items={data.workflow.statuses.map(target => ({ id: target.id, label: workflowStatusName(target, t), icon: <StatusGlyph category={target.category} size={16} />,
      disabled: !canTransition(data.workflow, issue.statusId, target.id), hint: target.id === issue.statusId ? <IcCheck size={14} /> : undefined,
      onSelect: () => moveStatus(issue.id, target.id, null) }))} /> : <Locked reason={denialText(me, "transition", issue, t)}><StatusGlyph category={status.category} size={16} />{workflowStatusName(status, t)}</Locked>;
  const overdueText = t("issue.overdueDays", { n: overdueDays, days: tn(overdueDays, "noun.day.one", "noun.day.few", "noun.day.many") });

  const content = (
    <div className="issue-detail" onDragOver={e => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }} onDrop={e => {
      if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault();
      if (canComment) for (const file of Array.from(e.dataTransfer.files)) uploadAttachment(issue.id, file);
    }}>
      {/* шапка */}
      <div data-issue-details={issue.id} className={page ? "issue-toolbar issue-toolbar-page" : "issue-toolbar"}>
        {page && <Button size="sm" variant="ghost" onClick={() => openIssue(null)}>{t(VIEW_LABEL[ui.view])}</Button>}
        <TypeIcon type={issue.typeId} size={18} />
        <div className="issue-breadcrumb"><span>{data.project.name}</span><span aria-hidden="true">/</span><b className="tabular">{issue.key}</b></div>
        <div className="issue-toolbar-actions">
          {!editOk && <span className="issue-readonly" title={denyMsg}>{t("issue.readOnly")}</span>}
          {!page && <div className="issue-nav-buttons">
            <Button variant="secondary" size="sm" className="issue-nav-button" disabled={!hasPrev} aria-label={t("issue.prev")} onClick={() => go(-1)} kbd="K">{t("issue.prevShort")}</Button>
            <Button variant="secondary" size="sm" className="issue-nav-button" disabled={!hasNext} aria-label={t("issue.next")} onClick={() => go(1)} kbd="J">{t("issue.nextShort")}</Button>
            <span className="issue-toolbar-divider" />
            <button onClick={() => openIssue(issue.id, "page")} className={iconBtn} aria-label={t("issue.openFull")}><IcExpand size={17} /></button>
          </div>}
          <button onClick={copyLink} className={iconBtn + " issue-copy-button"} aria-label={t("issue.copyLink")}><IcLink size={17} /></button>
          <IssueActions key={issue.id} issue={issue} className={iconBtn + " ds-focus"} onAutomation={openAutomation}
            items={[
              ...(!page ? [
                { id: "prev", label: t("issue.prev"), disabled: !hasPrev, onSelect: () => go(-1) },
                { id: "next", label: t("issue.next"), disabled: !hasNext, onSelect: () => go(1) },
                { id: "full", label: t("issue.openFull"), icon: <IcExpand size={16} />, onSelect: () => openIssue(issue.id, "page") },
              ] : []),
              { id: "copy", label: t("issue.copyLink"), icon: <IcLink size={16} />, onSelect: copyLink },
              ...(canDelete ? [{ id: "delete", label: t("common.delete"), icon: <IcTrash size={16} />, danger: true, onSelect: () => setConfirmDel(true) }] : []),
            ]} />
          <button onClick={() => openIssue(null)} className={iconBtn} aria-label={t("common.close")}><IcX size={17} /></button>
        </div>
      </div>
      <AutomationPopover kind={automationKind} anchor={automationAnchor} onClose={()=>setAutomationKind(null)} value={automation.value??{recurrence:null,remindAt:null}} projectId={data.currentProjectId} issueId={issue.id} dueDate={issue.dueDate}
        error={automation.error} readOnly={automation.loading} onSave={automation.save}/>

      {/* Ниже ~720px карточка складывается в одну колонку: именно её открывают
          по ссылке из письма, в том числе с телефона (аудит UX-03). */}
      <div className="issue-layout">
        <section className="issue-heading min-w-0">
          {issue.parentId && <button type="button" className="issue-parent-link ds-focus" onClick={() => openIssue(issue.parentId)} aria-label={parentIssue ? t("issue.subtaskOf", { key: parentIssue.key }) + ": " + parentIssue.title : t("issue.parent")}><IcSubtasks size={16} /><span>{t("issue.subtask")}</span>{parentIssue ? <><b>{parentIssue.key}</b><span className="issue-parent-title">{parentIssue.title}</span></> : <span>{t("solo.loadingIssue")}</span>}</button>}
          <EditableTitle issue={issue} readOnly={!editOk} viewHeading={page} />
          <div className="issue-action-row">
            <Flash key={issue.id} value={issue.statusId} className="inline-flex">{statusControl}</Flash>
            <AutomationFields compact value={automation.value??{recurrence:null,remindAt:null}} canRepeat={can("manageRecurring")} onOpen={openAutomation}/>
            <span className="issue-creator">{t("issue.createdBy", { name: reporter?.name ?? t("issue.system"), date: fmtDate(new Date(issue.createdAt).toISOString().slice(0, 10), lang) })}{reporter?.authSource === "service" && <span className="ml-1 inline-flex"><Tag size="sm">{t("tokens.serviceTag")}</Tag></span>}</span>
          </div>
        </section>
        {/* правая панель */}
        <aside className="issue-properties">
          {!editOk && (
            <div className="flex items-start gap-2 rounded-md border border-line bg-warnsoft/50 px-2.5 py-2 text-[13px] leading-snug text-warn">
              <IcLock size={15} className="mt-0.5 shrink-0" />
              <span>{denyMsg}</span>
            </div>
          )}

          <Field label={t("issue.assignees")}>
            {editOk ? (
            <Popover
              label={t("issue.assignees")}
              className="max-h-[320px] w-[240px] overflow-y-auto"
              trigger={(p, open) => (
                <button {...p} type="button" className={selectCls}>
                  <span ref={assigneeRef} className="inline-flex shrink-0"><UserAvatarGroup users={assignees} size={22} max={3} /></span>
                  <span className={assignees.length ? "min-w-0 truncate" : "text-faint"}>
                    {assignees.length === 0
                      ? t("createIssue.unassigned")
                      : assignees.length === 1
                        ? assignees[0].name
                        : t("issue.assigneeCount", { count: assignees.length })}
                  </span>
                  <IcChevD size={14} className="ml-auto text-faint" />
                </button>
              )}
            >
              <AssigneePicker data={data} selected={issue.assigneeIds} disabled={assigneeBusy} onChange={ids => void changeAssignees(ids)} selfOnlyId={me.accessRole === "employee" ? me.id : undefined} />
            </Popover>
            ) : (
              <Locked reason={denyMsg}>
                <UserAvatarGroup users={assignees} size={22} />
                <span className="min-w-0 truncate">{assignees.length ? assignees.map((a) => a.name).join(", ") : t("createIssue.unassigned")}</span>
              </Locked>
            )}
          </Field>

          <div>
            <div>
              <Field label={t("field.priority")}>
                <Flash key={issue.id} value={issue.priorityId} className="block">
                {editOk ? (
                <Menu
                  label={t("field.priority")}
                  trigger={(p, open) => (
                    <button {...p} type="button" className={selectCls}>
                      <PriorityIcon p={issue.priorityId} size={15} />
                      <span className="min-w-0 flex-1 truncate text-left">{t(`priority.${issue.priorityId}`)}</span>
                    </button>
                  )}
                  items={PRIORITY_ORDER.map((p: PriorityId) => ({
                    id: p,
                    text: t(`priority.${p}`),
                    icon: <PriorityIcon p={p} size={16} />,
                    label: t(`priority.${p}`),
                    hint: issue.priorityId === p ? <IcCheck size={14} className="text-accenttext" /> : undefined,
                    onSelect: () => updateIssue(issue.id, { priorityId: p }),
                  }))}
                />
                ) : (
                  <Locked reason={denyMsg}>
                    <PriorityIcon p={issue.priorityId} size={16} /> {t(`priority.${issue.priorityId}`)}
                  </Locked>
                )}
                </Flash>
              </Field>
            </div>
            <div>
              <Field label={t("field.dueDate")}>
                {editOk ? (
                  <><DatePicker block label={t("field.dueDate")} lang={lang} value={issue.dueDate ?? null} markOverdue={status.category !== "done"} onChange={(v) => updateIssue(issue.id, { dueDate: v })} />{overdue && <span className="issue-overdue">{overdueText}</span>}</>
                ) : (
                  <><Locked reason={denyMsg}>
                    <span className={`flex items-center gap-1.5 ${overdue ? "font-semibold text-danger" : ""}`}>
                      <IcCalendar size={14} />
                      {issue.dueDate ? fmtDate(issue.dueDate, lang) : "—"}
                    </span>
                  </Locked>{overdue && <span className="issue-overdue">{overdueText}</span>}</>
                )}
              </Field>
            </div>
          </div>
          <div className="issue-secondary-properties" data-expanded={detailsExpanded || undefined}>
            <button type="button" className="issue-details-toggle ds-focus" aria-expanded={detailsExpanded} aria-controls={feedId + "-details"} onClick={() => setDetailsExpanded(v => !v)}>{t("issue.details")}<IcChevD size={16} /></button>
            <div id={feedId + "-details"} className="issue-secondary-content">
              <div>
            <div className="min-w-[104px] flex-1">
              <Field label={t("field.complexity")}>
                {editOk ? (
                <Menu
                  label={t("field.complexity")}
                  trigger={(p, open) => (
                    <button {...p} type="button" className={selectCls}>
                      <span className="min-w-0 flex-1 truncate text-left">
                        {issue.complexity ? t(`complexity.${issue.complexity}`) : t("complexity.none")}
                      </span>
                      <IcChevD size={14} className="shrink-0 text-faint" />
                    </button>
                  )}
                  items={[null, ...COMPLEXITY_ORDER].map((c: ComplexityId | null) => ({
                    id: c ?? "none",
                    text: c ? t(`complexity.${c}`) : t("complexity.none"),
                    label: c ? t(`complexity.${c}`) : t("complexity.none"),
                    hint: issue.complexity === c ? <IcCheck size={14} className="text-accenttext" /> : undefined,
                    onSelect: () => updateIssue(issue.id, { complexity: c }),
                  }))}
                />
                ) : (
                  <Locked reason={denyMsg}>{issue.complexity ? t(`complexity.${issue.complexity}`) : t("complexity.none")}</Locked>
                )}
              </Field>
            </div>
          </div>

          {!isDirection && (
            <Field label={t("field.direction")}>
              {editOk ? (
              <Popover
                label={t("field.direction")}
                className="w-[300px]"
                trigger={(p, open) => (
                  <button {...p} type="button" className={selectCls}>
                    {epic ? (
                      <>
                        <span className="issue-color-fill h-2.5 w-2.5 shrink-0 rounded-sm" ref={cssVars({ "--issue-color": directionColor(epic.id, epic.color) })} />
                        <span className="truncate">{epic.title}</span>
                      </>
                    ) : (
                      <span className="text-faint">{t("createIssue.noDirection")}</span>
                    )}
                    <IcChevD size={14} className="ml-auto shrink-0 text-faint" />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <button type="button" className="ds-menu-item" onClick={() => { updateIssue(issue.id, { epicId: null }); close(); }}>
                      {t("createIssue.noDirection")}
                    </button>
                    <div role="separator" className="ds-menu-sep" />
                    {/* Кандидаты в «направление» ищутся на сервере: любая другая активная
                        задача проекта, а не плоский список всех задач (PERF-06). */}
                    <IssueSearchBox
                      autoFocus
                      ariaLabel={t("issue.searchDirection")}
                      excludeIds={[issue.id]}
                      onPick={(e) => { updateIssue(issue.id, { epicId: e.id }); close(); }}
                    />
                  </>
                )}
              </Popover>
              ) : (
                <Locked reason={denyMsg}>
                  {epic ? (
                    <>
                      <span className="issue-color-fill h-2.5 w-2.5 shrink-0 rounded-sm" ref={cssVars({ "--issue-color": directionColor(epic.id, epic.color) })} />
                      <span className="min-w-0 truncate">{epic.title}</span>
                    </>
                  ) : (
                    <span className="text-faint">{t("createIssue.noDirection")}</span>
                  )}
                </Locked>
              )}
            </Field>
          )}

          {isDirection && (
            <div className="space-y-2.5 rounded-md border border-dashed border-line p-2.5">
              <Field label={t("issue.directionColor")}>
                {editOk ? (
                  <div className="flex flex-wrap gap-1.5">
                    {DIRECTION_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => updateIssue(issue.id, { color: c })}
                        aria-label={t("issue.chooseColor", { color: c })}
                        className="issue-color-swatch issue-color-fill h-6 w-6 shrink-0 rounded-md transition-transform hover:scale-110"
                        ref={cssVars({ "--issue-color": c })}
                        data-selected={issue.color === c || undefined}
                      />
                    ))}
                  </div>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="issue-color-fill h-2.5 w-2.5 rounded-sm" ref={cssVars({ "--issue-color": issue.color ?? "var(--text-3)" })} />
                    {issue.color ?? t("issue.notSet")}
                  </span>
                )}
              </Field>
              <div className="issue-timeline-fields">
                <div>
                  <Field label={t("issue.startWeeks")}>
                    {editOk ? (
                      <input
                        type="number"
                        aria-label={t("issue.startWeeks")}
                        min={0}
                        max={52}
                        value={issue.tStart ?? 0}
                        onChange={(e) => updateIssue(issue.id, { tStart: Math.max(0, Math.min(52, Number(e.target.value))) })}
                        className="w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[13px] font-medium text-ink outline-none transition-colors focus:border-accent focus:shadow-focus"
                      />
                    ) : (
                      <span>{issue.tStart ?? 0}</span>
                    )}
                  </Field>
                </div>
                <div>
                  <Field label={t("issue.durationWeeks")}>
                    {editOk ? (
                      <input
                        type="number"
                        aria-label={t("issue.durationWeeks")}
                        min={1}
                        max={52}
                        value={issue.tSpan ?? 3}
                        onChange={(e) => updateIssue(issue.id, { tSpan: Math.max(1, Math.min(52, Number(e.target.value))) })}
                        className="w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[13px] font-medium text-ink outline-none transition-colors focus:border-accent focus:shadow-focus"
                      />
                    ) : (
                      <span>{issue.tSpan ?? 3}</span>
                    )}
                  </Field>
                </div>
              </div>
              <p className="text-[13px] leading-snug text-faint">{t("issue.timelinePositionHint")}</p>
            </div>
          )}

          {data.project.sprintsEnabled && <Field label={t("backlog.sprintFilter")}>
            {editOk ? <Menu label={t("backlog.sprintFilter")} trigger={p => <Button {...p} size="sm" className="issue-property-button">{data.sprints.find(sp => sp.id === issue.sprintId)?.name ?? t("issue.noSprint")}</Button>}
              items={[{ id: "none", label: t("issue.noSprint"), onSelect: () => updateIssue(issue.id, { sprintId: null }) }, ...data.sprints.map(sp => ({ id: sp.id, label: sp.name, disabled: sp.status === "completed", onSelect: () => updateIssue(issue.id, { sprintId: sp.id }) }))]} />
              : <Locked reason={denyMsg}>{data.sprints.find(sp => sp.id === issue.sprintId)?.name ?? t("issue.noSprint")}</Locked>}
          </Field>}
          <div className="space-y-3 border-t border-linesoft pt-3.5">
            <Field label={t("field.labels")}>
              <div ref={labelsRef} className="issue-labels flex flex-wrap gap-1.5">
                {issue.labels.map((l) => (
                  <span key={l} data-label={l} className="inline-flex">
                    <Tag size="sm" tone="gray" removeDisabled={labelsBusy} onRemove={editOk ? () => void changeLabels(issue.labels.filter(x => x !== l), labelsRef.current?.querySelector<HTMLElement>(`[data-label="${CSS.escape(l)}"]`) ?? null) : undefined}>
                      {l}
                    </Tag>
                  </span>
                ))}
                {editOk && (
                  <input
                    value={labelInput}
                    aria-label={t("field.labels")}
                    readOnly={labelsBusy}
                    onChange={(e) => setLabelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addLabel(e.currentTarget);
                      }
                    }}
                    placeholder={t("issue.labelPlaceholder")}
                    className="w-20 rounded border border-dashed border-line2 bg-transparent px-1.5 py-0.5 text-[13px] outline-none focus:border-accent focus:shadow-focus"
                  />
                )}
                {/* Предложенные метки проекта (шаблон проекта, ТЗ 5.10) — подсказка в один клик, не ограничение. */}
                {editOk &&
                  (data.projects.find((p) => p.id === data.currentProjectId)?.suggestedLabels ?? [])
                    .filter((l) => !issue.labels.includes(l))
                    .slice(0, 6)
                    .map((l) => (
                      <button
                        key={`s:${l}`}
                        type="button"
                        disabled={labelsBusy}
                        onClick={event => void changeLabels([...issue.labels, l], event.currentTarget)}
                        title={t("issue.suggestedLabel")}
                        className="rounded px-1.5 py-0.5 text-[13px] text-faint transition-colors hover:bg-hover hover:text-ink"
                      >
                        + {l}
                      </button>
                    ))}
                {issue.labels.length === 0 && !editOk && <span className="text-[13px] text-faint">{t("issue.noLabels")}</span>}
              </div>
            </Field>

            <CustomFieldsSection issue={issue} />

            <LinksField issue={issue} />

            <CollaboratorField issue={issue} />

          </div>

          <WatchButton projectId={data.currentProjectId} issueId={issue.id} watch={issue.watch ?? null} />
            </div>
          </div>
        </aside>
        <section className="issue-content min-w-0">

          {/* описание — сам блок кликабелен для входа в редактирование (отдельной
              кнопки «Редактировать» нет, как у EditableTitle) */}
          <div className="issue-description">
            <div className="issue-description-head"><h3 className="issue-section-label">{t("issue.description")}</h3>{editOk && !editingDesc && <Button variant="ghost" size="sm" iconLeft={<IcPencil size={14} />} onClick={startDesc}>{t("issue.descriptionEdit")}</Button>}</div>
            {editingDesc ? (
              <div className="anim-fadeup">
                <textarea
                  autoFocus
                  aria-label={t("issue.description")}
                  value={descDraft}
                  readOnly={descBusy}
                  aria-busy={descBusy || undefined}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onBlur={() => void saveDesc()}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditingDesc(false);
                    }
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
                  }}
                  rows={5}
                  placeholder={t("issue.descriptionPlaceholder")}
                  className="issue-description-editor w-full resize-y rounded-md border border-accent bg-panel p-3 outline-none ring-2 ring-accent/15"
                />
                <p className="mt-1 text-[13px] text-faint">{t("issue.descSaveHint")}</p>
                {descVersion.current !== issue.updatedAt && <div role="status" className="mt-2 text-[13px] text-sub">
                  <p>{t("issue.concurrentEdit")}</p>
                  <p className="whitespace-pre-wrap">{t("issue.latestValue", { value: issue.description })}</p>
                  <Button variant="secondary" size="sm" onMouseDown={event => event.preventDefault()} onClick={() => { descVersion.current = issue.updatedAt; void saveDesc(); }}>{t("issue.saveMine")}</Button>
                </div>}
              </div>
            ) : issue.description ? (
              editOk ? (
                <div
                  role="button"
                  tabIndex={0}
                  // Клик в режим правки — но не мешать выделению текста мышью для копирования:
                  // если пользователь что-то выделил, click после mouseup режим не переключает.
                  onClick={() => {
                    if (window.getSelection()?.toString()) return;
                    startDesc();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      startDesc();
                    }
                  }}
                  title={t("issue.clickToEdit")}
                  className="issue-description-text group cursor-text whitespace-pre-wrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <MentionText text={issue.description} />
                  <IcPencil size={14} className="ml-1.5 inline align-text-bottom text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              ) : (
                <p className="issue-description-text whitespace-pre-wrap"><MentionText text={issue.description} /></p>
              )
            ) : editOk ? (
              <button onClick={startDesc} className="w-full rounded-md border border-dashed border-line2 px-3 py-3 text-left text-[13.5px] text-faint transition-colors hover:border-accent hover:text-accenttext">
                {t("issue.addDescription")}
              </button>
            ) : (
              <p className="rounded-md border border-dashed border-line2 px-3 py-3 text-[13.5px] text-faint">{t("issue.noDescription")}</p>
            )}
          </div>

          {/* Лента (ТЗ 5.12 d): комментарии и история — одна лента по времени, переключатель сужает её. */}
          <div className="issue-related">
            <SubtasksField issue={issue} />
            <ChecklistField key={issue.id} issue={issue} />
            <AttachmentField issue={issue} />
          </div>

          <Tabs mode="tabs" variant="line" label={t("issue.feed.label")} value={feed} onChange={setFeed}
            items={(["all", "comments", "history"] as const).map(id => ({ id, label: t(id === "all" ? "issue.feed.all" : id === "comments" ? "issue.commentsCount" : "issue.activityCount", { count: id === "comments" ? issue.comments.length : issue.activity.length }), panelId: feedId + "-" + id, tabId: feedId + "-tab-" + id }))} />
          <EnterScope className="issue-feed space-y-4" role="tabpanel" id={feedId + "-" + feed} aria-labelledby={feedId + "-tab-" + feed} tabIndex={0}
            ids={[...(feed !== "history" ? issue.comments.map((c) => `c-${c.id}`) : []), ...(feed !== "comments" ? issue.activity.map((a) => `a-${a.id}`) : [])]} resetKey={issue.id + feed}>

            {(() => {
              // Новые сверху. Комментарий — пузырь с текстом; событие истории — тихая строка с аватаром.
              const items = [
                ...(feed !== "history" ? issue.comments.map((c) => ({ kind: "comment" as const, ts: c.ts, c })) : []),
                ...(feed !== "comments" ? issue.activity.map((a) => ({ kind: "event" as const, ts: a.ts, a })) : []),
              ].sort((x, y) => y.ts - x.ts);
              if (!items.length)
                return (
                  <p className="py-3 text-center text-[13px] text-faint">
                    {feed === "comments" ? t("issue.noComments") : feed === "history" ? t("issue.noActivity") : t("issue.feedEmpty")}
                  </p>
                );
              return items.map((it) => {
                if (it.kind === "comment") {
                  const u = it.c.author ?? data.users.find((x) => x.id === it.c.authorId);
                  return (
                    <div key={`c-${it.c.id}`} data-enter-id={`c-${it.c.id}`} className="flex gap-2.5">
                      <UserAvatar user={u ?? null} size={28} interactive />
                      <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm bg-sunken px-3.5 py-2.5 ring-1 ring-inset ring-linesoft">
                        <p className="text-[13px]">
                          <b className="font-semibold text-ink">{u?.name}</b>{u?.authSource === "service" && <span className="ml-1 inline-flex"><Tag size="sm">{t("tokens.serviceTag")}</Tag></span>} <span className="text-faint">· {relTime(it.c.ts, lang)}</span>
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-[1.5] text-sub">
                          <MentionText text={it.c.body} />
                        </p>
                      </div>
                    </div>
                  );
                }
                // Профиль автора приходит вместе с записью: история переживает вывод человека из проекта.
                const who = it.a.author;
                return (
                  <div key={`a-${it.a.id}`} data-enter-id={`a-${it.a.id}`} className="flex items-start gap-2.5 pl-1">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
                      <UserAvatar user={who} size={22} interactive />
                    </span>
                    <p className="text-[14.5px] leading-snug text-sub">
                      <b className="font-semibold text-ink">{who ? who.name.split(" ")[0] : t("issue.system")}</b>{who?.authSource === "service" && <span className="ml-1 inline-flex"><Tag size="sm">{t("tokens.serviceTag")}</Tag></span>} {activityLine(it.a.event, it.a.text, t, lang)}
                      <span className="ml-1.5 text-[13px] text-faint">{relTime(it.a.ts, lang)}</span>
                    </p>
                  </div>
                );
              });
            })()}
          </EnterScope>
          {(["all", "comments", "history"] as const).filter(id => id !== feed).map(id => <div key={id} role="tabpanel" id={feedId + "-" + id} aria-labelledby={feedId + "-tab-" + id} hidden />)}
          {pendingComment !== null && <div ref={pendingCommentRef} className="issue-pending-comment gap-2.5">
            <UserAvatar user={me} size={28} />
            <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm bg-sunken px-3.5 py-2.5 ring-1 ring-inset ring-linesoft">
              <p role="status" className="text-[13px] text-faint">{t("issue.commentSending")}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-[1.5] text-sub">{pendingComment}</p>
            </div>
          </div>}
          {canComment ? <div className="issue-comment-composer">
            <UserAvatar user={me} size={28} />
            <div className="min-w-0 flex-1">
              <MentionTextarea key={issue.id} projectId={data.currentProjectId} issueId={issue.id} ref={commentInputRef} aria-label={t("issue.feed.comments")} readOnly={commentBusy} aria-busy={commentBusy || undefined} value={comment} onValueChange={setComment} onKeyDown={e => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submitComment(); }
              }} rows={1} maxLength={LIMITS.comment.max} placeholder={t("issue.commentPlaceholder")} />
              <div className="issue-comment-actions"><kbd className="ds-kbd">Ctrl+Enter</kbd><Button ref={commentSendRef} size="sm" variant="ghost" className="issue-comment-send" disabled={!comment.trim() || commentBusy} loading={commentBusy} onClick={() => void submitComment()} iconLeft={<IcSend size={14} />}>{t("issue.send")}</Button></div>
            </div>
          </div> : <p className="text-[13px] text-faint">{t("issue.commentDenied")}</p>}
        </section>

      </div>
    </div>
  );

  // Полная страница (ADR-0013 §3): та же карточка внутри листа, вместо представления.
  return <>
    {page ? (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1180px]">{content}</div>
      </div>
    ) : (
    <SidePanel open={open} onClose={() => openIssue(null)} size="xl" headless title={t("issueModal.title", { key: issue.key, title: issue.title })}>
      {content}
    </SidePanel>
    )}
    <DeleteIssueDialog open={confirmDel && (page || open)} issue={issue} onClose={() => setConfirmDel(false)} onConfirm={() => { setConfirmDel(false); deleteIssue(issue.id); }} />
  </>;
}
