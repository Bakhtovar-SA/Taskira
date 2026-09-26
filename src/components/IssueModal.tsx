import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { assignableUsers, canTransition, fmtDate, relTime } from "../store/mappers";
import { pathForIssue } from "../router";
import { denialReason } from "../permissions";
import { LIMITS } from "../validation";
import type { ComplexityId, CustomFieldDef, Issue, PriorityId } from "../types";
import { COMPLEXITY_ORDER, PRIORITY_ORDER } from "../types";
import { IcCalendar, IcCheck, IcChevD, IcChevR, IcExpand, IcEye, IcLink, IcLock, IcPencil, IcSend, IcTrash, IcX, PriorityIcon, StatusGlyph, TypeIcon } from "../icons";
import { Avatar, AvatarStack, Chip, Dropdown, LockedField, Lozenge, MenuItem, Modal, UserSearchPicker, catColor } from "../ui";
import { useT } from "../i18n";
import IssueSearchBox from "./IssueSearchBox";
import { freshRows, useIssue, useIssueSet, useIssuesRevision, useOnRevision, type IssueSetQuery } from "../issuePages";
import { workflowStatusName } from "../workflowStatus";
import { neighborIssue, revealIssue } from "../issueNav";
import type { IssueMode } from "../store/mappers";
import { VIEW_LABEL } from "./Topbar";

/** Палитра направлений (issues.color) — те же тона, что уже использует бренд
 *  (Logo, приоритеты, TypeIcon «Запрос»), а не новые придуманные цвета. */
/** Палитра направлений = палитра проектов ТЗ 5.3 (одна светлота и хрома, разные
 *  тона; бренд-тон 288 не входит). Hex, а не токены: цвет хранится в БД. */
const DIRECTION_COLORS = ["#5283e0", "#a468c7", "#c65b93", "#d15c56", "#c66c00", "#2e9e52", "#00a19a", "#0094ce"];

/** Activity rows are stored as historical Russian text for compatibility.
 * Translate only known system phrases; captured user names/issue keys stay intact. */
function localizeActivity(text: string, lang: "ru" | "en", t: ReturnType<typeof useT>["t"]): string {
  if (lang === "ru") return text;
  const exact: Record<string, string> = {
    "создал(а) задачу": "created the issue",
    "переименовал(а) задачу": "renamed the issue",
    "обновил(а) описание": "updated the description",
    "изменил(а) группу (эпик)": "changed the direction",
    "сделал(а) подзадачей другой задачи": "made it a subtask of another issue",
    "убрал(а) из подзадач": "removed it from subtasks",
    "обновил(а) метки": "updated the labels",
    "удалил(а) пункт чек-листа": "deleted a checklist item",
  };
  if (exact[text]) return exact[text];
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^назначил\(а\) исполнителем (.+)$/, (m) => `assigned ${m[1]}`],
    [/^снял\(а\) исполнителя (.+)$/, (m) => `unassigned ${m[1]}`],
    [/^изменил\(а\) приоритет: (.+) → (.+)$/, (m) => `changed priority: ${translateMetric(m[1])} → ${translateMetric(m[2])}`],
    [/^изменил\(а\) сложность: (.+) → (.+)$/, (m) => `changed complexity: ${translateMetric(m[1])} → ${translateMetric(m[2])}`],
    [/^изменил\(а\) срок: (.+) → (.+)$/, (m) => `changed due date: ${m[1]} → ${m[2]}`],
    [/^переместил\(а\) из «(.+)» в «(.+)»$/, (m) => `moved from “${workflowStatusName({ name: m[1] }, t)}” to “${workflowStatusName({ name: m[2] }, t)}”`],
    [/^добавил\(а\) пункт чек-листа «(.+)»$/, (m) => `added checklist item “${m[1]}”`],
    [/^отметил\(а\), что задача блокирует (.+)$/, (m) => `marked the issue as blocking ${m[1]}`],
    [/^отметил\(а\), что задача заблокирована (.+)$/, (m) => `marked the issue as blocked by ${m[1]}`],
    [/^связал\(а\) с (.+)$/, (m) => `linked to ${m[1]}`],
  ];
  for (const [re, format] of rules) {
    const match = text.match(re);
    if (match) return format(match);
  }
  return text;
}

function translateMetric(value: string): string {
  return ({ Критичный: "Critical", Высокий: "High", Средний: "Medium", Низкий: "Low", Простая: "Simple", Сложная: "Hard" } as Record<string, string>)[value] ?? value;
}

