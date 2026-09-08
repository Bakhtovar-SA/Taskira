import { useEffect, useMemo, useRef, useState } from "react";
import { canTransition, fmtDate, relTime, useStore } from "../store";
import { denialReason } from "../permissions";
import { LIMITS } from "../validation";
import { usersApi, type PickableUser } from "../api";
import type { Issue, PriorityId } from "../types";
import { PRIORITY_ORDER, PRIORITIES, ISSUE_TYPES } from "../types";
import { IcCalendar, IcCheck, IcChevD, IcEye, IcLink, IcLock, IcPencil, IcSend, IcTrash, IcX, PriorityIcon, TypeIcon } from "../icons";
import { Avatar, Chip, Dropdown, LockedField, Lozenge, MenuItem, Modal, catColor } from "../ui";

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
      <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-faint">{label}</p>
      {children}
    </div>
  );
}

const selectCls = "flex w-full items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-accent";

/** Приглашённые участники задачи (issue collaborators). Видны всем, кто открыл
 *  карточку; добавляет/убирает — manageCollaborators (admin/manager проекта). */
function CollaboratorField({ issue }: { issue: Issue }) {
  const { data, can, addCollaborator, removeCollaborator } = useStore();
  const canManage = can("manageCollaborators", issue);
  const [pickable, setPickable] = useState<PickableUser[]>([]);
  const [pick, setPick] = useState("");
  const [expand, setExpand] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    let off = false;
    usersApi.pickable().then((u) => !off && setPickable(u)).catch(() => {});
    return () => {
      off = true;
    };
  }, [canManage]);

  const collabs = issue.collaborators;
  if (!canManage && collabs.length === 0) return null;

  // Пустое состояние при праве управлять — одна компактная строка, без секции
  // во всю высоту (ticket-issuemodal-density §4).
  if (collabs.length === 0 && canManage && !expand) {
    return (
      <Field label="Участники задачи">
        <div className="flex items-center justify-between rounded-md border border-dashed border-line px-2.5 py-1.5 text-[11.5px] text-faint">
          <span>Никого не приглашали</span>
          <button onClick={() => setExpand(true)} className="font-bold text-accent hover:underline">+ пригласить</button>
        </div>
      </Field>
    );
  }

  const taken = new Set(collabs.map((c) => c.userId));
  const isResourceAdmin = (id: string) => data.users.some((u) => u.id === id && u.globalRole === "admin");
  // Кандидаты: активные, ещё не приглашены, не участники проекта (и так видят),
  // не админы ресурса, не ты сам.
  const candidates = pickable.filter(
    (u) => !taken.has(u.id) && !(u.id in data.members) && !isResourceAdmin(u.id) && u.id !== data.currentUserId,
  );

  return (
    <Field label="Участники задачи">
      <div className="flex flex-wrap gap-1.5">
        {collabs.map((c) => (
          <span
            key={c.userId}
            className="flex items-center gap-1.5 rounded-full bg-linesoft py-0.5 pl-1 pr-2 text-[11.5px] text-ink"
          >
            <span
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[7.5px] font-bold text-white"
              style={{ background: c.color }}
            >
              {c.initials}
            </span>
            {c.name}
            {canManage && (
              <button
                onClick={() => removeCollaborator(issue.id, c.userId)}
                className="ml-0.5 text-faint transition-colors hover:text-danger"
                title="Отключить от задачи"
              >
                <IcX size={10} />
              </button>
            )}
          </span>
        ))}
        {/* достижимо при canManage && expand (пустой развёрнутый инвайт) */}
        {collabs.length === 0 && <span className="text-[12px] text-faint">никого не приглашали</span>}
      </div>
      {canManage && (
        <>
          <div className="mt-1.5 flex items-center gap-1.5">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              disabled={candidates.length === 0}
              className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-sub focus:border-accent focus:outline-none disabled:opacity-50"
            >
              <option value="">{candidates.length ? "— пригласить человека —" : "нет кандидатов"}</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.jobRole ? `${u.name} · ${u.jobRole}` : u.name}
                </option>
              ))}
            </select>
            <button
              disabled={!pick}
              onClick={() => {
                addCollaborator(issue.id, pick);
                setPick("");
              }}
              className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Пригласить
            </button>
          </div>
          <p className="mt-1 text-[10px] leading-snug text-faint">
            Видит только эту задачу и её комментарии. В проект и в исполнители не добавляется.
          </p>
        </>
      )}
    </Field>
  );
}

const fmtBytes = (n: number): string => {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
};

