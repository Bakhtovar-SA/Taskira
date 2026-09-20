import { useEffect, useRef, useState } from "react";
import { assignableUsers, useStore } from "../store";
import type { ComplexityId, Issue, IssueTypeId, PriorityId } from "../types";
import { COMPLEXITY_ORDER, PRIORITY_ORDER, TYPE_ORDER } from "../types";
import { IcChevD, IcPlus, IcX, TypeIcon } from "../icons";
import { Avatar, AvatarStack, Dropdown, Modal, Chip } from "../ui";
import { IcCheck, PriorityIcon } from "../icons";
import { LIMITS } from "../validation";
import { useT } from "../i18n";
import IssueSearchBox from "./IssueSearchBox";
import { useIssue } from "../issuePages";

const inputCls = "w-full rounded-md border border-line bg-panel px-3 py-2 text-[13px] outline-none transition-shadow placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/15";

export default function CreateIssueModal() {
  const { t } = useT();
  const { data, ui, setCreateOpen, createIssue } = useStore();
  // Родитель создаваемой подзадачи: из кэша (его только что открывали) или точечный запрос по id.
  const parent = useIssue(ui.createParentId) ?? undefined;
  const [typeId, setTypeId] = useState<IssueTypeId>("task");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [description, setDescription] = useState("");
  const [priorityId, setPriorityId] = useState<PriorityId>("medium");
  const [complexity, setComplexity] = useState<ComplexityId | null>(null);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [epicId, setEpicId] = useState<string | null>(null);
  // Выбранное направление держим объектом: заголовок для кнопки берётся из него, а не
  // из списка всех задач проекта.
  const [epicPicked, setEpicPicked] = useState<Issue | null>(null);
  const [dirOpen, setDirOpen] = useState(false);
  const dirPanelRef = useRef<HTMLDivElement>(null);
  // Панель раскрывается внутри прокручиваемого тела модалки: без прокрутки список
  // оказывался бы под нижней панелью с кнопкой «Создать задачу».
  useEffect(() => {
    if (!dirOpen) return;
    const scroll = () => dirPanelRef.current?.scrollIntoView({ block: "nearest" });
    scroll();
    const id = setTimeout(scroll, 350); // после загрузки «недавних» панель вырастает
    return () => clearTimeout(id);
  }, [dirOpen]);
  const [dueDate, setDueDate] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [labelDraft, setLabelDraft] = useState("");
  const [checklistItems, setChecklistItems] = useState<string[]>([]);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [again, setAgain] = useState(false);
  // Шаблон (issue_templates, миграция 022) — чистый prefill формы: applyTemplate
  // копирует его поля в локальный стейт один раз при выборе, дальше форма живёт
  // как обычно (правки после применения шаблон не отслеживает и не блокирует).
  const [templateId, setTemplateId] = useState("");
  const [templateStatusId, setTemplateStatusId] = useState<string | null>(null);

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

  const submit = () => {
    if (!title.trim()) {
      setError(t("createIssue.titleRequired"));
      return;
    }
    const pendingChecklist = checklistDraft.trim();
    const initialChecklist = pendingChecklist ? [...checklistItems, pendingChecklist] : checklistItems;
    createIssue({
      title,
      description,
      typeId,
      priorityId,
      assigneeIds,
      epicId,
      parentId: ui.createParentId ?? null,
      labels,
      complexity,
      dueDate: dueDate || null,
      statusId: templateStatusId ?? undefined,
      checklistItems: initialChecklist,
    });
    if (again) {
      setTitle("");
      setDescription("");
      setError("");
      setDueDate("");
      setLabels([]);
      setChecklistItems([]);
      setChecklistDraft("");
      setTemplateId("");
      setTemplateStatusId(null);
    } else {
      setCreateOpen(false);
    }
  };

  return (
    <Modal onClose={() => setCreateOpen(false)} w={620} title={t("createIssue.title")}>
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <span className="font-disp text-[14px] font-bold text-ink">{parent ? t("createIssue.newSubtask") : t("createIssue.newIssue")}</span>
        <span className="rounded bg-linesoft px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-sub">{data.project.key}-{data.seq}</span>
        {parent && (
          <span className="rounded bg-accentsoft px-1.5 py-0.5 text-[10.5px] font-semibold text-accent">
            {t("createIssue.subtaskOf", { key: parent.key })}
          </span>
        )}
        <button onClick={() => setCreateOpen(false)} className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-canvas hover:text-ink" aria-label={t("common.close")}>
          <IcX size={15} />
        </button>
      </div>

      <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
        {/* шаблон (issue_templates, миграция 022) — только если в проекте есть хоть один */}
        {data.issueTemplates.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{t("createIssue.templateLabel")}</p>
            <select
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="w-full cursor-pointer rounded-md border border-line bg-panel px-3 py-2 text-[13px] outline-none focus:border-accent"
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
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{t("field.type")}</p>
          <div className="flex gap-1.5">
            {TYPE_ORDER.map((ty) => (
              <button
                key={ty}
                onClick={() => setTypeId(ty)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-2 py-2 text-[12.5px] font-semibold transition-all ${
                  typeId === ty ? "border-accent bg-accentsoft text-accent shadow-[0_0_0_2px_rgba(11,95,217,0.15)]" : "border-line bg-panel text-sub hover:border-line2"
                }`}
              >
                <TypeIcon type={ty} size={14} /> {t(`issueType.${ty}`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{t("createIssue.checklist")}</p>
          <div className="space-y-1.5">
            {checklistItems.map((item, index) => (
              <div key={`${item}-${index}`} className="flex items-center gap-2 rounded-md border border-linesoft bg-canvas/50 px-2.5 py-1.5 text-[12.5px] text-sub">
                <span className="h-3.5 w-3.5 shrink-0 rounded border border-line2 bg-panel" />
                <span className="min-w-0 flex-1 break-words">{item}</span>
                <button
                  type="button"
                  onClick={() => setChecklistItems((items) => items.filter((_, i) => i !== index))}
                  className="rounded p-0.5 text-faint hover:bg-dangersoft hover:text-danger"
                  aria-label={t("createIssue.removeChecklistItem")}
                >
                  <IcX size={12} />
                </button>
              </div>
            ))}
            {checklistItems.length < LIMITS.checklistItemsPerIssue && (
              <div className="flex gap-2">
                <input
                  value={checklistDraft}
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
                  className="flex h-[34px] w-[38px] shrink-0 items-center justify-center rounded-md border border-line text-sub hover:border-accent hover:text-accent disabled:opacity-40"
                  aria-label={t("createIssue.addChecklistItem")}
                >
                  <IcPlus size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* название */}
        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{t("createIssue.titleField")}</p>
          <input
            autoFocus
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={t("createIssue.titlePlaceholder")}
            maxLength={LIMITS.title.max}
            className={`${inputCls} ${error ? "border-danger ring-2 ring-danger/15" : ""}`}
          />
          {error && <p className="mt-1 text-[11.5px] font-semibold text-danger">{error}</p>}
        </div>

        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{t("createIssue.descriptionField")}</p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={LIMITS.description.max}
            placeholder={t("createIssue.descriptionPlaceholder")}
            className={`${inputCls} resize-y`}
          />
          {description.length > LIMITS.description.max * 0.8 && (
            <p className="mt-1 text-right font-mono text-[10.5px] text-faint">{description.length} / {LIMITS.description.max}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{t("field.priority")}</p>
            <Dropdown
              width={220}
              button={(open) => (
                <button className={`flex w-full items-center gap-2 rounded-md border bg-panel px-3 py-2 text-[13px] font-medium ${open ? "border-accent" : "border-line"}`}>
                  <PriorityIcon p={priorityId} size={14} /> {t(`priority.${priorityId}`)}
                  <IcChevD size={12} className="ml-auto text-faint" />
                </button>
              )}
            >
              {(close) => (
                <>
                  {PRIORITY_ORDER.map((p) => (
                    <button key={p} onClick={() => { setPriorityId(p); close(); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-accentsoft">
                      <PriorityIcon p={p} size={14} /> {t(`priority.${p}`)} {p === priorityId && <IcCheck size={12} className="ml-auto text-accent" />}
                    </button>
                  ))}
                </>
              )}
            </Dropdown>
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{t("field.assignee")}</p>
            <Dropdown
              width={220}
              button={(open) => (
                <button className={`flex w-full items-center gap-2 rounded-md border bg-panel px-3 py-2 text-[13px] font-medium ${open ? "border-accent" : "border-line"}`}>
                  <AvatarStack users={assignees} size={18} max={2} interactive={false} />
                  <span className={assignees.length ? "min-w-0 truncate" : "text-faint"}>
                    {assignees.length === 0
                      ? t("createIssue.unassigned")
                      : assignees.length === 1
                        ? assignees[0].name
                        : `${assignees[0].name} ${t("createIssue.assigneesMore", { n: assignees.length - 1 })}`}
                  </span>
                  <IcChevD size={12} className="ml-auto text-faint" />
                </button>
              )}
            >
              {() => (
                <>
                  {assignableUsers(data).map((u) => {
                    const on = assigneeIds.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        onClick={() => setAssigneeIds((p) => (on ? p.filter((id) => id !== u.id) : [...p, u.id]))}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-accentsoft"
                      >
                        <Avatar user={u} size={18} interactive={false} /> {u.name} {on && <IcCheck size={12} className="ml-auto text-accent" />}
                      </button>
                    );
                  })}
                </>
              )}
            </Dropdown>
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{t("field.direction")}</p>
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
              <IcChevD size={12} className={`shrink-0 text-faint transition-transform ${dirOpen ? "rotate-180" : ""}`} />
            </button>
            {dirOpen && (
              <div ref={dirPanelRef} className="mt-1.5 rounded-md border border-line bg-panel p-1.5">
                <button
                  type="button"
                  onClick={() => { setEpicId(null); setEpicPicked(null); setDirOpen(false); }}
                  className="mb-1 w-full rounded px-2 py-1.5 text-left text-[12px] text-sub transition-colors hover:bg-canvas"
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
            <p className="mt-1 text-[10.5px] leading-snug text-faint">{t("createIssue.directionHint")}</p>
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{t("field.complexity")}</p>
            <Dropdown
              width={220}
              button={(open) => (
                <button className={`flex w-full items-center gap-2 rounded-md border bg-panel px-3 py-2 text-[13px] font-medium ${open ? "border-accent" : "border-line"}`}>
                  <span className="min-w-0 flex-1 truncate text-left">{complexity ? t(`complexity.${complexity}`) : t("complexity.none")}</span>
                  <IcChevD size={12} className="ml-auto text-faint" />
                </button>
              )}
            >
              {(close) => (
                <>
                  <button onClick={() => { setComplexity(null); close(); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-accentsoft">
                    {t("complexity.none")} {complexity === null && <IcCheck size={12} className="ml-auto text-accent" />}
                  </button>
                  {COMPLEXITY_ORDER.map((c) => (
                    <button key={c} onClick={() => { setComplexity(c); close(); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-accentsoft">
                      {t(`complexity.${c}`)} {c === complexity && <IcCheck size={12} className="ml-auto text-accent" />}
                    </button>
                  ))}
                </>
              )}
            </Dropdown>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{t("field.dueDate")}</p>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${inputCls} cursor-pointer`} />
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{t("field.labels")}</p>
            <div className={`flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1.5 ${labelDraft ? "" : ""}`}>
              {labels.map((l) => (
                <Chip key={l} text={l} onRemove={() => setLabels((p) => p.filter((x) => x !== l))} />
              ))}
              <input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLabel();
                  }
                }}
                onBlur={addLabel}
                placeholder={t("createIssue.labelPlaceholder")}
                className="min-w-[70px] flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-line px-5 py-3.5">
        <button onClick={submit} className="rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(11,95,217,0.3)] transition-all hover:bg-accentdeep active:scale-[0.97]">
          {t("createIssue.submit")}
        </button>
        <button onClick={() => setCreateOpen(false)} className="rounded-md px-3 py-2 text-[13px] font-semibold text-sub hover:bg-canvas">
          {t("common.cancel")}
        </button>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12px] text-sub">
          <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          {t("createIssue.createAnother")}
        </label>
      </div>
    </Modal>
  );
}
