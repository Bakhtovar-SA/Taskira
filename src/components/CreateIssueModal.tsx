import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { ComplexityId, Issue, IssueTypeId, PriorityId } from "../types";
import { COMPLEXITY_ORDER, PRIORITY_ORDER, TYPE_ORDER } from "../types";
import { IcChevD, IcPlus, IcX, TypeIcon } from "../icons";
import { labelTone } from "../ui";
import { UserAvatarGroup } from "./UserAvatar";
import { Button, Checkbox, DatePicker, Dialog, Menu, Popover, Tag } from "../ds";
import { IcCheck, PriorityIcon } from "../icons";
import { LIMITS } from "../validation";
import { useT } from "../i18n";
import AssigneePicker from "./AssigneePicker";
import IssueSearchBox from "./IssueSearchBox";
import { useIssue } from "../issuePages";
import { createDraftKey, readCreateDraft, saveCreateDraft, deleteCreateDraft } from "../createDrafts";

const inputCls = "w-full rounded-md border border-line bg-panel px-3 py-2 text-[14px] outline-none transition-shadow placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/15";

/** `open` — от `Presence` в App.tsx: после закрытия окно ещё доигрывает анимацию ухода. */
export default function CreateIssueModal({ open = true }: { open?: boolean }) {
  const { t, lang } = useT();
  const { data, ui, setCreateOpen, createIssue } = useStore();
  const [submitting, setSubmitting] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [submitError, setSubmitError] = useState("");
  const [draftKey] = useState(() => createDraftKey(data.currentUserId, data.currentProjectId, ui.createParentId));
  const [draft] = useState(() => readCreateDraft(draftKey));
  const close = () => { if (!submitting) setCreateOpen(false); };
  // Родитель создаваемой подзадачи: из кэша (его только что открывали) или точечный запрос по id.
  const liveParent = useIssue(ui.createParentId) ?? undefined;
  // Закрытие сбрасывает createParentId, а окно ещё ~200 мс уходит с анимацией: держим родителя, каким он был открытым,
  // иначе заголовок «Новая подзадача» успевает смениться на «Новая задача».
  const [heldParent, setHeldParent] = useState(liveParent);
  if (open && heldParent?.id !== liveParent?.id) setHeldParent(liveParent);
  const parent = open ? liveParent : heldParent;
  const [typeId, setTypeId] = useState<IssueTypeId>(draft?.typeId ?? "task");
  const [title, setTitle] = useState(draft?.title ?? "");
  const [error, setError] = useState("");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [priorityId, setPriorityId] = useState<PriorityId>(draft?.priorityId ?? "medium");
  const [complexity, setComplexity] = useState<ComplexityId | null>(draft?.complexity ?? null);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(draft?.assigneeIds ?? []);
  const [epicId, setEpicId] = useState<string | null>(draft?.epicId ?? null);
  // Выбранное направление держим объектом: заголовок для кнопки берётся из него, а не
  // из списка всех задач проекта.
  const [epicPicked, setEpicPicked] = useState<Issue | null>(draft?.epicPicked ?? null);
  const [dirOpen, setDirOpen] = useState(false);
  const dirPanelRef = useRef<HTMLDivElement>(null);
  const dirRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dirOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!dirRootRef.current?.contains(event.target as Node)) setDirOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [dirOpen]);
  // Панель раскрывается внутри прокручиваемого тела модалки: без прокрутки список
  // оказывался бы под нижней панелью с кнопкой «Создать задачу».
  useEffect(() => {
    if (!dirOpen) return;
    const scroll = () => dirPanelRef.current?.scrollIntoView({ block: "nearest" });
    scroll();
    const id = setTimeout(scroll, 350); // после загрузки «недавних» панель вырастает
    return () => clearTimeout(id);
  }, [dirOpen]);
  const [dueDate, setDueDate] = useState(ui.createDueDate ?? draft?.dueDate ?? "");
  const [labels, setLabels] = useState<string[]>(draft?.labels ?? []);
  const [labelDraft, setLabelDraft] = useState(draft?.labelDraft ?? "");
  const [checklistItems, setChecklistItems] = useState<string[]>(draft?.checklistItems ?? []);
  const [checklistDraft, setChecklistDraft] = useState(draft?.checklistDraft ?? "");
  const [again, setAgain] = useState(draft?.again ?? false);
  // Шаблон (issue_templates, миграция 022) — чистый prefill формы: applyTemplate
  // копирует его поля в локальный стейт один раз при выборе, дальше форма живёт
  // как обычно (правки после применения шаблон не отслеживает и не блокирует).
  const [templateId, setTemplateId] = useState(draft?.templateId ?? "");
  const [templateStatusId, setTemplateStatusId] = useState<string | null>(draft?.templateStatusId ?? null);

  useEffect(() => {
    if (!open || submitting) return;
    saveCreateDraft(draftKey, { typeId, title, description, priorityId, complexity, assigneeIds, epicId, epicPicked,
      dueDate, labels, labelDraft, checklistItems, checklistDraft, templateId, templateStatusId, again });
  }, [draftKey, open, submitting, typeId, title, description, priorityId, complexity, assigneeIds, epicId, epicPicked,
      dueDate, labels, labelDraft, checklistItems, checklistDraft, templateId, templateStatusId, again]);

  const clearDraft = () => {
    deleteCreateDraft(draftKey);
    setTypeId("task"); setTitle(""); setDescription(""); setError(""); setSubmitError(""); setPriorityId("medium");
    setComplexity(null); setAssigneeIds([]); setEpicId(null); setEpicPicked(null); setDirOpen(false);
    setDueDate(""); setLabels([]); setLabelDraft(""); setChecklistItems([]); setChecklistDraft("");
    setTemplateId(""); setTemplateStatusId(null);
  };

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = data.issueTemplates.find((x) => x.id === id);
    if (!t) {
      setTemplateStatusId(null);
      return;
    }
    setTypeId(t.typeId);
    setPriorityId(t.priorityId);
    setTitle(t.title);
    setDescription(t.description);
    setTemplateStatusId(t.statusId);
  };

  const assignees = assigneeIds.map((id) => data.users.find((u) => u.id === id)).filter((u): u is NonNullable<typeof u> => !!u);

  const addLabel = () => {
    const l = labelDraft.trim().toLowerCase();
    if (l && !labels.includes(l)) setLabels((p) => [...p, l]);
    setLabelDraft("");
  };

  const submit = async () => {
    if (!open || submitting) return;
    if (!title.trim()) { setError(t("createIssue.titleRequired")); return; }
    const pendingChecklist = checklistDraft.trim();
    const pendingLabel = labelDraft.trim().toLowerCase();
    setSubmitting(true);
    setError("");
    setSubmitError("");
    const issue = await createIssue({
      title, description, typeId, priorityId, assigneeIds, epicId,
      parentId: ui.createParentId ?? null,
      labels: pendingLabel && !labels.includes(pendingLabel) ? [...labels, pendingLabel] : labels,
      complexity, dueDate: dueDate || null, statusId: templateStatusId ?? undefined,
      checklistItems: pendingChecklist ? [...checklistItems, pendingChecklist] : checklistItems,
    });
    if (issue) deleteCreateDraft(draftKey);
    if (!mounted.current) return;
    setSubmitting(false);
    if (!issue) { setSubmitError(t("createIssue.failed")); return; }
    clearDraft();
    if (!again) setCreateOpen(false);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={
        <span className="flex flex-wrap items-center gap-2.5">
          {parent ? t("createIssue.newSubtask") : t("createIssue.newIssue")}
          <span className="rounded bg-linesoft px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-sub">{data.project.key}</span>
          {parent && (
            <span className="rounded bg-accentsoft px-1.5 py-0.5 text-[11.5px] font-semibold text-accenttext">
              {t("createIssue.subtaskOf", { key: parent.key })}
            </span>
          )}
        </span>
      }
      footer={
        <>
          <span className="mr-auto flex items-center">
            <Checkbox checked={again} onChange={setAgain} label={t("createIssue.createAnother")} />
          </span>
          <Button variant="ghost" onClick={close} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={submitting} disabled={!open}>
            {t("createIssue.submit")}
          </Button>
        </>
      }
    >
      <fieldset disabled={submitting} className="create-issue-form space-y-4">
        {/* шаблон (issue_templates, миграция 022) — только если в проекте есть хоть один */}
        {data.issueTemplates.length > 0 && (
          <div>
            <label htmlFor="create-issue-template" className="ds-label mb-1.5">{t("createIssue.templateLabel")}</label>
            <select
              id="create-issue-template"
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="w-full cursor-pointer rounded-md border border-line bg-panel px-3 py-2 text-[14px] outline-none focus:border-accent focus:shadow-focus"
            >
              <option value="">{t("createIssue.noTemplate")}</option>
              {data.issueTemplates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* тип */}
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-faint">{t("field.type")}</p>
          <div className="flex gap-1.5">
            {TYPE_ORDER.map((ty) => (
              <button
                key={ty}
                type="button"
                aria-pressed={typeId === ty}
                onClick={() => setTypeId(ty)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-2 py-2 text-[13.5px] font-semibold transition-all ${
                  typeId === ty ? "border-accent bg-accentsoft text-accenttext" : "border-line bg-panel text-sub hover:border-line2"
                }`}
              >
                <TypeIcon type={ty} size={16} /> {t(`issueType.${ty}`)}
              </button>
            ))}
          </div>
        </div>

        {/* название */}
        <div>
          <label htmlFor="create-issue-title" className="ds-label mb-1.5">{t("createIssue.titleField")}</label>
          <input
            id="create-issue-title"
            data-autofocus
            aria-invalid={!!error}
            aria-describedby={error ? "create-issue-error" : undefined}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }}
            placeholder={t("createIssue.titlePlaceholder")}
            maxLength={LIMITS.title.max}
            className={`${inputCls} ${error ? "border-danger ring-2 ring-danger/15" : ""}`}
          />
          {error && <p id="create-issue-error" role="alert" className="mt-1 text-[12.5px] font-semibold text-danger">{error}</p>}
        </div>

        <div>
          <label htmlFor="create-issue-description" className="ds-label mb-1.5">{t("createIssue.descriptionField")}</label>
          <textarea
            id="create-issue-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={LIMITS.description.max}
            placeholder={t("createIssue.descriptionPlaceholder")}
            className={`${inputCls} resize-y`}
          />
          {description.length > LIMITS.description.max * 0.8 && (
            <p className="mt-1 text-right tabular text-[11.5px] text-faint">{description.length} / {LIMITS.description.max}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-faint">{t("field.priority")}</p>
            <Menu
              label={t("field.priority")}
              trigger={(p, open) => (
                <button {...p} type="button" className={`flex w-full items-center gap-2 rounded-md border bg-panel px-3 py-2 text-[14px] font-medium ${open ? "border-accent" : "border-line"}`}>
                  <PriorityIcon p={priorityId} size={16} /> {t(`priority.${priorityId}`)}
                  <IcChevD size={14} className="ml-auto text-faint" />
                </button>
              )}
              items={PRIORITY_ORDER.map((p) => ({
                id: p,
                text: t(`priority.${p}`),
                icon: <PriorityIcon p={p} size={16} />,
                label: t(`priority.${p}`),
                hint: p === priorityId ? <IcCheck size={14} className="text-accenttext" /> : undefined,
                onSelect: () => setPriorityId(p),
              }))}
            />
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-faint">{t("field.assignee")}</p>
            {/* Несколько исполнителей — выбор не закрывает список, поэтому это Popover с переключателями, а не Menu. */}
            <Popover
              label={t("field.assignee")}
              className="max-h-[320px] w-[240px] overflow-y-auto"
              trigger={(p, open) => (
                <button {...p} type="button" className={`flex w-full items-center gap-2 rounded-md border bg-panel px-3 py-2 text-[14px] font-medium ${open ? "border-accent" : "border-line"}`}>
                  <UserAvatarGroup users={assignees} size={18} max={2} interactive={false} />
                  <span className={assignees.length ? "min-w-0 truncate" : "text-faint"}>
                    {assignees.length === 0
                      ? t("createIssue.unassigned")
                      : assignees.length === 1
                        ? assignees[0].name
                        : `${assignees[0].name} ${t("createIssue.assigneesMore", { n: assignees.length - 1 })}`}
                  </span>
                  <IcChevD size={14} className="ml-auto text-faint" />
                </button>
              )}
            >
              <AssigneePicker data={data} selected={assigneeIds} onChange={setAssigneeIds} />
            </Popover>
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-faint">{t("field.dueDate")}</p>
            <DatePicker block label={t("field.dueDate")} lang={lang} value={dueDate || null} onChange={(v) => setDueDate(v ?? "")} />
          </div>
        </div>
        <details className="form-disclosure" open={draft?.checklistItems.length || draft?.checklistDraft || draft?.labels.length || draft?.labelDraft || draft?.epicId || draft?.complexity ? true : undefined}>
          <summary className="ds-focus">{t("createIssue.moreFields")}</summary>
          <div className="space-y-4 pt-4">
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-faint">{t("createIssue.checklist")}</p>
              <div className="space-y-1.5">
                {checklistItems.map((item, index) => (
                  <div key={`${item}-${index}`} className="flex items-center gap-2 rounded-md border border-linesoft bg-sunken px-2.5 py-1.5 text-[13.5px] text-sub">
                    <span className="h-3.5 w-3.5 shrink-0 rounded border border-line2 bg-panel" />
                    <span className="min-w-0 flex-1 break-words">{item}</span>
                    <button
                      type="button"
                      onClick={() => setChecklistItems((items) => items.filter((_, i) => i !== index))}
                      className="rounded p-0.5 text-faint hover:bg-dangersoft hover:text-danger"
                      aria-label={t("createIssue.removeChecklistItem")}
                    >
                      <IcX size={14} />
                    </button>
                  </div>
                ))}
                {checklistItems.length < LIMITS.checklistItemsPerIssue && (
                  <div className="flex gap-2">
                    <input
                      value={checklistDraft}
                      aria-label={t("createIssue.checklist")}
                      onChange={(e) => setChecklistDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const text = checklistDraft.trim();
                          if (text) {
                            setChecklistItems((items) => [...items, text]);
                            setChecklistDraft("");
                          }
                        }
                      }}
                      maxLength={LIMITS.checklistItem.text.max}
                      placeholder={t("createIssue.checklistPlaceholder")}
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const text = checklistDraft.trim();
                        if (!text) return;
                        setChecklistItems((items) => [...items, text]);
                        setChecklistDraft("");
                      }}
                      disabled={!checklistDraft.trim()}
                      className="flex h-[34px] w-[38px] shrink-0 items-center justify-center rounded-md border border-line text-sub hover:border-accent hover:text-accenttext disabled:opacity-40"
                      aria-label={t("createIssue.addChecklistItem")}
                    >
                      <IcPlus size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div ref={dirRootRef} onKeyDown={event => {
                if (dirOpen && event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setDirOpen(false);
                  dirRootRef.current?.querySelector("button")?.focus();
                }
              }}>
                <p className="mb-1.5 text-[13px] font-medium text-faint">{t("field.direction")}</p>
                {/* Панель раскрывается в потоке формы, а не всплывающим слоем: тело модалки
                    прокручивается, и выпадашка обрезалась бы нижней панелью с кнопкой. */}
                <button
                  type="button"
                  onClick={() => setDirOpen((o) => !o)}
                  aria-expanded={dirOpen}
                  className={`${inputCls} flex items-center gap-2 text-left ${dirOpen ? "border-accent" : ""}`}
                >
                  <span className={`min-w-0 flex-1 truncate ${epicPicked ? "" : "text-faint"}`}>
                    {epicPicked ? epicPicked.title : t("createIssue.noDirection")}
                  </span>
                  <IcChevD size={14} className={`shrink-0 text-faint transition-transform ${dirOpen ? "rotate-180" : ""}`} />
                </button>
                {dirOpen && (
                  <div ref={dirPanelRef} className="mt-1.5 rounded-md border border-line bg-panel p-1.5">
                    <button
                      type="button"
                      onClick={() => { setEpicId(null); setEpicPicked(null); setDirOpen(false); }}
                      className="mb-1 w-full rounded px-2 py-1.5 text-left text-[13px] text-sub transition-colors hover:bg-hover"
                    >
                      {t("createIssue.noDirection")}
                    </button>
                    <IssueSearchBox
                      autoFocus
                      ariaLabel={t("field.direction")}
                      onPick={(e) => { setEpicId(e.id); setEpicPicked(e); setDirOpen(false); }}
                    />
                  </div>
                )}
                <p className="mt-1 text-[11.5px] leading-snug text-faint">{t("createIssue.directionHint")}</p>
              </div>
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-faint">{t("field.complexity")}</p>
                <Menu
                  label={t("field.complexity")}
                  trigger={(p, open) => (
                    <button {...p} type="button" className={`flex w-full items-center gap-2 rounded-md border bg-panel px-3 py-2 text-[14px] font-medium ${open ? "border-accent" : "border-line"}`}>
                      <span className="min-w-0 flex-1 truncate text-left">{complexity ? t(`complexity.${complexity}`) : t("complexity.none")}</span>
                      <IcChevD size={14} className="ml-auto text-faint" />
                    </button>
                  )}
                  items={[null, ...COMPLEXITY_ORDER].map((c) => ({
                    id: c ?? "none",
                    text: c ? t(`complexity.${c}`) : t("complexity.none"),
                    label: c ? t(`complexity.${c}`) : t("complexity.none"),
                    hint: c === complexity ? <IcCheck size={14} className="text-accenttext" /> : undefined,
                    onSelect: () => setComplexity(c),
                  }))}
                />
              </div>
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-faint">{t("field.labels")}</p>
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1.5">
                  {labels.map((l) => (
                    <Tag key={l} size="sm" tone={labelTone(l)} dot onRemove={() => setLabels((p) => p.filter((x) => x !== l))}>
                      {l}
                    </Tag>
                  ))}
                  <input
                    value={labelDraft}
                    aria-label={t("field.labels")}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addLabel();
                      }
                    }}
                    onBlur={addLabel}
                    placeholder={t("createIssue.labelPlaceholder")}
                    className="min-w-[70px] flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint"
                  />
                </div>
              </div>
            </div>
          </div>
        </details>
        {submitError && <p role="alert" className="text-[14px] text-danger">{submitError}</p>}
        <div className="draft-note flex flex-wrap items-center justify-between gap-2 text-[13px] text-faint">
          <span>{t("createIssue.draftSaved")}</span>
          <button type="button" onClick={clearDraft} className="ds-focus rounded px-1 py-2 font-medium text-sub hover:text-ink">{t("createIssue.discardDraft")}</button>
        </div>
      </fieldset>

    </Dialog>
  );
}