/** Вложения задачи (attachments, миграция 010). Список + скачивание видят все, кто
 *  открыл карточку; прикрепляет — право comment; «×» — свой файл или право delete. */
function AttachmentField({ issue }: { issue: Issue }) {
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
      <Field label="Вложения">
        {hiddenInput}
        <div className="flex items-center justify-between rounded-md border border-dashed border-line px-2.5 py-1.5 text-[11.5px] text-faint">
          <span>Файлов нет</span>
          <button onClick={() => fileRef.current?.click()} className="font-bold text-accent hover:underline">+ файл</button>
        </div>
      </Field>
    );
  }

  return (
    <Field label="Вложения">
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
                title={`Скачать «${a.filename}»`}
              >
                {a.filename}
              </button>
              <span className="shrink-0 text-faint">{fmtBytes(a.byteSize)}</span>
              {(canDeleteAny || mine) && (
                <button
                  onClick={() => removeAttachment(issue.id, a.id)}
                  className="shrink-0 text-faint transition-colors hover:text-danger"
                  title="Удалить вложение"
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
            + прикрепить файл
          </button>
          <p className="mt-1 text-[10px] leading-snug text-faint">
            До {Math.round(LIMITS.attachment.maxBytes / 1024 / 1024)} МБ. Исполняемые файлы и скрипты запрещены.
          </p>
        </>
      )}
    </Field>
  );
}

