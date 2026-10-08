import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cssVars } from "../cssVars";
import { localToday } from "../calendarLayout";
import { useStore } from "../store";
import { canTransition, fmtDate, relTime } from "../store/mappers";
import { pathForIssue } from "../router";
import { denialText } from "../permissions";
import { LIMITS } from "../validation";
import type { ComplexityId, CustomFieldDef, Issue, PriorityId } from "../types";
import { COMPLEXITY_ORDER, PRIORITY_ORDER } from "../types";
import { IcCalendar, IcCheck, IcChevD, IcExpand, IcDots, IcLink, IcLock, IcPencil, IcSend, IcX, PriorityIcon, StatusGlyph, TypeIcon } from "../icons";
import { catColor, directionColor } from "../ui";
import { Button } from "../ds/Button";
import { Checkbox } from "../ds/Field";
import { Combobox } from "../ds/Combobox";
import { DatePicker } from "../ds/DatePicker";
import { Dialog, SidePanel } from "../ds/Dialog";
import { Menu, Popover } from "../ds/LazyOverlay";
import { Tag } from "../ds/Display";
import { Tabs } from "../ds/Tabs";
import { DeleteIssueDialog } from "./DeleteIssueDialog";
import { UserAvatar, UserAvatarGroup } from "./UserAvatar";
import { useT } from "../i18n";
import AssigneePicker from "./AssigneePicker";
import IssueSearchBox from "./IssueSearchBox";
import { freshRows, useIssue, useIssueSet, useIssuesRevision, useOnRevision, type IssueSetQuery } from "../issuePages";
import { statusTone, workflowStatusName } from "../workflowStatus";
import { activityLine } from "../activityText";
import { DATA_COLORS } from "../dataColors";
import { neighborIssue, revealIssue } from "../issueNav";
import type { IssueMode } from "../store/mappers";
import { VIEW_LABEL } from "./Topbar";
import { issuesApi, usersApi } from "../api";

/** Палитра направлений (issues.color) — те же тона, что уже использует бренд
 *  (Logo, приоритеты, TypeIcon «Запрос»), а не новые придуманные цвета. */
/** Палитра направлений = палитра проектов ТЗ 5.3 (одна светлота и хрома, разные
 *  тона; бренд-тон 288 не входит). Hex, а не токены: цвет хранится в БД. */
const DIRECTION_COLORS = DATA_COLORS;

