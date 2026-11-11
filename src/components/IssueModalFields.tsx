/** Секции карточки задачи: участники, файлы, подзадачи, чек-лист, свои поля, связи и меню действий.
 *  Вынесены из IssueModal.tsx без изменения поведения; сама карточка собирает их в IssueModal. */
import { RepeatIcon, type AutomationKind } from "./IssueAutomationControls";
import { usePendingMarks } from "../usePendingMarks";
import { useEffect, useMemo, useRef, useState } from "react";
import { cssVars } from "../cssVars";
import { useStore } from "../store";
import { LIMITS } from "../validation";
import type { CustomFieldDef, Issue } from "../types";
import { IcBell, IcCheck, IcDots, IcLink, IcSubtasks, IcX, TypeIcon } from "../icons";
import { Button } from "../ds/Button";
import { Checkbox } from "../ds/Field";
import { Select } from "../ds/Select";
import { Combobox } from "../ds/Combobox";
import { DatePicker } from "../ds/DatePicker";
import { Menu, Popover, type MenuEntry } from "../ds/LazyOverlay";
import type { TriggerProps } from "../ds/Overlay";
import { useT } from "../i18n";
import IssueSearchBox from "./IssueSearchBox";
import { freshRows, useIssueSet, useIssuesRevision, useOnRevision, type IssueSetQuery } from "../issuePages";
import { DATA_COLORS } from "../dataColors";
import { usersApi } from "../api";
import { EnterScope } from "../EnterScope";
import { ChecklistCount } from "../ChecklistCount";

/** Палитра направлений (issues.color) — те же тона, что уже использует бренд
 *  (Logo, приоритеты, TypeIcon «Запрос»), а не новые придуманные цвета. */
/** Палитра направлений = палитра проектов ТЗ 5.3 (одна светлота и хрома, разные
 *  тона; бренд-тон 288 не входит). Hex, а не токены: цвет хранится в БД. */
export const DIRECTION_COLORS = DATA_COLORS;

/** Родителем может быть только задача без своего родителя — не больше двух уровней. */
export const canBeParent = (i: Issue) => !i.parentId;

export function Field({ label, children, tile = false, action }: { label: React.ReactNode; children: React.ReactNode; tile?: boolean; action?: React.ReactNode }) {
  return <div className={tile ? "issue-tile" : "issue-field"}>
    <div className="issue-field-label"><span>{label}</span>{action}</div>
    <div className="issue-field-value">{children}</div>
  </div>;
}

export const selectCls = "issue-property-button ds-focus";

/** Приглашённые участники задачи (issue collaborators). Видны всем, кто открыл
 *  карточку; добавляет/убирает — manageCollaborators (admin/manager проекта). */
export function CollaboratorField({ issue }: { issue: Issue }) {
  const { t } = useT();
  const { data, can, addCollaborator, removeCollaborator } = useStore();
  const canManage = can("manageCollaborators", issue);
  const [expand, setExpand] = useState(false);

  const collabs = issue.collaborators;
  if (!canManage && collabs.length === 0) return <Field label={t("issue.collaborators")}><span className="text-faint">{t("issue.noCollaborators")}</span></Field>;

  const isResourceAdmin = (id: string) => data.users.some((u) => u.id === id && u.globalRole === "admin");
  // Исключаем из кандидатов: уже приглашённых, участников проекта (и так
  // видят), админов ресурса и себя самого. Кросс-департаментное приглашение
  // намеренно не ограничено — см. комментарий в routes/collaborators.ts.
  const exclude = new Set(collabs.map((c) => c.userId));
  for (const id of Object.keys(data.members)) exclude.add(id);
  for (const u of data.users) if (isResourceAdmin(u.id)) exclude.add(u.id);
  exclude.add(data.currentUserId);

  return (
    <Field label={t("issue.collaborators")}>
      <div className="flex flex-wrap gap-1.5">
        {collabs.map((c) => (
          <span
            key={c.userId}
            className="flex items-center gap-1.5 rounded-full bg-linesoft py-0.5 pl-1 pr-2 text-[13px] text-ink"
          >
            <span
              className="issue-color-fill inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-onaccent"
              ref={cssVars({ "--issue-color": c.color })}
            >
              {c.initials}
            </span>
            {c.name}
            {canManage && (
              <button
                onClick={() => removeCollaborator(issue.id, c.userId)}
                className="ml-0.5 text-faint transition-colors hover:text-danger"
                title={t("issue.removeCollaborator")}
              >
                <IcX size={12} />
              </button>
            )}
          </span>
        ))}
        {/* достижимо при canManage && expand (пустой развёрнутый инвайт) */}
        {collabs.length === 0 && <span className="text-[13px] text-faint">{t("issue.noCollaboratorsLower")}</span>}
      </div>
      {canManage && (
        <>
          <Popover label={t("issue.invite")} open={expand} onOpenChange={setExpand}
            className="issue-invite-popover"
            trigger={p => <Button {...p} size="sm" variant="ghost">{t("issue.invitePlus")}</Button>}>
            {close => <>
              <Combobox key={collabs.length} label={t("issue.invite")} placeholder={t("ui.findEmployee")} minChars={2}
                load={async q => (await usersApi.pickable(q)).filter(u => !exclude.has(u.id)).map(u => ({ id: u.id, label: u.name }))}
                onSelect={o => { addCollaborator(issue.id, o.id); close(); }} />
              <p className="mt-2 text-[13px] leading-snug text-sub">{t("issue.collaboratorHint")}</p>
            </>}
          </Popover>
        </>
      )}
    </Field>
  );
}