export default function IssueModal() {
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

  const epic = useMemo(() => data.issues.find((i) => i.id === issue?.epicId), [data.issues, issue?.epicId]);
  if (!issue) return null;

  const me = data.users.find((u) => u.id === data.currentUserId)!;
  const assignee = data.users.find((u) => u.id === issue.assigneeId);
  const reporter = data.users.find((u) => u.id === issue.reporterId);
  const status = data.workflow.statuses.find((s) => s.id === issue.statusId)!;
  // Срок горит: дата в прошлом и задача не в финальной категории статуса.
  const overdue = !!issue.dueDate && status.category !== "done" && issue.dueDate < new Date().toISOString().slice(0, 10);
  // Тип "epic" упразднён (миграция 002): «эпик» — задача, на которую ссылаются
  // другие через epicId.
  const epicIds = new Set(data.issues.map((i) => i.epicId).filter(Boolean));
  const epics = data.issues.filter((i) => epicIds.has(i.id));

  /* права доступа: что можно делать с этой задачей */
  const editOk = can("edit", issue);
  const canDelete = can("delete");
  const canComment = can("comment");
  const denyMsg = denialReason(me, "edit", issue);

  const submitComment = () => {
    if (!comment.trim()) return;
    addComment(issue.id, comment);
    setComment("");
  };

  const saveDesc = () => {
    updateIssue(issue.id, { description: descDraft.trim() });
    setEditingDesc(false);
    if (descDraft.trim() !== issue.description) toast("success", "Описание сохранено");
  };

  const addLabel = () => {
    const l = labelInput.trim().toLowerCase();
    if (!l) return;
    if (!issue.labels.includes(l)) updateIssue(issue.id, { labels: [...issue.labels, l] });
    setLabelInput("");
  };

  const copyLink = async () => {
    // uuid-форма — её понимает одиночный режим (SoloView) для приглашённых.
    const url = `${location.origin}/#/issue/${data.currentProjectId}/${issue.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("success", `Ссылка на ${issue.key} скопирована`);
    } catch {
      toast("info", url);
    }
  };

  return (
    <Modal onClose={() => openIssue(null)} w={940}>
      {/* шапка */}
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <span title={ISSUE_TYPES[issue.typeId].name} className="flex items-center">
          <TypeIcon type={issue.typeId} size={16} />
        </span>
        <span className="font-mono text-[12.5px] font-bold text-ink">{issue.key}</span>
        <div className="ml-auto flex items-center gap-1">
          {!editOk && (
            <span className="mr-1 flex items-center gap-1.5 rounded bg-warnsoft px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-warn" title={denyMsg}>
              <IcEye size={11} /> Только чтение
            </span>
          )}
          <button onClick={copyLink} className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-canvas hover:text-ink" title="Скопировать ссылку">
            <IcLink size={15} />
          </button>
          {canDelete &&
            (!confirmDel ? (
              <button onClick={() => setConfirmDel(true)} className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-dangersoft hover:text-danger" title="Удалить">
                <IcTrash size={15} />
              </button>
            ) : (
              <span className="flex items-center gap-1.5 rounded-md bg-dangersoft px-2 py-1">
                <span className="text-[11.5px] font-semibold text-danger">Удалить?</span>
                <button onClick={() => deleteIssue(issue.id)} className="rounded bg-danger px-1.5 py-0.5 text-[11px] font-bold text-white hover:opacity-90">Да</button>
                <button onClick={() => setConfirmDel(false)} className="text-[11px] font-semibold text-sub hover:text-ink">Нет</button>
              </span>
            ))}
          <button onClick={() => openIssue(null)} className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-canvas hover:text-ink" aria-label="Закрыть">
            <IcX size={15} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_264px] gap-0">
        {/* основная колонка */}
        <div className="min-w-0 px-5 py-4">
          <EditableTitle issue={issue} readOnly={!editOk} />

          {/* описание — сам блок кликабелен для входа в редактирование (отдельной
              кнопки «Редактировать» нет, как у EditableTitle) */}
          <div className="mt-4">
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">Описание</p>
            {editingDesc ? (
              <div className="anim-fadeup">
                <textarea
                  autoFocus
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  rows={5}
                  placeholder="Добавьте описание…"
                  className="w-full resize-y rounded-md border border-accent bg-panel p-2.5 text-[13px] leading-relaxed outline-none ring-2 ring-accent/15"
                />
                <div className="mt-1.5 flex gap-1.5">
                  <button onClick={saveDesc} className="rounded bg-accent px-3 py-1 text-[12px] font-semibold text-white hover:bg-accentdeep">Сохранить</button>
                  <button onClick={() => setEditingDesc(false)} className="rounded px-3 py-1 text-[12px] font-semibold text-sub hover:bg-canvas">Отмена</button>
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
                  title="Нажмите, чтобы редактировать"
                  className="group cursor-text whitespace-pre-wrap rounded-md bg-canvas/70 p-3 text-[13px] leading-relaxed text-sub transition-colors hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <MentionText text={issue.description} />
                  <IcPencil size={12} className="ml-1.5 inline align-text-bottom text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              ) : (
                <p className="whitespace-pre-wrap rounded-md bg-canvas/70 p-3 text-[13px] leading-relaxed text-sub"><MentionText text={issue.description} /></p>
              )
            ) : editOk ? (
              <button onClick={() => { setDescDraft(""); setEditingDesc(true); }} className="w-full rounded-md border border-dashed border-line2 px-3 py-3 text-left text-[12.5px] text-faint transition-colors hover:border-accent hover:text-accent">
                + Добавить описание
              </button>
            ) : (
              <p className="rounded-md border border-dashed border-line2 px-3 py-3 text-[12.5px] text-faint">Описание не заполнено</p>
            )}
          </div>

          {/* вкладки */}
          <div className="mt-5 flex items-center gap-1 border-b border-line">
            {([["comments", `Комментарии · ${issue.comments.length}`], ["activity", `История · ${issue.activity.length}`]] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`relative px-3 py-2 text-[12.5px] font-semibold transition-colors ${tab === id ? "text-accent" : "text-faint hover:text-ink"}`}
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
                <Avatar user={me} size={28} />
                <div className="flex-1">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitComment();
                    }}
                    rows={2}
                    maxLength={LIMITS.comment.max}
                    placeholder="Добавить комментарий… (Ctrl+Enter — отправить)"
                    className="w-full resize-y rounded-md border border-line bg-panel p-2.5 text-[13px] outline-none transition-shadow placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/15"
                  />
                  <div className="mt-1.5 flex justify-end">
                    <button
                      onClick={submitComment}
                      disabled={!comment.trim()}
                      className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-all hover:bg-accentdeep disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <IcSend size={12} /> Отправить
                    </button>
                  </div>
                </div>
              </div>
              ) : (
                <p className="flex items-center gap-2 rounded-md border border-dashed border-line2 bg-canvas/50 px-3 py-2.5 text-[12px] text-faint">
                  <IcLock size={13} /> Ваша роль не позволяет оставлять комментарии
                </p>
              )}
              {[...issue.comments].reverse().map((c) => {
                const u = data.users.find((x) => x.id === c.authorId);
                return (
                  <div key={c.id} className="anim-fadeup flex gap-2.5">
                    <Avatar user={u ?? null} size={28} />
                    <div className="min-w-0 flex-1 rounded-lg rounded-tl-none bg-canvas/80 px-3 py-2">
                      <p className="text-[12px]">
                        <b className="font-semibold text-ink">{u?.name}</b> <span className="text-faint">· {relTime(c.ts)}</span>
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-sub"><MentionText text={c.body} /></p>
                    </div>
                  </div>
                );
              })}
              {issue.comments.length === 0 && <p className="py-3 text-center text-[12px] text-faint">Комментариев пока нет — начните обсуждение.</p>}
            </div>
          ) : (
            <div className="mt-4 space-y-0">
              {[...issue.activity].reverse().map((a, idx, arr) => {
                const u = data.users.find((x) => x.id === a.authorId);
                return (
                  <div key={a.id} className="relative flex gap-3 pb-4">
                    {idx < arr.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-line" />}
                    <span className="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-panel">
                      <Avatar user={u ?? null} size={18} />
                    </span>
                    <p className="pt-0.5 text-[12.5px] leading-snug text-sub">
                      <b className="font-semibold text-ink">{u?.name.split(" ")[0]}</b> {a.text}
                      <span className="ml-1.5 text-[11px] text-faint">{relTime(a.ts)}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* правая панель */}
        <aside className="space-y-2.5 border-l border-line bg-canvas/50 px-4 py-4">
          {!editOk && (
            <div className="flex items-start gap-2 rounded-md border border-line bg-warnsoft/50 px-2.5 py-2 text-[11.5px] leading-snug text-warn">
              <IcLock size={13} className="mt-0.5 shrink-0" />
              <span>{denyMsg}</span>
            </div>
          )}
          <Field label="Статус">
            {editOk ? (
            <Dropdown
              width={220}
              button={(open) => {
                const c = catColor(status.category);
                return (
                  <button
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] font-bold uppercase tracking-wide transition-opacity hover:opacity-90 ${open ? "ring-2 ring-accent/40" : ""}`}
                    style={{ background: c.bg, color: c.fg }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />
                    <span className="min-w-0 truncate">{status.name}</span>
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
                        title={allowed ? undefined : "Запрещено схемой рабочего процесса"}
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
                  <p className="border-t border-linesoft px-3 py-1.5 text-[10.5px] leading-snug text-faint">Переходы ограничены схемой в разделе «Рабочий процесс»</p>
                </>
              )}
            </Dropdown>
            ) : (
              (() => {
                const c = catColor(status.category);
                return (
                  <span
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] font-bold uppercase tracking-wide"
                    style={{ background: c.bg, color: c.fg }}
                    title={denyMsg}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />
                    <span className="min-w-0 truncate">{status.name}</span>
                    <IcLock size={11} className="ml-auto shrink-0 opacity-70" />
                  </span>
                );
              })()
            )}
          </Field>

          <Field label="Исполнитель">
            {editOk ? (
            <Dropdown
              width={220}
              button={(open) => (
                <button className={`${selectCls} ${open ? "border-accent" : ""}`}>
                  <Avatar user={assignee ?? null} size={20} />
                  <span className={assignee ? "" : "text-faint"}>{assignee?.name ?? "Не назначен"}</span>
                  <IcChevD size={12} className="ml-auto text-faint" />
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem onClick={() => { updateIssue(issue.id, { assigneeId: null }); close(); }}>
                    <Avatar user={null} size={20} /> Не назначен {issue.assigneeId === null && <IcCheck size={12} className="ml-auto text-accent" />}
                  </MenuItem>
                  {data.users.map((u) => (
                    <MenuItem key={u.id} onClick={() => { updateIssue(issue.id, { assigneeId: u.id }); close(); }}>
                      <Avatar user={u} size={20} /> {u.name} {issue.assigneeId === u.id && <IcCheck size={12} className="ml-auto text-accent" />}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
            ) : (
              <LockedField reason={denyMsg}>
                <span className="flex items-center gap-2"><Avatar user={assignee ?? null} size={20} /> {assignee?.name ?? "Не назначен"}</span>
              </LockedField>
            )}
          </Field>

          <div className="flex flex-wrap gap-2.5">
            <div className="min-w-[104px] flex-1">
              <Field label="Приоритет">
                {editOk ? (
                <Dropdown
                  width={220}
                  button={(open) => (
                    <button
                      className={`flex w-full items-center gap-1.5 rounded-md border bg-panel px-2 py-1.5 text-[12px] font-medium text-ink transition-colors hover:border-accent ${open ? "border-accent" : "border-line"}`}
                    >
                      <PriorityIcon p={issue.priorityId} size={13} />
                      <span className="min-w-0 flex-1 truncate text-left">{PRIORITIES[issue.priorityId].name}</span>
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      {PRIORITY_ORDER.map((p: PriorityId) => (
                        <MenuItem key={p} onClick={() => { updateIssue(issue.id, { priorityId: p }); close(); }}>
                          <PriorityIcon p={p} size={14} /> {PRIORITIES[p].name} {issue.priorityId === p && <IcCheck size={12} className="ml-auto text-accent" />}
                        </MenuItem>
                      ))}
                    </>
                  )}
                </Dropdown>
                ) : (
                  <LockedField reason={denyMsg}>
                    <span className="flex items-center gap-2"><PriorityIcon p={issue.priorityId} size={14} /> {PRIORITIES[issue.priorityId].name}</span>
                  </LockedField>
                )}
              </Field>
            </div>
            <div className="min-w-[116px] flex-1">
              <Field label="Срок">
                {editOk ? (
                  <input
                    type="date"
                    value={issue.dueDate ?? ""}
                    onChange={(e) => updateIssue(issue.id, { dueDate: e.target.value || null })}
                    className={`w-full rounded-md border bg-panel px-1.5 py-1.5 text-[12px] font-medium outline-none transition-colors focus:border-accent ${
                      overdue ? "border-danger text-danger" : "border-line text-ink"
                    }`}
                  />
                ) : (
                  <LockedField reason={denyMsg}>
                    <span className={`flex items-center gap-1.5 ${overdue ? "font-semibold text-danger" : ""}`}>
                      <IcCalendar size={12} />
                      {issue.dueDate ? fmtDate(issue.dueDate) : "—"}
                    </span>
                  </LockedField>
                )}
              </Field>
            </div>
          </div>

          {!epicIds.has(issue.id) && (
            <Field label="Направление">
              {editOk ? (
              <Dropdown
                width={220}
                button={(open) => (
                  <button className={`${selectCls} ${open ? "border-accent" : ""}`}>
                    {epic ? (
                      <>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: epic.color }} />
                        <span className="truncate">{epic.title}</span>
                      </>
                    ) : (
                      <span className="text-faint">Без направления</span>
                    )}
                    <IcChevD size={12} className="ml-auto shrink-0 text-faint" />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem onClick={() => { updateIssue(issue.id, { epicId: null }); close(); }}>Без направления</MenuItem>
                    {epics.map((e) => (
                      <MenuItem key={e.id} onClick={() => { updateIssue(issue.id, { epicId: e.id }); close(); }}>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: e.color }} />
                        <span className="truncate">{e.title}</span>
                      </MenuItem>
                    ))}
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
                    <span className="text-faint">Без направления</span>
                  )}
                </LockedField>
              )}
            </Field>
          )}

          <div className="space-y-2.5 border-t border-line pt-3.5">
            <Field label="Метки">
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
                    placeholder="+ метка"
                    className="w-20 rounded border border-dashed border-line2 bg-transparent px-1.5 py-0.5 text-[11.5px] outline-none focus:border-accent"
                  />
                )}
                {issue.labels.length === 0 && !editOk && <span className="text-[12px] text-faint">нет меток</span>}
              </div>
            </Field>

            <CollaboratorField issue={issue} />

            <AttachmentField issue={issue} />
          </div>

          <div className="space-y-1.5 border-t border-line pt-3.5 text-[11.5px] text-faint">
            <p className="flex justify-between gap-2"><span>Автор</span><span className="font-semibold text-sub">{reporter?.name}</span></p>
            <p className="flex justify-between gap-2"><span>Создана</span><span>{relTime(issue.createdAt)}</span></p>
            <p className="flex justify-between gap-2"><span>Обновлена</span><span>{relTime(issue.updatedAt)}</span></p>
          </div>
        </aside>
      </div>
    </Modal>
  );
}

function EditableTitle({ issue, readOnly = false }: { issue: Issue; readOnly?: boolean }) {
  const { updateIssue } = useStore();
  const [draft, setDraft] = useState(issue.title);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(issue.title), [issue.title, issue.id]);

  if (readOnly) return <h2 className="px-0 py-1 text-[17px] font-bold leading-snug text-ink">{issue.title}</h2>;

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
        className="w-full resize-none rounded-md border border-accent bg-panel p-2 text-[17px] font-bold leading-snug text-ink outline-none ring-2 ring-accent/15"
      />
    );
  return (
    <h2
      onClick={() => setEditing(true)}
      title="Нажмите, чтобы переименовать"
      className="group -mx-2 cursor-text rounded-md px-2 py-1 text-[17px] font-bold leading-snug text-ink transition-colors hover:bg-canvas"
    >
      {issue.title}
      <IcPencil size={13} className="ml-2 inline text-faint opacity-0 transition-opacity group-hover:opacity-100" />
    </h2>
  );
}