/** Текст комментария/описания с подсветкой @-упоминаний (NOTIFICATIONS_MIGRATION.md D5). */
export function MentionText({ text }: { text: string }) {
  const parts = text.split(/(@[a-z0-9._-]{3,32})/gi);
  return (
    <>
      {parts.map((p, i) =>
        /^@[a-z0-9._-]{3,32}$/i.test(p) ? (
          <span key={i} className="rounded bg-accentsoft px-1 font-semibold text-accent">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-semibold text-faint">{label}</p>
      {children}
    </div>
  );
}

const selectCls = "flex w-full items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[13px] text-ink shadow-e1 transition-colors hover:border-line2";

/** Приглашённые участники задачи (issue collaborators). Видны всем, кто открыл
 *  карточку; добавляет/убирает — manageCollaborators (admin/manager проекта). */
function CollaboratorField({ issue }: { issue: Issue }) {
  const { t } = useT();
  const { data, can, addCollaborator, removeCollaborator } = useStore();
  const canManage = can("manageCollaborators", issue);
  const [expand, setExpand] = useState(false);

  const collabs = issue.collaborators;
  if (!canManage && collabs.length === 0) return null;

  // Пустое состояние при праве управлять — одна компактная строка, без секции
  // во всю высоту (ticket-issuemodal-density §4).
  if (collabs.length === 0 && canManage && !expand) {
    return (
      <Field label={t("issue.collaborators")}>
        <div className="flex items-center justify-between rounded-md border border-dashed border-line px-2.5 py-1.5 text-[11.5px] text-faint">
          <span>{t("issue.noCollaborators")}</span>
          <button onClick={() => setExpand(true)} className="font-semibold text-accent hover:underline">{t("issue.invitePlus")}</button>
        </div>
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
            className="flex items-center gap-1.5 rounded-full bg-linesoft py-0.5 pl-1 pr-2 text-[11.5px] text-ink"
          >
            <span
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[7.5px] font-semibold text-onaccent"
              style={{ background: c.color }}
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
                <IcX size={10} />
              </button>
            )}
          </span>
        ))}
        {/* достижимо при canManage && expand (пустой развёрнутый инвайт) */}
        {collabs.length === 0 && <span className="text-[12px] text-faint">{t("issue.noCollaboratorsLower")}</span>}
      </div>
      {canManage && (
        <>
          <div className="mt-1.5">
            <UserSearchPicker exclude={exclude} onPick={(userId) => addCollaborator(issue.id, userId)} pickLabel={t("issue.invite")} />
          </div>
          <p className="mt-1 text-[10px] leading-snug text-faint">
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
  const canUpload = can("comment", issue);
  const canDeleteAny = can("delete", issue);
  const fileRef = useRef<HTMLInputElement>(null);
  const atts = issue.attachments;
  if (!canUpload && atts.length === 0) return null;

  const hiddenInput = (
    <input
      ref={fileRef}
      type="file"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) uploadAttachment(issue.id, f);
        e.target.value = "";
      }}
    />
  );

  // Пустое состояние при праве загружать — одна компактная строка; «+ файл»
  // сразу открывает системный диалог (ticket-issuemodal-density §4).
  if (atts.length === 0 && canUpload) {
    return (
      <Field label={t("issue.attachments")}>
        {hiddenInput}
        <div className="flex items-center justify-between rounded-md border border-dashed border-line px-2.5 py-1.5 text-[11.5px] text-faint">
          <span>{t("issue.noFiles")}</span>
          <button onClick={() => fileRef.current?.click()} className="font-semibold text-accent hover:underline">{t("issue.filePlus")}</button>
        </div>
      </Field>
    );
  }

  return (
    <Field label={t("issue.attachments")}>
      <div className="space-y-1">
        {atts.map((a) => {
          const mine = a.uploadedById != null && a.uploadedById === data.currentUserId;
          return (
            <div
              key={a.id}
              className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 text-[11.5px]"
            >
              <IcLink size={11} className="shrink-0 text-faint" />
              <button
                onClick={() => downloadAttachment(issue.id, a)}
                className="min-w-0 flex-1 truncate text-left text-ink transition-colors hover:text-accent"
                title={t("issue.downloadFile", { filename: a.filename })}
              >
                {a.filename}
              </button>
              <span className="shrink-0 text-faint">{fmtBytes(a.byteSize, lang)}</span>
              {(canDeleteAny || mine) && (
                <button
                  onClick={() => removeAttachment(issue.id, a.id)}
                  className="shrink-0 text-faint transition-colors hover:text-danger"
                  title={t("issue.deleteAttachment")}
                >
                  <IcX size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {canUpload && (
        <>
          {hiddenInput}
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-1.5 rounded-md border border-dashed border-line2 px-2.5 py-1 text-[11px] font-semibold text-sub transition-colors hover:border-accent"
          >
            {t("issue.attachFile")}
          </button>
          <p className="mt-1 text-[10px] leading-snug text-faint">
            {t("issue.attachmentHint", { size: Math.round(LIMITS.attachment.maxBytes / 1024 / 1024) })}
          </p>
        </>
      )}
    </Field>
  );
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
  if (summary.total === 0 && !canCreate) return null;
  const archivedCount = summary.total - children.length;

  return (
    <Field label={summary.total > 0 ? t("issue.subtasksCount", { done: summary.done, total: summary.total }) : t("issue.subtasks")}>
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
                <TypeIcon type={c.typeId} size={13} />
                <span className="font-mono text-[11px] font-semibold text-faint">{c.key}</span>
                <span className={`min-w-0 flex-1 truncate text-[12px] ${isDone ? "text-faint line-through" : "text-ink"}`}>
                  {c.title}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {archivedCount > 0 && (
        <p className={`text-[11px] text-faint ${children.length > 0 ? "mt-1.5" : ""}`}>
          {t("issue.archivedSubtasks", { count: archivedCount })}
        </p>
      )}
      {canCreate && (
        <button
          onClick={() => openCreateSubtask(issue.id)}
          className={`flex items-center gap-1 text-[11.5px] font-semibold text-accent hover:underline ${children.length > 0 || archivedCount > 0 ? "mt-1.5" : ""}`}
        >
          {t("issue.addSubtask")}
        </button>
      )}
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

  const items = issue.checklist;
  if (!canEdit && items.length === 0) return null;

  const done = items.filter((i) => i.done).length;

  const submit = () => {
    if (!draft.trim()) return;
    addChecklistItem(issue.id, draft);
    setDraft("");
  };

  return (
    <Field label={items.length > 0 ? t("issue.checklistCount", { done, total: items.length }) : t("createIssue.checklist")}>
      {items.length > 0 && (
        <div className="space-y-1">
          {items.map((item) => (
            <div
              key={item.id}
              className="group flex items-center gap-2 rounded-md border border-line bg-panel px-2 py-1.5"
            >
              <input
                type="checkbox"
                checked={item.done}
                disabled={!canEdit}
                onChange={(e) => toggleChecklistItem(issue.id, item.id, e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 accent-accent disabled:opacity-50"
              />
              <span className={`min-w-0 flex-1 truncate text-[12.5px] ${item.done ? "text-faint line-through" : "text-ink"}`}>
                {item.text}
              </span>
              {canEdit && (
                <button
                  onClick={() => removeChecklistItem(issue.id, item.id)}
                  className="shrink-0 text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  title={t("issue.deleteChecklistItem")}
                >
                  <IcX size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <input
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
          className={`w-full rounded-md border border-dashed border-line2 bg-transparent px-2 py-1.5 text-[12.5px] outline-none placeholder:text-faint focus:border-accent focus:shadow-focus ${items.length > 0 ? "mt-1.5" : ""}`}
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
  const { t } = useT();
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
        <span className="text-[12.5px] text-ink">
          {field.fieldType === "checkbox" ? t(current === "true" ? "common.yes" : "common.no") : current || "—"}
        </span>
      </Field>
    );
  }

  return (
    <Field label={field.name}>
      {field.fieldType === "select" ? (
        <select
          value={current}
          onChange={(e) => setValue(issue.id, field.id, e.target.value === "" ? null : e.target.value)}
          className="w-full cursor-pointer rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent focus:shadow-focus"
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : field.fieldType === "checkbox" ? (
        <input
          type="checkbox"
          checked={current === "true"}
          onChange={(e) => setValue(issue.id, field.id, e.target.checked ? "true" : null)}
          className="h-3.5 w-3.5 accent-accent"
        />
      ) : field.fieldType === "date" ? (
        <input
          type="date"
          value={current}
          onChange={(e) => setValue(issue.id, field.id, e.target.value || null)}
          className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent focus:shadow-focus"
        />
      ) : (
        <input
          type={field.fieldType === "number" ? "number" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="w-full rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent focus:shadow-focus"
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
        <div className="flex items-center justify-between rounded-md border border-dashed border-line px-2.5 py-1.5 text-[11.5px] text-faint">
          <span>{t("issue.noLinks")}</span>
          <button onClick={() => setExpand(true)} className="font-semibold text-accent hover:underline">
            {t("issue.linkPlus")}
          </button>
        </div>
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
              <span className="w-[76px] shrink-0 text-[11.5px] font-medium text-faint">
                {t(`issue.link.${l.dir}`)}
              </span>
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: c.dot }} title={l.issue.statusCategory} />
              <button
                onClick={() => openIssue(l.issue.id)}
                className="shrink-0 font-mono text-[11px] font-semibold text-accent hover:underline"
              >
                {l.issue.key}
              </button>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{l.issue.title}</span>
              {canEdit && (
                <button
                  onClick={() => removeIssueLink(issue.id, l.id)}
                  className="shrink-0 text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  title={t("issue.removeLink")}
                >
                  <IcX size={11} />
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
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className="shrink-0 rounded-md border border-line bg-panel px-1.5 py-1 text-[11.5px] text-sub focus:border-accent focus:shadow-focus focus:outline-none"
            >
              <option value="relates">{t("issue.link.relates")}</option>
              <option value="blocks">{t("issue.link.blocks")}</option>
              <option value="blocked_by">{t("issue.link.blocked_by")}</option>
            </select>
            <button
              onClick={() => setPicking((v) => !v)}
              className="rounded-md border border-line bg-panel px-2.5 py-1 text-[11.5px] font-semibold text-accent transition-colors hover:border-accent"
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

export default function IssueModal({ mode = "panel" }: { mode?: IssueMode }) {
  const { t, lang } = useT();
  const { data, ui, openIssue, updateIssue, moveStatus, addComment, deleteIssue, toast, can } = useStore();
  const issue = data.issues.find((i) => i.id === ui.selectedIssueId);
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [comment, setComment] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    setTab("comments");
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
    if (mode !== "panel") return;
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
  }, [mode]);

  // Эпик и родитель открытой задачи — точечные запросы по id (или кэш), а не поиск в списке всех задач.
  const epic = useIssue(issue?.epicId);
  const parentIssue = useIssue(issue?.parentId);
  if (!issue) return null;

  // Без non-null-утверждений: раньше `!` глушил TypeScript, но при отсутствии
  // профиля или статуса рендер падал исключением и гасил всё приложение
  // (аудит BUG-03). Теперь — честный ранний выход с понятным текстом.
  const me = data.users.find((u) => u.id === data.currentUserId);
  const assignees = issue.assigneeIds.map((id) => data.users.find((u) => u.id === id)).filter((u): u is NonNullable<typeof u> => !!u);
  const reporter = data.users.find((u) => u.id === issue.reporterId);
  const status = data.workflow.statuses.find((s) => s.id === issue.statusId);
  if (!me || !status) {
    return (
      <Modal onClose={() => openIssue(null)} w={420} title={t("issue.unavailable")}>
        <div className="p-6 text-center">
          <p className="text-[14px] font-semibold text-ink">{t("issue.openFailed")}</p>
          <p className="mt-1.5 text-[12.5px] text-sub">
            {t("issue.openFailedHint")}
          </p>
          <button
            onClick={() => openIssue(null)}
            className="mt-4 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-onaccent"
          >
            {t("common.close")}
          </button>
        </div>
      </Modal>
    );
  }
  // Срок горит: дата в прошлом и задача не в финальной категории статуса.
  const overdue = !!issue.dueDate && status.category !== "done" && issue.dueDate < new Date().toISOString().slice(0, 10);
  // Тип "epic" упразднён (миграция 002): «направление» — задача, на которую ссылаются другие
  // через epicId. Признак приходит в детальном ответе (epicChildrenCount), а не выводится
  // обходом всех задач проекта; направление не может выбрать себе направление.
  const isDirection = (issue.epicChildrenCount ?? 0) > 0;

  /* права доступа: что можно делать с этой задачей */
  const editOk = can("edit", issue);
  const canDelete = can("delete");
  const canComment = can("comment");
  const denyMsg = denialReason(me, "edit", issue, lang);

  const submitComment = () => {
    if (!comment.trim()) return;
    addComment(issue.id, comment);
    setComment("");
  };

  const saveDesc = () => {
    updateIssue(issue.id, { description: descDraft.trim() });
    setEditingDesc(false);
    if (descDraft.trim() !== issue.description) toast("success", t("issue.descriptionSaved"));
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

  const content = (
    <>
      {/* шапка */}
      <div className={`flex items-center gap-2 border-b border-linesoft px-5 py-3 ${page ? "sticky top-0 z-10 bg-[color-mix(in_oklch,var(--bg-canvas)_82%,transparent)] backdrop-blur-md" : ""}`}>
        {page && (
          <>
            <button onClick={() => openIssue(null)} className="-ml-1.5 flex h-7 items-center gap-1 rounded-md pl-1 pr-2 text-[12.5px] font-semibold text-sub transition-colors hover:bg-hover hover:text-ink">
              <IcChevR size={13} className="rotate-180" />
              {t(VIEW_LABEL[ui.view])}
            </button>
            <span className="text-line2">/</span>
          </>
        )}
        <span title={t(`issueType.${issue.typeId}`)} className="flex items-center">
          <TypeIcon type={issue.typeId} size={16} />
        </span>
        <span className="font-mono text-[12.5px] text-sub">{issue.key}</span>
        {/* parentIssue может отсутствовать в загруженном data.issues (родитель
            заархивирован worker'ом после закрытия, или в проекте больше задач,
            чем клиент подгрузил на bootstrap) — тогда бейдж скрываем целиком
            вместо "подзадача ?", по образцу epic-бейджа выше (ревью PR #46). */}
        {issue.parentId && parentIssue && (
          <button
            onClick={() => openIssue(issue.parentId)}
            className="flex items-center gap-1 rounded bg-linesoft px-1.5 py-0.5 text-[10.5px] font-semibold text-sub transition-colors hover:bg-accentsoft hover:text-accent"
            title={t("issue.openParent")}
          >
            {t("issue.subtaskOf", { key: parentIssue.key })}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {!editOk && (
            <span className="mr-1 flex items-center gap-1.5 rounded bg-warnsoft px-2 py-1 text-[11.5px] font-medium text-warn" title={denyMsg}>
              <IcEye size={11} /> {t("issue.readOnly")}
            </span>
          )}
          {!page && (
            <>
              <button onClick={() => go(-1)} disabled={!hasPrev} className={iconBtn} title={`${t("issue.prev")} · K`} aria-label={t("issue.prev")}>
                <IcChevD size={15} className="rotate-180" />
              </button>
              <button onClick={() => go(1)} disabled={!hasNext} className={iconBtn} title={`${t("issue.next")} · J`} aria-label={t("issue.next")}>
                <IcChevD size={15} />
              </button>
              <span className="mx-0.5 h-4 w-px bg-linesoft" />
              <button onClick={() => openIssue(issue.id, "page")} className={iconBtn} title={t("issue.openFull")} aria-label={t("issue.openFull")}>
                <IcExpand size={15} />
              </button>
            </>
          )}
          <button onClick={copyLink} className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink" title={t("issue.copyLink")}>
            <IcLink size={15} />
          </button>
          {canDelete &&
            (!confirmDel ? (
              <button onClick={() => setConfirmDel(true)} className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-dangersoft hover:text-danger" title={t("common.delete")}>
                <IcTrash size={15} />
              </button>
            ) : (
              <span className="flex items-center gap-1.5 rounded-md bg-dangersoft px-2 py-1">
                <span className="text-[11.5px] font-semibold text-danger">{t("issue.deleteConfirm")}</span>
                <button onClick={() => deleteIssue(issue.id)} className="rounded bg-danger px-1.5 py-0.5 text-[11px] font-semibold text-onaccent hover:opacity-90">{t("common.yes")}</button>
                <button onClick={() => setConfirmDel(false)} className="text-[11px] font-semibold text-sub hover:text-ink">{t("common.no")}</button>
              </span>
            ))}
          <button onClick={() => openIssue(null)} className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink" aria-label={t("common.close")}>
            <IcX size={15} />
          </button>
        </div>
      </div>

      {/* Ниже ~720px карточка складывается в одну колонку: именно её открывают
          по ссылке из письма, в том числе с телефона (аудит UX-03). */}
      <div className="grid min-h-[calc(100%-49px)] grid-cols-1 gap-0 md:grid-cols-[1fr_300px]">
        {/* основная колонка */}
        <div className="min-w-0 px-6 py-5">
          <EditableTitle issue={issue} readOnly={!editOk} />

          {/* описание — сам блок кликабелен для входа в редактирование (отдельной
              кнопки «Редактировать» нет, как у EditableTitle) */}
          <div className="mt-4">
            <p className="mb-1.5 text-[12px] font-medium text-faint">{t("issue.description")}</p>
            {editingDesc ? (
              <div className="anim-fadeup">
                <textarea
                  autoFocus
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  rows={5}
                  placeholder={t("issue.descriptionPlaceholder")}
                  className="w-full resize-y rounded-md border border-accent bg-panel p-2.5 text-[13px] leading-relaxed outline-none ring-2 ring-accent/15"
                />
                <div className="mt-1.5 flex gap-1.5">
                  <button onClick={saveDesc} className="rounded btn-primary px-3 py-1 text-[12px] font-medium text-onaccent">{t("common.save")}</button>
                  <button onClick={() => setEditingDesc(false)} className="rounded px-3 py-1 text-[12px] font-semibold text-sub hover:bg-hover">{t("common.cancel")}</button>
                </div>
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
                  className="group cursor-text whitespace-pre-wrap rounded-md bg-sunken p-3 text-[13px] leading-relaxed text-sub transition-colors hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <MentionText text={issue.description} />
                  <IcPencil size={12} className="ml-1.5 inline align-text-bottom text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              ) : (
                <p className="whitespace-pre-wrap rounded-md bg-sunken p-3 text-[13px] leading-relaxed text-sub"><MentionText text={issue.description} /></p>
              )
            ) : editOk ? (
              <button onClick={() => { setDescDraft(""); setEditingDesc(true); }} className="w-full rounded-md border border-dashed border-line2 px-3 py-3 text-left text-[12.5px] text-faint transition-colors hover:border-accent hover:text-accent">
                {t("issue.addDescription")}
              </button>
            ) : (
              <p className="rounded-md border border-dashed border-line2 px-3 py-3 text-[12.5px] text-faint">{t("issue.noDescription")}</p>
            )}
          </div>

          {/* вкладки */}
          <div className="mt-6 flex items-center gap-1 border-b border-linesoft">
            {([["comments", t("issue.commentsCount", { count: issue.comments.length })], ["activity", t("issue.activityCount", { count: issue.activity.length })]] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`relative px-3 py-2 text-[13px] font-medium transition-colors ${tab === id ? "text-ink" : "text-faint hover:text-ink"}`}
              >
                {label}
                {tab === id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>

          {tab === "comments" ? (
            <div className="mt-3.5 space-y-4">
              {canComment ? (
              <div className="flex gap-2.5">
                <Avatar user={me} size={28} interactive />
                <div className="flex-1">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitComment();
                    }}
                    rows={2}
                    maxLength={LIMITS.comment.max}
                    placeholder={t("issue.commentPlaceholder")}
                    className="w-full resize-y rounded-md border border-line bg-panel p-2.5 text-[13px] outline-none transition-shadow placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/15"
                  />
                  <div className="mt-1.5 flex justify-end">
                    <button
                      onClick={submitComment}
                      disabled={!comment.trim()}
                      className="flex items-center gap-1.5 rounded-lg btn-primary px-3 py-1.5 text-[12px] font-medium text-onaccent transition-all disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <IcSend size={12} /> {t("issue.send")}
                    </button>
                  </div>
                </div>
              </div>
              ) : (
                <p className="flex items-center gap-2 rounded-md border border-dashed border-line2 bg-sunken px-3 py-2.5 text-[12px] text-faint">
                  <IcLock size={13} /> {t("issue.commentDenied")}
                </p>
              )}
              {[...issue.comments].reverse().map((c) => {
                const u = data.users.find((x) => x.id === c.authorId);
                return (
                  <div key={c.id} className="anim-fadeup flex gap-2.5">
                    <Avatar user={u ?? null} size={28} interactive />
                    <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm bg-sunken px-3.5 py-2.5 ring-1 ring-inset ring-linesoft">
                      <p className="text-[12px]">
                        <b className="font-semibold text-ink">{u?.name}</b> <span className="text-faint">· {relTime(c.ts, lang)}</span>
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-sub"><MentionText text={c.body} /></p>
                    </div>
                  </div>
                );
              })}
              {issue.comments.length === 0 && <p className="py-3 text-center text-[12px] text-faint">{t("issue.noComments")}</p>}
            </div>
          ) : (
            <div className="mt-4 space-y-0">
              {[...issue.activity].reverse().map((a, idx, arr) => {
                // Профиль автора приходит вместе с записью: история переживает
                // вывод человека из проекта и удаление его учётки.
                const who = a.author;
                return (
                  <div key={a.id} className="relative flex gap-3 pb-4">
                    {idx < arr.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-line" />}
                    <span className="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-panel">
                      <Avatar user={who} size={18} interactive />
                    </span>
                    <p className="pt-0.5 text-[12.5px] leading-snug text-sub">
                      <b className="font-semibold text-ink">{who ? who.name.split(" ")[0] : t("issue.system")}</b> {localizeActivity(a.text, lang, t)}
                      <span className="ml-1.5 text-[11px] text-faint">{relTime(a.ts, lang)}</span>
                    </p>
                  </div>
                );
              })}
              {issue.activity.length === 0 && (
                <p className="py-3 text-center text-[12px] text-faint">{t("issue.noActivity")}</p>
              )}
            </div>
          )}
        </div>

        {/* правая панель */}
        <aside className="space-y-3.5 border-t border-linesoft bg-sunken/80 px-4 py-5 md:border-l md:border-t-0">
          {!editOk && (
            <div className="flex items-start gap-2 rounded-md border border-line bg-warnsoft/50 px-2.5 py-2 text-[11.5px] leading-snug text-warn">
              <IcLock size={13} className="mt-0.5 shrink-0" />
              <span>{denyMsg}</span>
            </div>
          )}
          <Field label={t("issue.status")}>
            {editOk ? (
            <Dropdown
              width={220}
              button={(open) => {
                const c = catColor(status.category);
                return (
                  <button
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium ring-1 ring-inset ring-[oklch(0.5_0.02_288/0.08)] transition-[filter] hover:brightness-[0.98] ${open ? "!ring-2 !ring-accent/40" : ""}`}
                    style={{ background: c.bg, color: c.fg }}
                  >
                    <StatusGlyph category={status.category} size={14} />
                    <span className="min-w-0 truncate">{workflowStatusName(status, t)}</span>
                    <IcChevD size={12} className="ml-auto shrink-0" />
                  </button>
                );
              }}
            >
              {(close) => (
                <>
                  {data.workflow.statuses.map((s) => {
                    const allowed = canTransition(data.workflow, issue.statusId, s.id);
                    return (
                      <MenuItem
                        key={s.id}
                        disabled={!allowed}
                        title={allowed ? undefined : t("issue.transitionForbidden")}
                        onClick={() => {
                          moveStatus(issue.id, s.id, null);
                          close();
                        }}
                      >
                        <Lozenge status={s} size="sm" />
                        {s.id === issue.statusId && <IcCheck size={12} className="ml-auto text-accent" />}
                        {!allowed && <IcLock size={12} className="ml-auto" />}
                      </MenuItem>
                    );
                  })}
                  <p className="border-t border-linesoft px-3 py-1.5 text-[10.5px] leading-snug text-faint">{t("issue.transitionsHint")}</p>
                </>
              )}
            </Dropdown>
            ) : (
              (() => {
                const c = catColor(status.category);
                return (
                  <span
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium"
                    style={{ background: c.bg, color: c.fg }}
                    title={denyMsg}
                  >
                    <StatusGlyph category={status.category} size={14} />
                    <span className="min-w-0 truncate">{workflowStatusName(status, t)}</span>
                    <IcLock size={11} className="ml-auto shrink-0 opacity-70" />
                  </span>
                );
              })()
            )}
          </Field>

          <Field label={t("issue.assignees")}>
            {editOk ? (
            <Dropdown
              width={240}
              button={(open) => (
                <button className={`${selectCls} ${open ? "border-accent" : ""}`}>
                  <AvatarStack users={assignees} size={20} max={3} interactive={false} />
                  <span className={assignees.length ? "min-w-0 truncate" : "text-faint"}>
                    {assignees.length === 0
                      ? t("createIssue.unassigned")
                      : assignees.length === 1
                        ? assignees[0].name
                        : t("issue.assigneeCount", { count: assignees.length })}
                  </span>
                  <IcChevD size={12} className="ml-auto text-faint" />
                </button>
              )}
            >
              {() => {
                const candidates = assignableUsers(data, issue.assigneeIds);
                return (
                  <>
                    {candidates.map((u) => {
                      const on = issue.assigneeIds.includes(u.id);
                      return (
                        <MenuItem
                          key={u.id}
                          onClick={() =>
                            updateIssue(issue.id, {
                              assigneeIds: on ? issue.assigneeIds.filter((id) => id !== u.id) : [...issue.assigneeIds, u.id],
                            })
                          }
                        >
                          <Avatar user={u} size={20} interactive={false} /> {u.name} {on && <IcCheck size={12} className="ml-auto text-accent" />}
                        </MenuItem>
                      );
                    })}
                    {candidates.length === 0 && <p className="px-3 py-2 text-[12px] text-faint">{t("issue.noAssignableUsers")}</p>}
                  </>
                );
              }}
            </Dropdown>
            ) : (
              <LockedField reason={denyMsg}>
                <span className="flex items-center gap-2">
                  <AvatarStack users={assignees} size={20} interactive />
                  {assignees.length ? assignees.map((a) => a.name).join(", ") : t("createIssue.unassigned")}
                </span>
              </LockedField>
            )}
          </Field>

          <div className="flex flex-wrap gap-2.5">
            <div className="min-w-[104px] flex-1">
              <Field label={t("field.priority")}>
                {editOk ? (
                <Dropdown
                  width={220}
                  button={(open) => (
                    <button
                      className={`flex w-full items-center gap-1.5 rounded-lg border bg-panel px-2 py-1.5 text-[12.5px] text-ink shadow-e1 transition-colors hover:border-line2 ${open ? "border-accent" : "border-line"}`}
                    >
                      <PriorityIcon p={issue.priorityId} size={13} />
                      <span className="min-w-0 flex-1 truncate text-left">{t(`priority.${issue.priorityId}`)}</span>
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      {PRIORITY_ORDER.map((p: PriorityId) => (
                        <MenuItem key={p} onClick={() => { updateIssue(issue.id, { priorityId: p }); close(); }}>
                          <PriorityIcon p={p} size={14} /> {t(`priority.${p}`)} {issue.priorityId === p && <IcCheck size={12} className="ml-auto text-accent" />}
                        </MenuItem>
                      ))}
                    </>
                  )}
                </Dropdown>
                ) : (
                  <LockedField reason={denyMsg}>
                    <span className="flex items-center gap-2"><PriorityIcon p={issue.priorityId} size={14} /> {t(`priority.${issue.priorityId}`)}</span>
                  </LockedField>
                )}
              </Field>
            </div>
            <div className="min-w-[116px] flex-1">
              <Field label={t("field.dueDate")}>
                {editOk ? (
                  <input
                    type="date"
                    value={issue.dueDate ?? ""}
                    onChange={(e) => updateIssue(issue.id, { dueDate: e.target.value || null })}
                    className={`w-full rounded-md border bg-panel px-1.5 py-1.5 text-[12px] font-medium outline-none transition-colors focus:border-accent focus:shadow-focus ${
                      overdue ? "border-danger text-danger" : "border-line text-ink"
                    }`}
                  />
                ) : (
                  <LockedField reason={denyMsg}>
                    <span className={`flex items-center gap-1.5 ${overdue ? "font-semibold text-danger" : ""}`}>
                      <IcCalendar size={12} />
                      {issue.dueDate ? fmtDate(issue.dueDate, lang) : "—"}
                    </span>
                  </LockedField>
                )}
              </Field>
            </div>
            <div className="min-w-[104px] flex-1">
              <Field label={t("field.complexity")}>
                {editOk ? (
                <Dropdown
                  width={180}
                  button={(open) => (
                    <button
                      className={`flex w-full items-center gap-1.5 rounded-lg border bg-panel px-2 py-1.5 text-[12.5px] text-ink shadow-e1 transition-colors hover:border-line2 ${open ? "border-accent" : "border-line"}`}
                    >
                      <span className="min-w-0 flex-1 truncate text-left">
                        {issue.complexity ? t(`complexity.${issue.complexity}`) : t("complexity.none")}
                      </span>
                      <IcChevD size={12} className="shrink-0 text-faint" />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem onClick={() => { updateIssue(issue.id, { complexity: null }); close(); }}>
                        {t("complexity.none")} {issue.complexity === null && <IcCheck size={12} className="ml-auto text-accent" />}
                      </MenuItem>
                      {COMPLEXITY_ORDER.map((c: ComplexityId) => (
                        <MenuItem key={c} onClick={() => { updateIssue(issue.id, { complexity: c }); close(); }}>
                          {t(`complexity.${c}`)} {issue.complexity === c && <IcCheck size={12} className="ml-auto text-accent" />}
                        </MenuItem>
                      ))}
                    </>
                  )}
                </Dropdown>
                ) : (
                  <LockedField reason={denyMsg}>
                    <span>{issue.complexity ? t(`complexity.${issue.complexity}`) : t("complexity.none")}</span>
                  </LockedField>
                )}
              </Field>
            </div>
          </div>

          {!isDirection && (
            <Field label={t("field.direction")}>
              {editOk ? (
              <Dropdown
                width={300}
                button={(open) => (
                  <button className={`${selectCls} ${open ? "border-accent" : ""}`}>
                    {epic ? (
                      <>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: epic.color }} />
                        <span className="truncate">{epic.title}</span>
                      </>
                    ) : (
                      <span className="text-faint">{t("createIssue.noDirection")}</span>
                    )}
                    <IcChevD size={12} className="ml-auto shrink-0 text-faint" />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem onClick={() => { updateIssue(issue.id, { epicId: null }); close(); }}>{t("createIssue.noDirection")}</MenuItem>
                    <div className="mt-1 border-t border-linesoft pt-1.5">
                      {/* Кандидаты в «направление» ищутся на сервере: любая другая активная
                          задача проекта, а не плоский список всех задач (PERF-06). */}
                      <IssueSearchBox
                        autoFocus
                        ariaLabel={t("issue.searchDirection")}
                        excludeIds={[issue.id]}
                        onPick={(e) => { updateIssue(issue.id, { epicId: e.id }); close(); }}
                      />
                    </div>
                  </>
                )}
              </Dropdown>
              ) : (
                <LockedField reason={denyMsg}>
                  {epic ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: epic.color }} />
                      {epic.title}
                    </span>
                  ) : (
                    <span className="text-faint">{t("createIssue.noDirection")}</span>
                  )}
                </LockedField>
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
                        className="h-6 w-6 shrink-0 rounded-md transition-transform hover:scale-110"
                        style={{
                          background: c,
                          boxShadow: issue.color === c ? `0 0 0 2px var(--c-panel), 0 0 0 4px ${c}` : undefined,
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: issue.color ?? "var(--c-faint)" }} />
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
                        min={0}
                        max={52}
                        value={issue.tStart ?? 0}
                        onChange={(e) => updateIssue(issue.id, { tStart: Math.max(0, Math.min(52, Number(e.target.value))) })}
                        className="w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] font-medium text-ink outline-none transition-colors focus:border-accent focus:shadow-focus"
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
                        min={1}
                        max={52}
                        value={issue.tSpan ?? 3}
                        onChange={(e) => updateIssue(issue.id, { tSpan: Math.max(1, Math.min(52, Number(e.target.value))) })}
                        className="w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] font-medium text-ink outline-none transition-colors focus:border-accent focus:shadow-focus"
                      />
                    ) : (
                      <span>{issue.tSpan ?? 3}</span>
                    )}
                  </Field>
                </div>
              </div>
              <p className="text-[10.5px] leading-snug text-faint">{t("issue.timelinePositionHint")}</p>
            </div>
          )}

          <div className="space-y-3 border-t border-linesoft pt-3.5">
            <Field label={t("field.labels")}>
              <div className="flex flex-wrap gap-1.5">
                {issue.labels.map((l) => (
                  <Chip key={l} text={l} onRemove={editOk ? () => updateIssue(issue.id, { labels: issue.labels.filter((x) => x !== l) }) : undefined} />
                ))}
                {editOk && (
                  <input
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addLabel();
                      }
                    }}
                    placeholder={t("issue.labelPlaceholder")}
                    className="w-20 rounded border border-dashed border-line2 bg-transparent px-1.5 py-0.5 text-[11.5px] outline-none focus:border-accent focus:shadow-focus"
                  />
                )}
                {issue.labels.length === 0 && !editOk && <span className="text-[12px] text-faint">{t("issue.noLabels")}</span>}
              </div>
            </Field>

            <SubtasksField issue={issue} />

            <ChecklistField issue={issue} />

            <CustomFieldsSection issue={issue} />

            <LinksField issue={issue} />

            <CollaboratorField issue={issue} />

            <AttachmentField issue={issue} />
          </div>

          <div className="space-y-1.5 border-t border-linesoft pt-3.5 text-[12px] text-faint">
            <p className="flex justify-between gap-2"><span>{t("issue.reporter")}</span><span className="font-semibold text-sub">{reporter?.name}</span></p>
            <p className="flex justify-between gap-2"><span>{t("issue.created")}</span><span>{relTime(issue.createdAt, lang)}</span></p>
            <p className="flex justify-between gap-2"><span>{t("issue.updated")}</span><span>{relTime(issue.updatedAt, lang)}</span></p>
          </div>
        </aside>
      </div>
    </>
  );

  // Полная страница (ADR-0013 §3): та же карточка внутри листа, вместо представления.
  if (page)
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[1180px]">{content}</div>
      </div>
    );
  return (
    <Modal variant="panel" onClose={() => openIssue(null)} w={980} title={t("issueModal.title", { key: issue.key, title: issue.title })}>
      {content}
    </Modal>
  );
}

function EditableTitle({ issue, readOnly = false }: { issue: Issue; readOnly?: boolean }) {
  const { t } = useT();
  const { updateIssue } = useStore();
  const [draft, setDraft] = useState(issue.title);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(issue.title), [issue.title, issue.id]);

  if (readOnly) return <h2 className="px-0 py-1 text-[22px] font-bold leading-snug tracking-[-0.03em] text-ink">{issue.title}</h2>;

  if (editing)
    return (
      <textarea
        autoFocus
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
            setDraft(issue.title);
            setEditing(false);
          }
        }}
        className="w-full resize-none rounded-md border border-accent bg-panel p-2 text-[22px] font-bold leading-snug tracking-[-0.03em] text-ink outline-none ring-2 ring-accent/15"
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
        className="group block cursor-text rounded-md px-2 py-1 text-[22px] font-bold leading-snug tracking-[-0.03em] text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {issue.title}
        <IcPencil size={13} className="ml-2 inline text-faint opacity-0 transition-opacity group-focus-visible:opacity-100 group-hover:opacity-100" />
      </span>
    </h2>
  );
}