export const fmtBytes = (n: number, lang: "ru" | "en"): string => {
  if (n < 1024) return `${n} ${lang === "ru" ? "Б" : "B"}`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} ${lang === "ru" ? "КБ" : "KB"}`;
  return `${(n / 1024 / 1024).toFixed(1)} ${lang === "ru" ? "МБ" : "MB"}`;
};

/** Вложения задачи (attachments, миграция 010). Список + скачивание видят все, кто
 *  открыл карточку; прикрепляет — право comment; «×» — свой файл или право delete. */
export function AttachmentField({ issue }: { issue: Issue }) {
  const { t, lang } = useT();
  const { data, can, uploadAttachment, removeAttachment, downloadAttachment } = useStore();
  const canUpload = can("comment", issue), canDeleteAny = can("delete", issue);
  const fileRef = useRef<HTMLInputElement>(null);
  return <Field tile label={t("issue.attachments")} action={canUpload && <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>{t("issue.filePlus")}</Button>}>
    {canUpload && <input ref={fileRef} type="file" multiple className="hidden" aria-label={t("issue.attachFile")} onChange={e => {
      for (const file of Array.from(e.target.files ?? [])) uploadAttachment(issue.id, file);
      e.target.value = "";
    }} />}
    <div className="space-y-1">
      {issue.attachments.map(a => <div key={a.id} className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <IcLink size={14} className="shrink-0 text-faint" />
        <button onClick={() => downloadAttachment(issue.id, a)} className="ds-focus min-w-0 flex-1 truncate text-left text-ink hover:text-accenttext" title={t("issue.downloadFile", { filename: a.filename })}>{a.filename}</button>
        <span className="shrink-0 text-faint">{fmtBytes(a.byteSize, lang)}</span>
        {(canDeleteAny || a.uploadedById === data.currentUserId) && <button onClick={() => removeAttachment(issue.id, a.id)} className="ds-focus issue-small-action text-faint hover:text-danger" aria-label={t("issue.deleteAttachment")}><IcX size={14} /></button>}
      </div>)}
    </div>
    {issue.attachments.length === 0 && <p className="text-[13px] text-faint">{canUpload ? t("issue.dropFiles") : t("issue.noFiles")}</p>}
  </Field>;
}

/** Связанные задачи (issue_links, миграция 014, §3.2). Список видят все, кто
 *  открыл карточку; добавляет/убирает — право `edit` на эту задачу. */
/** Подзадачи (issues.parent_id, миграция 021): дети открытой задачи запрашиваются у сервера
 *  (`GET …/issues?parentId=`), а не выбираются фильтром из списка всех задач проекта. */
export function SubtasksField({ issue }: { issue: Issue }) {
  const { t } = useT();
  const { data, idx, can, openIssue, openCreateSubtask } = useStore();
  // Разрешаем «+ подзадача» только если сама задача ещё не чья-то подзадача —
  // сервер всё равно откажет во втором уровне вложенности (assignParentLocked),
  // но так кнопка не заводит на гарантированный отказ.
  const canCreate = can("create") && !issue.parentId;
  const query = useMemo<IssueSetQuery | null>(
    () => (data.currentProjectId ? { projectId: data.currentProjectId, filters: { parentId: issue.id }, sort: "rank", dir: "asc" } : null),
    [data.currentProjectId, issue.id],
  );
  const set = useIssueSet(query, { withCounts: false });
  useOnRevision(useIssuesRevision(), set.revalidate);
  const children = useMemo(() => freshRows(set.items, idx.issues), [set.items, idx.issues]);
  // subtasksSummary (детальный GET /issues/:id) считает total/done по ВСЕМ
  // детям, включая заархивированных — children здесь видит только активные
  // (data.issues — список по умолчанию), так что просто children.length
  // занижал бы бейдж, стоило закрытой подзадаче уйти в архив по возрасту
  // (ревью PR #46: "3/5" незаметно регрессировал бы в "2/4"). Пока summary
  // не пришёл (карточка только что открыта из списка) — временно считаем
  // локально, чтобы бейдж не мигал пустым.
  const summary =
    issue.subtasksSummary ??
    { total: children.length, done: children.filter((c) => idx.doneStatusIds.has(c.statusId)).length };
  const archivedCount = summary.total - children.length;

  return (
    <Field tile label={summary.total > 0 ? t("issue.subtasksCount", { done: summary.done, total: summary.total }) : t("issue.subtasks")}
      action={canCreate && <Button variant="ghost" size="sm" onClick={() => openCreateSubtask(issue.id)}>{t("issue.addSubtask")}</Button>}>
      {children.length > 0 && (
        <EnterScope className="space-y-1" ids={children.map(c => c.id)} resetKey={issue.id}>
          {children.map((c) => {
            const isDone = idx.doneStatusIds.has(c.statusId);
            return (
              <button
                key={c.id}
                data-enter-id={c.id}
                onClick={() => openIssue(c.id)}
                className="flex w-full items-center gap-2 rounded-md border border-line bg-panel px-2 py-1.5 text-left hover:bg-hover"
              >
                <TypeIcon type={c.typeId} size={15} />
                <span className="font-mono text-[13px] font-semibold text-faint">{c.key}</span>
                <span className={`min-w-0 flex-1 truncate text-[13px] ${isDone ? "text-faint line-through" : "text-ink"}`}>
                  {c.title}
                </span>
              </button>
            );
          })}
        </EnterScope>
      )}
      {archivedCount > 0 && (
        <p className={`text-[13px] text-faint ${children.length > 0 ? "mt-1.5" : ""}`}>
          {t("issue.archivedSubtasks", { count: archivedCount })}
        </p>
      )}
      {summary.total === 0 && <p className="text-[13px] text-faint">{t("issue.noSubtasks")}</p>}
    </Field>
  );
}

/** Чек-лист задачи (checklist_items, миграция 019). По образцу LinksField —
 *  без reorder в v1 (см. комментарий в самой миграции), просто добавление в
 *  конец, чек/анчек, удаление. */
export function ChecklistField({ issue }: { issue: Issue }) {
  const { t } = useT();
  const { can, addChecklistItem, toggleChecklistItem, removeChecklistItem } = useStore();
  const canEdit = can("edit", issue);
  const [draft, setDraft] = useState("");

  const [adding, setAdding] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [busyItems, setBusyItems] = useState<ReadonlySet<string>>(new Set());
  const addingRef = useRef(false);
  const toggling = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const mark = usePendingMarks(issue.id);
  const items = issue.checklist;

  const done = items.filter((i) => i.done).length;

  const submit = async () => {
    if (!draft.trim() || addingRef.current) return;
    const value = draft;
    addingRef.current = true;
    setAddBusy(true);
    try {
      const saved = await mark([inputRef.current], () => addChecklistItem(issue.id, value));
      if (saved) setDraft(current => current === value ? "" : current);
    } finally { addingRef.current = false; setAddBusy(false); }
  };
  const toggle = async (id: string, on: boolean) => {
    if (toggling.current.has(id)) return;
    toggling.current.add(id);
    setBusyItems(new Set(toggling.current));
    try { await mark([rows.current.get(id) ?? null], () => toggleChecklistItem(issue.id, id, on)); }
    finally { toggling.current.delete(id); setBusyItems(new Set(toggling.current)); }
  };

  return (
    <Field tile label={<ChecklistCount issueId={issue.id} done={done} total={items.length}>{t("issue.checklistCount", { done, total: items.length })}</ChecklistCount>} action={canEdit && <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>{t("issue.checklistAdd")}</Button>}>
      {items.length > 0 && (
        <EnterScope className="space-y-1" ids={items.map((i) => i.id)} resetKey={issue.id}>
          {items.map((item) => (
            <div
              key={item.id}
              data-enter-id={item.id}
              ref={node => { if (node) rows.current.set(item.id, node); else rows.current.delete(item.id); }}
              className="group flex items-center gap-2 rounded-md border border-line bg-panel px-2 py-1.5"
            >
              <Checkbox checked={item.done} disabled={!canEdit || busyItems.has(item.id)} onChange={(on) => void toggle(item.id, on)} label={item.text} labelHidden />
              <span data-done={item.done || undefined} className="cl-text min-w-0 flex-1 text-[13.5px] text-ink">
                {item.text}
              </span>
              {canEdit && (
                <button
                  disabled={busyItems.has(item.id)}
                  onClick={() => removeChecklistItem(issue.id, item.id)}
                  className="issue-small-action ds-focus text-faint hover:text-danger"
                  title={t("issue.deleteChecklistItem")}
                >
                  <IcX size={13} />
                </button>
              )}
            </div>
          ))}
        </EnterScope>
      )}

      {items.length === 0 && !adding && <p className="text-[13px] text-faint">{t("issue.noChecklist")}</p>}
      {canEdit && adding && (
        <input
          autoFocus
          aria-label={t("issue.addChecklistItem")}
          ref={inputRef}
          readOnly={addBusy}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          onBlur={submit}
          placeholder={t("issue.addChecklistItem")}
          maxLength={LIMITS.checklistItem.text.max}
          className={`w-full rounded-md border border-dashed border-line2 bg-transparent px-2 py-1.5 text-[13.5px] outline-none placeholder:text-faint focus:border-accent focus:shadow-focus ${items.length > 0 ? "mt-1.5" : ""}`}
        />
      )}
    </Field>
  );
}

/** Значения пользовательских полей проекта (custom_fields, миграция 020) —
 *  определения приходят в data.customFields (bootstrap), значения — в самой
 *  задаче (детальный GET). Управление определениями — в WorkflowView, не здесь. */
export function CustomFieldsSection({ issue }: { issue: Issue }) {
  const { data, can, setCustomFieldValue } = useStore();
  const canEdit = can("edit", issue);
  if (data.customFields.length === 0) return null;

  return (
    <>
      {data.customFields.map((field) => (
        <CustomFieldRow key={field.id} issue={issue} field={field} canEdit={canEdit} setValue={setCustomFieldValue} />
      ))}
    </>
  );
}

export function CustomFieldRow({
  issue,
  field,
  canEdit,
  setValue,
}: {
  issue: Issue;
  field: CustomFieldDef;
  canEdit: boolean;
  setValue: (issueId: string, fieldId: string, value: string | null, expectedValue?: string | null) => Promise<boolean>;
}) {
  const { t, lang } = useT();
  const current = issue.customFieldValues.find((v) => v.fieldId === field.id)?.value ?? "";
  const [draft, setDraft] = useState(current);
  const [dirty, setDirty] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const baseline = useRef(current);
  const pending = useRef(false);
  const currentId = useRef(issue.id);
  currentId.current = issue.id;
  useEffect(() => {
    if (!dirty && !focused) { setDraft(current); baseline.current = current; }
  }, [current, dirty, focused]);
  useEffect(() => {
    setDraft(current); baseline.current = current; setDirty(false); setFocused(false); setBusy(false); pending.current = false;
  }, [issue.id]);

  const commit = async (explicit = false) => {
    if (pending.current) return;
    if (draft === current) { setDirty(false); baseline.current = current; return; }
    // A remote value changed during editing: keep the draft for explicit resolution.
    if (!explicit && baseline.current !== current) return;
    const id = issue.id;
    pending.current = true; setBusy(true);
    try {
      const saved = await setValue(id, field.id, draft === "" ? null : draft, (explicit ? current : baseline.current) || null);
      if (currentId.current === id && saved) { setDirty(false); baseline.current = draft; }
    } finally { if (currentId.current === id) { pending.current = false; setBusy(false); } }
  };

  if (!canEdit) {
    return (
      <Field label={field.name}>
        <span className="text-[13.5px] text-ink">
          {field.fieldType === "checkbox" ? t(current === "true" ? "common.yes" : "common.no") : current || "—"}
        </span>
      </Field>
    );
  }

  return (
    <Field label={field.name}>
      {field.fieldType === "select" ? (
        <Select
          aria-label={field.name}
          value={current}
          onChange={(v) => setValue(issue.id, field.id, v === "" ? null : v)}
          placeholder="—"
          options={[{ value: "", label: "—" }, ...field.options.map((o) => ({ value: o, label: o }))]}
        />
      ) : field.fieldType === "checkbox" ? (
        <Checkbox checked={current === "true"} onChange={(on) => setValue(issue.id, field.id, on ? "true" : null)} label={field.name} labelHidden />
      ) : field.fieldType === "date" ? (
        <DatePicker block label={field.name} lang={lang} markOverdue={false} placeholder="—" value={current || null} onChange={(v) => setValue(issue.id, field.id, v)} />
      ) : (
        <><input
          aria-label={field.name}
          type={field.fieldType === "number" ? "number" : "text"}
          value={draft}
          readOnly={busy}
          aria-busy={busy || undefined}
          onFocus={() => { setFocused(true); if (!dirty) baseline.current = current; }}
          onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
          onBlur={() => { setFocused(false); void commit(); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-[14px] outline-none focus:border-accent focus:shadow-focus"
        />{dirty && baseline.current !== current && <div role="status" className="mt-1 text-[13px] text-sub">
          <p>{t("issue.concurrentEdit")}</p><p>{t("issue.latestValue", { value: current })}</p>
          <Button variant="secondary" size="sm" disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => void commit(true)}>{t("issue.saveMine")}</Button>
        </div>}</>
      )}
    </Field>
  );
}

/** Both surfaces use the same visible anchor: dismissal returns focus to Actions. */
export function IssueActionTrigger({ panel, menu, className, label, onAnchor }: { panel: TriggerProps; menu: TriggerProps; className: string; label: string; onAnchor?: (el:HTMLButtonElement|null)=>void }) {
  const ref = useMemo(() => (el: HTMLButtonElement | null) => {
    onAnchor?.(el);
    for (const r of [panel.ref, menu.ref]) {
      if (typeof r === "function") r(el);
      else if (r) r.current = el;
    }
  }, [panel.ref, menu.ref, onAnchor]);
  return <button {...(panel["aria-expanded"] ? panel : menu)} ref={ref} type="button" className={className} aria-label={label}><IcDots size={18} /></button>;
}

export function IssueActions({ issue, items, className, onAutomation }: { issue: Issue; items: MenuEntry[]; className: string; onAutomation:(kind:AutomationKind,anchor:HTMLElement)=>void }) {
  const { t } = useT();
  const { can, updateIssue, addIssueLink } = useStore();
  const [panel, setPanel] = useState<"parent" | "link" | null>(null);
  const [type, setType] = useState<"relates" | "blocks" | "blocked_by">("relates");
  const editable = can("edit", issue);
  const automationAnchor=useRef<HTMLButtonElement|null>(null);
  const setAutomationAnchor=useMemo(()=>(el:HTMLButtonElement|null)=>{automationAnchor.current=el},[]);
  const parentAction = issue.parentId ? t("issue.changeParent") : t("issue.makeSubtask");
  return <Popover open={panel !== null} onOpenChange={open => { if (!open) setPanel(null); }}
    placement="bottom-end" label={panel === "parent" ? parentAction : t("issue.addLink")}
    className="issue-relation-picker"
    trigger={p => <Menu label={t("common.actions")} placement="bottom-end"
      trigger={m => <IssueActionTrigger panel={p} menu={m} className={className} label={t("common.actions")} onAnchor={setAutomationAnchor} />}
      items={[
        ...(can("manageRecurring")?[{id:"repeat",label:t("automation.repeatTask"),icon:<RepeatIcon/>,onSelect:()=>{if(automationAnchor.current)onAutomation("repeat",automationAnchor.current)}}]:[]),
        {id:"reminder",label:t("automation.remind"),icon:<IcBell size={16}/>,onSelect:()=>{if(automationAnchor.current)onAutomation("reminder",automationAnchor.current)}},
        {id:"automation-sep",kind:"sep" as const},
        ...(editable ? [
          ...(issue.parentId || (issue.subtasksSummary?.total ?? 0) === 0 ? [{ id: "parent", label: parentAction, icon: <IcSubtasks size={16} />, onSelect: () => setPanel("parent") }] : []),
          { id: "link", label: t("issue.addLink"), icon: <IcLink size={16} />, onSelect: () => setPanel("link") },
          { id: "relations-sep", kind: "sep" as const },
        ] : []),
        ...items,
      ]} />}>
    {close => <>
      <div className="ds-menu-label">{panel === "parent" ? parentAction : t("issue.addLink")}</div>
      {panel === "parent" ? <>
        {issue.parentId && <><button type="button" className="ds-menu-item" onClick={() => { updateIssue(issue.id, { parentId: null }); close(); }}><IcSubtasks size={16} />{t("issue.removeParent")}</button><div role="separator" className="ds-menu-sep" /></>}
        <IssueSearchBox autoFocus ariaLabel={t("issue.searchParent")} excludeIds={[issue.id, ...(issue.parentId ? [issue.parentId] : [])]} accept={canBeParent}
          onPick={target => { updateIssue(issue.id, { parentId: target.id }); close(); }} />
      </> : <>
        <div className="mb-2" role="group" aria-label={t("issue.links")}>
          {(["relates", "blocks", "blocked_by"] as const).map(value => <button key={value} type="button" aria-pressed={type === value}
            className="ds-menu-item" onClick={() => setType(value)}><IcLink size={16} /><span className="flex-1 text-left">{t(`issue.link.${value}`)}</span>{type === value && <IcCheck size={14} className="text-accenttext" />}</button>)}
        </div>
        <IssueSearchBox autoFocus ariaLabel={t("issue.addLink")} excludeIds={[issue.id, ...issue.links.map(l => l.issue.id)]}
          onPick={target => { addIssueLink(issue.id, target.id, type); close(); }} />
      </>}
    </>}
  </Popover>;
}

export function LinksField({ issue }: { issue: Issue }) {
  const { t } = useT();
  const { can, removeIssueLink, openIssue } = useStore();
  if (!issue.links.length) return null;
  return <Field label={t("issue.links")}>
    <EnterScope className="space-y-1.5" ids={issue.links.map(l => l.id)} resetKey={issue.id}>
      {issue.links.map(l => <div key={l.id} data-enter-id={l.id} className="issue-linked-task">
        <span className="text-faint text-[12px]">{t(`issue.link.${l.dir}`)}</span>
        <div className="flex min-w-0 items-center gap-1.5">
          <button type="button" onClick={() => openIssue(l.issue.id)} className="ds-focus flex min-w-0 flex-1 items-center gap-1.5 text-left" title={l.issue.title}>
            <b className="shrink-0 text-accenttext">{l.issue.key}</b><span className="truncate">{l.issue.title}</span>
          </button>
          {can("edit", issue) && <button type="button" onClick={() => removeIssueLink(issue.id, l.id)} className="ds-focus shrink-0 text-faint hover:text-danger" aria-label={t("issue.removeLink") + ": " + l.issue.key}><IcX size={14} /></button>}
        </div>
      </div>)}
    </EnterScope>
  </Field>;
}