/** Текст комментария/описания с подсветкой @-упоминаний (NOTIFICATIONS_MIGRATION.md D5). */
export function MentionText({ text }: { text: string }) {
  const parts = text.split(/(@[a-z0-9._-]{3,32})/gi);
  return (
    <>
      {parts.map((p, i) =>
        /^@[a-z0-9._-]{3,32}$/i.test(p) ? (
          <span key={i} className="rounded bg-accentsoft px-1 font-semibold text-accenttext">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** Родителем может быть только задача без своего родителя — не больше двух уровней. */
const canBeParent = (i: Issue) => !i.parentId;

function Field({ label, children, tile = false, action }: { label: string; children: React.ReactNode; tile?: boolean; action?: React.ReactNode }) {
  return <div className={tile ? "issue-tile" : "issue-field"}>
    <div className="issue-field-label"><span>{label}</span>{action}</div>
    <div className="issue-field-value">{children}</div>
  </div>;
}

const selectCls = "issue-property-button ds-focus";

/** Приглашённые участники задачи (issue collaborators). Видны всем, кто открыл
 *  карточку; добавляет/убирает — manageCollaborators (admin/manager проекта). */
function CollaboratorField({ issue }: { issue: Issue }) {
  const { t } = useT();
  const { data, can, addCollaborator, removeCollaborator } = useStore();
  const canManage = can("manageCollaborators", issue);
  const [expand, setExpand] = useState(false);

  const collabs = issue.collaborators;
  if (!canManage && collabs.length === 0) return <Field label={t("issue.collaborators")}><span className="text-faint">{t("issue.noCollaborators")}</span></Field>;

  // Пустое состояние при праве управлять — одна компактная строка, без секции
  // во всю высоту (ticket-issuemodal-density §4).
  if (collabs.length === 0 && canManage && !expand) {
    return (
      <Field label={t("issue.collaborators")}>
        <Button size="sm" variant="ghost" onClick={() => setExpand(true)}>{t("issue.invitePlus")}</Button>
      </Field>
    );
  }

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
          <div className="mt-1.5">
            {/* key: после приглашения поле очищается (Combobox держит введённое у себя) */}
            <Combobox
              key={collabs.length}
              label={t("issue.invite")}
              placeholder={t("ui.findEmployee")}
              minChars={2}
              load={async (q) =>
                (await usersApi.pickable(q)).filter((u) => !exclude.has(u.id)).map((u) => ({ id: u.id, label: u.name }))
              }
              onSelect={(o) => addCollaborator(issue.id, o.id)}
            />
          </div>
          <p className="mt-1 text-[13px] leading-snug text-faint">
            {t("issue.collaboratorHint")}
          </p>
        </>
      )}
    </Field>
  );
}

const fmtBytes = (n: number, lang: "ru" | "en"): string => {
  if (n < 1024) return `${n} ${lang === "ru" ? "Б" : "B"}`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} ${lang === "ru" ? "КБ" : "KB"}`;
  return `${(n / 1024 / 1024).toFixed(1)} ${lang === "ru" ? "МБ" : "MB"}`;
};

/** Вложения задачи (attachments, миграция 010). Список + скачивание видят все, кто
 *  открыл карточку; прикрепляет — право comment; «×» — свой файл или право delete. */
function AttachmentField({ issue }: { issue: Issue }) {
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
function SubtasksField({ issue }: { issue: Issue }) {
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
        <div className="space-y-1">
          {children.map((c) => {
            const isDone = idx.doneStatusIds.has(c.statusId);
            return (
              <button
                key={c.id}
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
        </div>
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
function ChecklistField({ issue }: { issue: Issue }) {
  const { t } = useT();
  const { can, addChecklistItem, toggleChecklistItem, removeChecklistItem } = useStore();
  const canEdit = can("edit", issue);
  const [draft, setDraft] = useState("");

  const [adding, setAdding] = useState(false);
  const items = issue.checklist;

  const done = items.filter((i) => i.done).length;

  const submit = () => {
    if (!draft.trim()) return;
    addChecklistItem(issue.id, draft);
    setDraft("");
  };

  return (
    <Field tile label={t("issue.checklistCount", { done, total: items.length })} action={canEdit && <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>{t("issue.checklistAdd")}</Button>}>
      {items.length > 0 && (
        <div className="space-y-1">
          {items.map((item) => (
            <div
              key={item.id}
              className="group flex items-center gap-2 rounded-md border border-line bg-panel px-2 py-1.5"
            >
              <Checkbox checked={item.done} disabled={!canEdit} onChange={(on) => toggleChecklistItem(issue.id, item.id, on)} label={item.text} labelHidden />
              <span className={`min-w-0 flex-1 text-[13.5px] ${item.done ? "text-faint line-through" : "text-ink"}`}>
                {item.text}
              </span>
              {canEdit && (
                <button
                  onClick={() => removeChecklistItem(issue.id, item.id)}
                  className="issue-small-action ds-focus text-faint hover:text-danger"
                  title={t("issue.deleteChecklistItem")}
                >
                  <IcX size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {items.length === 0 && !adding && <p className="text-[13px] text-faint">{t("issue.noChecklist")}</p>}
      {canEdit && adding && (
        <input
          autoFocus
          aria-label={t("issue.addChecklistItem")}
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
function CustomFieldsSection({ issue }: { issue: Issue }) {
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

function CustomFieldRow({
  issue,
  field,
  canEdit,
  setValue,
}: {
  issue: Issue;
  field: CustomFieldDef;
  canEdit: boolean;
  setValue: (issueId: string, fieldId: string, value: string | null) => void;
}) {
  const { t, lang } = useT();
  const current = issue.customFieldValues.find((v) => v.fieldId === field.id)?.value ?? "";
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current, issue.id]);

  const commit = () => {
    if (draft === current) return;
    setValue(issue.id, field.id, draft === "" ? null : draft);
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
        <select
          aria-label={field.name}
          value={current}
          onChange={(e) => setValue(issue.id, field.id, e.target.value === "" ? null : e.target.value)}
          className="w-full cursor-pointer rounded-md border border-line bg-panel px-2.5 py-1.5 text-[14px] outline-none focus:border-accent focus:shadow-focus"
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : field.fieldType === "checkbox" ? (
        <Checkbox checked={current === "true"} onChange={(on) => setValue(issue.id, field.id, on ? "true" : null)} label={field.name} labelHidden />
      ) : field.fieldType === "date" ? (
        <DatePicker block label={field.name} lang={lang} markOverdue={false} placeholder="—" value={current || null} onChange={(v) => setValue(issue.id, field.id, v)} />
      ) : (
        <input
          aria-label={field.name}
          type={field.fieldType === "number" ? "number" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-[14px] outline-none focus:border-accent focus:shadow-focus"
        />
      )}
    </Field>
  );
}

function LinksField({ issue }: { issue: Issue }) {
  const { t } = useT();
  const { can, addIssueLink, removeIssueLink, openIssue } = useStore();
  const canEdit = can("edit", issue);
  const [expand, setExpand] = useState(false);
  const [type, setType] = useState<"relates" | "blocks" | "blocked_by">("relates");
  const [picking, setPicking] = useState(false);

  const links = issue.links;
  if (!canEdit && links.length === 0) return null;

  // Кандидаты ищутся на сервере (поиск по ключу/названию), а не берутся из
  // списка всех задач проекта; уже связанные и сама задача исключаются.
  const excludeIds = [issue.id, ...links.map((l) => l.issue.id)];

  const pick = (target: Issue) => {
    // Всегда линкуем «от открытой задачи»: сервер сам разворачивает 'blocked_by'
    // в строку 'blocks' наоборот и возвращает связи именно этой задачи, так что
    // модалка обновляется независимо от направления.
    addIssueLink(issue.id, target.id, type);
    setPicking(false);
    setExpand(false);
  };

  if (links.length === 0 && canEdit && !expand) {
    return (
      <Field label={t("issue.links")}>
        <Button size="sm" variant="ghost" onClick={() => setExpand(true)}>{t("issue.linkPlus")}</Button>
      </Field>
    );
  }

  return (
    <Field label={t("issue.links")}>
      <div className="space-y-1">
        {links.map((l) => {
          const c = catColor(l.issue.statusCategory);
          return (
            <div
              key={l.id}
              className="group flex items-center gap-2 rounded-md border border-line bg-panel px-2 py-1.5"
            >
              <span className="w-[76px] shrink-0 text-[13px] font-medium text-faint">
                {t(`issue.link.${l.dir}`)}
              </span>
              <span className="issue-color-fill h-2 w-2 shrink-0 rounded-sm" ref={cssVars({ "--issue-color": c.dot })} title={l.issue.statusCategory} />
              <button
                onClick={() => openIssue(l.issue.id)}
                className="shrink-0 font-mono text-[13px] font-semibold text-accenttext hover:underline"
              >
                {l.issue.key}
              </button>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{l.issue.title}</span>
              {canEdit && (
                <button
                  onClick={() => removeIssueLink(issue.id, l.id)}
                  className="shrink-0 text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  title={t("issue.removeLink")}
                >
                  <IcX size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {canEdit && (
        <div className="mt-1.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <select
              aria-label={t("issue.links")}
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className="shrink-0 rounded-md border border-line bg-panel px-1.5 py-1 text-[13px] text-sub focus:border-accent focus:shadow-focus focus:outline-none"
            >
              <option value="relates">{t("issue.link.relates")}</option>
              <option value="blocks">{t("issue.link.blocks")}</option>
              <option value="blocked_by">{t("issue.link.blocked_by")}</option>
            </select>
            <button
              onClick={() => setPicking((v) => !v)}
              className="rounded-md border border-line bg-panel px-2.5 py-1 text-[13px] font-semibold text-accenttext transition-colors hover:border-accent"
            >
              {picking ? t("common.cancel") : t("issue.linkPlus")}
            </button>
          </div>
          {picking && <IssueSearchBox autoFocus ariaLabel={t("issue.links")} excludeIds={excludeIds} onPick={pick} />}
        </div>
      )}
    </Field>
  );
}

/** `open` — от Presence в App.tsx (режим панели): после закрытия панель ещё доигрывает уход. */
export default function IssueModal({ mode = "panel", open = true }: { mode?: IssueMode; open?: boolean }) {
  const { t, tn, lang } = useT();
  const feedId = useId();
  const { data, ui, openIssue, updateIssue, moveStatus, addComment, deleteIssue, toast, can, uploadAttachment } = useStore();
  const live = data.issues.find((i) => i.id === ui.selectedIssueId);
  // Закрытие снимает selectedIssueId сразу, а панель ещё ~200 мс уходит с анимацией: на это время держим последнюю
  // показанную задачу, иначе содержимое исчезло бы за один кадр.
  const [held, setHeld] = useState(live);
  if (live && live !== held) setHeld(live);
  const issue = live ?? (open ? undefined : held);
  const [feed, setFeed] = useState<"all" | "comments" | "history">("comments");
  const [comment, setComment] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    setFeed("comments");
    setEditingDesc(false);
    setComment("");
    setConfirmDel(false);
    setLabelInput("");
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

  const submitComment = () => {
    if (!comment.trim()) return;
    addComment(issue.id, comment);
    setComment("");
  };

  // Мгновенное сохранение (ТЗ 5.12 d): при выходе из поля, без кнопки «Сохранить»; Esc — отменить.
  const saveDesc = () => {
    setEditingDesc(false);
    if (descDraft.trim() === issue.description) return;
    updateIssue(issue.id, { description: descDraft.trim() });
    toast("success", t("issue.descriptionSaved"));
  };

  const addLabel = () => {
    const l = labelInput.trim().toLowerCase();
    if (!l) return;
    if (!issue.labels.includes(l)) updateIssue(issue.id, { labels: [...issue.labels, l] });
    setLabelInput("");
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
  const nextCategory = status.category === "todo" ? "inprogress" : status.category === "inprogress" ? "done" : null;
  const nextStatus = data.workflow.transitions.filter(tr => tr.from === status.id).map(tr => data.workflow.statuses.find(target => target.id === tr.to)).find(target => target?.category === nextCategory);
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
          <Menu label={t("common.actions")} placement="bottom-end"
            trigger={p => <button {...p} type="button" className={iconBtn + " ds-focus"} aria-label={t("common.actions")}><IcDots size={18} /></button>}
            items={[
              ...(!page ? [
                { id: "prev", label: t("issue.prev"), disabled: !hasPrev, onSelect: () => go(-1) },
                { id: "next", label: t("issue.next"), disabled: !hasNext, onSelect: () => go(1) },
                { id: "full", label: t("issue.openFull"), onSelect: () => openIssue(issue.id, "page") },
              ] : []),
              { id: "copy", label: t("issue.copyLink"), onSelect: copyLink },
              ...(canDelete ? [{ id: "delete", label: t("common.delete"), danger: true, onSelect: () => setConfirmDel(true) }] : []),
            ]} />
          <button onClick={() => openIssue(null)} className={iconBtn} aria-label={t("common.close")}><IcX size={17} /></button>
        </div>
      </div>

      {/* Ниже ~720px карточка складывается в одну колонку: именно её открывают
          по ссылке из письма, в том числе с телефона (аудит UX-03). */}
      <div className="issue-layout">
        <section className="issue-heading min-w-0">
          <EditableTitle issue={issue} readOnly={!editOk} />
          <div className="issue-action-row">
            {statusControl}
            {transitionOk && nextStatus && <Button variant="primary" size="sm" onClick={() => moveStatus(issue.id, nextStatus.id, null)}>{status.category === "todo" && nextStatus.sid === "inprogress" ? t("issue.startWork") : workflowStatusName(nextStatus, t)}</Button>}
            <span className="issue-creator">{t("issue.createdBy", { name: reporter?.name ?? t("issue.system"), date: fmtDate(new Date(issue.createdAt).toISOString().slice(0, 10), lang) })}{reporter?.authSource === "service" && <span className="ml-1 inline-flex"><Tag size="sm">{t("tokens.serviceTag")}</Tag></span>}</span>
          </div>
          {issue.parentId && parentIssue && <button className="ds-focus text-[13px] text-accenttext" onClick={() => openIssue(issue.parentId)}>{t("issue.subtaskOf", { key: parentIssue.key })}</button>}
        </section>
        {/* правая панель */}
        <aside className="issue-properties">
          {!editOk && (
            <div className="flex items-start gap-2 rounded-md border border-line bg-warnsoft/50 px-2.5 py-2 text-[13px] leading-snug text-warn">
              <IcLock size={15} className="mt-0.5 shrink-0" />
              <span>{denyMsg}</span>
            </div>
          )}
          <Field label={t("issue.status")}>{statusControl}</Field>

          <Field label={t("issue.assignees")}>
            {editOk ? (
            <Popover
              label={t("issue.assignees")}
              className="max-h-[320px] w-[240px] overflow-y-auto"
              trigger={(p, open) => (
                <button {...p} type="button" className={selectCls}>
                  <UserAvatarGroup users={assignees} size={22} max={3} />
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
              <AssigneePicker data={data} selected={issue.assigneeIds} onChange={ids => updateIssue(issue.id, { assigneeIds: ids })} />
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
          <div>
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

          {/* Родитель (миграция 021, два уровня): сменить, снять или сделать задачу подзадачей.
              Задача со своими подзадачами сама подзадачей стать не может — поле тогда не показываем. */}
          {(issue.parentId || (editOk && (issue.subtasksSummary?.total ?? 0) === 0)) && (
            <Field label={t("issue.parent")}>
              {editOk ? (
                <Popover
                  label={t("issue.parent")}
                  className="w-[300px]"
                  trigger={(p, open) => (
                    <button {...p} type="button" className={selectCls} aria-label={t("issue.parent")}>
                      {issue.parentId && parentIssue ? (
                        <>
                          <span className="shrink-0 font-mono text-[13px] font-semibold text-faint">{parentIssue.key}</span>
                          <span className="truncate">{parentIssue.title}</span>
                        </>
                      ) : (
                        <span className="text-faint">{t("issue.noParent")}</span>
                      )}
                      <IcChevD size={14} className="ml-auto shrink-0 text-faint" />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      {issue.parentId && (
                        <>
                          <button type="button" className="ds-menu-item" onClick={() => { updateIssue(issue.id, { parentId: null }); close(); }}>
                            {t("issue.removeParent")}
                          </button>
                          <div role="separator" className="ds-menu-sep" />
                        </>
                      )}
                      <IssueSearchBox
                        autoFocus
                        ariaLabel={t("issue.searchParent")}
                        excludeIds={issue.parentId ? [issue.id, issue.parentId] : [issue.id]}
                        accept={canBeParent}
                        onPick={(p) => { updateIssue(issue.id, { parentId: p.id }); close(); }}
                      />
                    </>
                  )}
                </Popover>
              ) : (
                <Locked reason={denyMsg}>
                  {parentIssue ? <span className="min-w-0 truncate">{`${parentIssue.key} · ${parentIssue.title}`}</span> : <span className="text-faint">{t("issue.noParent")}</span>}
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
              <div className="flex gap-2.5">
                <div className="flex-1">
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
                <div className="flex-1">
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
              <div className="issue-labels flex flex-wrap gap-1.5">
                {issue.labels.map((l) => (
                  <Tag key={l} size="sm" tone="gray" onRemove={editOk ? () => updateIssue(issue.id, { labels: issue.labels.filter((x) => x !== l) }) : undefined}>
                    {l}
                  </Tag>
                ))}
                {editOk && (
                  <input
                    value={labelInput}
                    aria-label={t("field.labels")}
                    onChange={(e) => setLabelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addLabel();
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
                        onClick={() => updateIssue(issue.id, { labels: [...issue.labels, l] })}
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
        </aside>
        <section className="issue-content min-w-0">

          {/* описание — сам блок кликабелен для входа в редактирование (отдельной
              кнопки «Редактировать» нет, как у EditableTitle) */}
          <div className="issue-description">
            <p className="issue-section-label">{t("issue.description")}</p>
            {editingDesc ? (
              <div className="anim-fadeup">
                <textarea
                  autoFocus
                  aria-label={t("issue.description")}
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onBlur={saveDesc}
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
                  className="w-full resize-y rounded-md border border-accent bg-panel p-2.5 text-[14px] leading-relaxed outline-none ring-2 ring-accent/15"
                />
                <p className="mt-1 text-[13px] text-faint">{t("issue.descSaveHint")}</p>
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
                    setDescDraft(issue.description);
                    setEditingDesc(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDescDraft(issue.description);
                      setEditingDesc(true);
                    }
                  }}
                  title={t("issue.clickToEdit")}
                  className="group cursor-text whitespace-pre-wrap text-[15.5px] leading-[1.6] text-sub transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <MentionText text={issue.description} />
                  <IcPencil size={14} className="ml-1.5 inline align-text-bottom text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-[15.5px] leading-[1.6] text-sub"><MentionText text={issue.description} /></p>
              )
            ) : editOk ? (
              <button onClick={() => { setDescDraft(""); setEditingDesc(true); }} className="w-full rounded-md border border-dashed border-line2 px-3 py-3 text-left text-[13.5px] text-faint transition-colors hover:border-accent hover:text-accenttext">
                {t("issue.addDescription")}
              </button>
            ) : (
              <p className="rounded-md border border-dashed border-line2 px-3 py-3 text-[13.5px] text-faint">{t("issue.noDescription")}</p>
            )}
          </div>

          {/* Лента (ТЗ 5.12 d): комментарии и история — одна лента по времени, переключатель сужает её. */}
          <div className="issue-related">
            <SubtasksField issue={issue} />
            <ChecklistField issue={issue} />
            <AttachmentField issue={issue} />
          </div>

          <Tabs mode="tabs" variant="line" label={t("issue.feed.label")} value={feed} onChange={setFeed}
            items={(["all", "comments", "history"] as const).map(id => ({ id, label: t(id === "all" ? "issue.feed.all" : id === "comments" ? "issue.commentsCount" : "issue.activityCount", { count: id === "comments" ? issue.comments.length : issue.activity.length }), panelId: feedId + "-" + id, tabId: feedId + "-tab-" + id }))} />
          <div className="issue-feed space-y-4" role="tabpanel" id={feedId + "-" + feed} aria-labelledby={feedId + "-tab-" + feed} tabIndex={0}>

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
                    <div key={`c-${it.c.id}`} className="anim-fadeup flex gap-2.5">
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
                  <div key={`a-${it.a.id}`} className="flex items-start gap-2.5 pl-1">
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
          </div>
          {(["all", "comments", "history"] as const).filter(id => id !== feed).map(id => <div key={id} role="tabpanel" id={feedId + "-" + id} aria-labelledby={feedId + "-tab-" + id} hidden />)}
          {canComment ? <div className="issue-comment-composer">
            <UserAvatar user={me} size={28} />
            <div className="min-w-0 flex-1">
              <textarea aria-label={t("issue.feed.comments")} value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitComment(); }
              }} rows={1} maxLength={LIMITS.comment.max} placeholder={t("issue.commentPlaceholder")} />
              <div className="issue-comment-actions"><kbd className="ds-kbd">Ctrl+Enter</kbd><Button size="sm" variant="ghost" className="issue-comment-send" disabled={!comment.trim()} onClick={submitComment} iconLeft={<IcSend size={14} />}>{t("issue.send")}</Button></div>
            </div>
          </div> : <p className="text-[13px] text-faint">{t("issue.commentDenied")}</p>}
        </section>

      </div>
    </div>
  );

  // Полная страница (ADR-0013 §3): та же карточка внутри листа, вместо представления.
  if (page)
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1180px]">{content}</div>
        <DeleteIssueDialog open={confirmDel} issue={issue} onClose={() => setConfirmDel(false)} onConfirm={() => { setConfirmDel(false); deleteIssue(issue.id); }} />
      </div>
    );
  return (
    <>
    <SidePanel open={open} onClose={() => openIssue(null)} size="xl" headless title={t("issueModal.title", { key: issue.key, title: issue.title })}>
      {content}
    </SidePanel>
    <DeleteIssueDialog open={open && confirmDel} issue={issue} onClose={() => setConfirmDel(false)} onConfirm={() => { setConfirmDel(false); deleteIssue(issue.id); }} />
    </>
  );
}

/** Поле, которое человек не может менять: значение текстом, причина — в подсказке. Не кнопка: у читателя иначе было бы
 *  по лишней остановке Tab на каждое поле (была LockedField из ui.tsx). */
function Locked({ reason, children }: { reason: string; children: React.ReactNode }) {
  return (
    <div title={reason} className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg border border-linesoft bg-sunken px-2.5 py-1.5 text-[14px] text-faint">
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-left">{children}</span>
      <IcLock size={14} className="shrink-0" />
    </div>
  );
}

function EditableTitle({ issue, readOnly = false }: { issue: Issue; readOnly?: boolean }) {
  const { t } = useT();
  const { updateIssue } = useStore();
  const [draft, setDraft] = useState(issue.title);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(issue.title), [issue.title, issue.id]);

  if (readOnly) return <h2 className="px-0 py-1 issue-title font-bold leading-snug text-ink">{issue.title}</h2>;

  if (editing)
    return (
      <textarea
        autoFocus
        aria-label={t("issue.renameAria", { title: issue.title })}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        onBlur={() => {
          if (draft.trim() && draft.trim() !== issue.title) updateIssue(issue.id, { title: draft.trim() });
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLTextAreaElement).blur();
          if (e.key === "Escape") {
            e.preventDefault(); // отменить правку, не закрывая панель (Esc у <dialog> — закрытие)
            setDraft(issue.title);
            setEditing(false);
          }
        }}
        className="w-full resize-none rounded-md border border-accent bg-panel p-2 issue-title font-bold leading-snug text-ink outline-none ring-2 ring-accent/15"
      />
    );
  // Заголовок редактируется по клику, но должен открываться и с клавиатуры:
  // без tabIndex/роли переименовать задачу без мыши было нельзя (аудит UX-04).
  return (
    <h2 className="-mx-2">
      <span
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
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
function WatchButton({ projectId, issueId, watch }: { projectId: string; issueId: string; watch: { watching: boolean; watchers: number } | null }) {
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
