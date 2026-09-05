import { useEffect, useMemo, useState } from "react";
import { canTransition, relTime, useStore } from "../store";
import { denialReason } from "../permissions";
import { LIMITS } from "../validation";
import type { Issue, PriorityId } from "../types";
import { PRIORITY_ORDER, PRIORITIES, ISSUE_TYPES } from "../types";
import { IcCheck, IcChevD, IcEye, IcLink, IcLock, IcPencil, IcSend, IcTrash, IcX, PriorityIcon, TypeIcon } from "../icons";
import { Avatar, Chip, Dropdown, LockedField, Lozenge, MenuItem, Modal } from "../ui";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-faint">{label}</p>
      {children}
    </div>
  );
}

const selectCls = "flex w-full items-center gap-2 rounded-md border border-line bg-white px-2.5 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-accent";

export default function IssueModal() {
  const { data, ui, openIssue, updateIssue, moveStatus, addComment, deleteIssue, toast, can } = useStore();
  const issue = data.issues.find((i) => i.id === ui.selectedIssueId);
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [comment, setComment] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [ptsDraft, setPtsDraft] = useState("");

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
  const epics = data.issues.filter((i) => i.typeId === "epic");

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
    const url = `${location.origin}/#/issue/${issue.key}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("success", `Ссылка на ${issue.key} скопирована`);
    } catch {
      toast("info", url);
    }
  };

  return (
    <Modal onClose={() => openIssue(null)} w={920}>
      {/* шапка */}
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3">
        <TypeIcon type={issue.typeId} size={16} />
        <span className="font-mono text-[12.5px] font-bold text-ink">{issue.key}</span>
        <span className="rounded bg-[#e8edf4] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sub">{ISSUE_TYPES[issue.typeId].name}</span>
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

      <div className="grid grid-cols-[1fr_248px] gap-0">
        {/* основная колонка */}
        <div className="min-w-0 px-5 py-4">
          <EditableTitle issue={issue} readOnly={!editOk} />

          {/* описание */}
          <div className="mt-4">
            <div className="mb-1.5 flex items-center gap-2">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-faint">Описание</p>
              {!editingDesc && editOk && (
                <button onClick={() => { setDescDraft(issue.description); setEditingDesc(true); }} className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline">
                  <IcPencil size={11} /> Редактировать
                </button>
              )}
            </div>
            {editingDesc ? (
              <div className="anim-fadeup">
                <textarea
                  autoFocus
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  rows={5}
                  placeholder="Добавьте описание…"
                  className="w-full resize-y rounded-md border border-accent bg-white p-2.5 text-[13px] leading-relaxed outline-none ring-2 ring-accent/15"
                />
                <div className="mt-1.5 flex gap-1.5">
                  <button onClick={saveDesc} className="rounded bg-accent px-3 py-1 text-[12px] font-semibold text-white hover:bg-accentdeep">Сохранить</button>
                  <button onClick={() => setEditingDesc(false)} className="rounded px-3 py-1 text-[12px] font-semibold text-sub hover:bg-canvas">Отмена</button>
                </div>
              </div>
            ) : issue.description ? (
              <p className="whitespace-pre-wrap rounded-md bg-canvas/70 p-3 text-[13px] leading-relaxed text-sub">{issue.description}</p>
            ) : editOk ? (
              <button onClick={() => { setDescDraft(""); setEditingDesc(true); }} className="w-full rounded-md border border-dashed border-[#c3ccda] px-3 py-3 text-left text-[12.5px] text-faint transition-colors hover:border-accent hover:text-accent">
                + Добавить описание
              </button>
            ) : (
              <p className="rounded-md border border-dashed border-[#c3ccda] px-3 py-3 text-[12.5px] text-faint">Описание не заполнено</p>
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
                    className="w-full resize-y rounded-md border border-line bg-white p-2.5 text-[13px] outline-none transition-shadow placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/15"
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
                <p className="flex items-center gap-2 rounded-md border border-dashed border-[#c3ccda] bg-canvas/50 px-3 py-2.5 text-[12px] text-faint">
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
                      <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-sub">{c.body}</p>
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
                    <span className="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-white">
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
        <aside className="space-y-4 border-l border-line bg-canvas/50 px-4 py-4">
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
              button={(open) => (
                <button className={`${selectCls} justify-between ${open ? "border-accent" : ""}`}>
                  <Lozenge status={status} size="sm" />
                  <IcChevD size={12} className="text-faint" />
                </button>
              )}
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
              <LockedField reason={denyMsg}><Lozenge status={status} size="sm" /></LockedField>
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

          <Field label="Приоритет">
            {editOk ? (
            <Dropdown
              width={220}
              button={(open) => (
                <button className={`${selectCls} ${open ? "border-accent" : ""}`}>
                  <PriorityIcon p={issue.priorityId} size={14} /> {PRIORITIES[issue.priorityId].name}
                  <IcChevD size={12} className="ml-auto text-faint" />
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

          {issue.typeId !== "epic" && (
            <Field label="Эпик">
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
                      <span className="text-faint">Без эпика</span>
                    )}
                    <IcChevD size={12} className="ml-auto shrink-0 text-faint" />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem onClick={() => { updateIssue(issue.id, { epicId: null }); close(); }}>Без эпика</MenuItem>
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
                    <span className="text-faint">Без эпика</span>
                  )}
                </LockedField>
              )}
            </Field>
          )}

          <Field label="Спринт">
            {editOk ? (
            <Dropdown
              width={220}
              button={(open) => (
                <button className={`${selectCls} ${open ? "border-accent" : ""}`}>
                  <span className={issue.sprintId ? "" : "text-faint"}>{data.sprints.find((s) => s.id === issue.sprintId)?.name ?? "Бэклог"}</span>
                  <IcChevD size={12} className="ml-auto text-faint" />
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem onClick={() => { updateIssue(issue.id, { sprintId: null }); close(); }}>Бэклог</MenuItem>
                  {data.sprints.filter((s) => s.status !== "completed").map((s) => (
                    <MenuItem key={s.id} onClick={() => { updateIssue(issue.id, { sprintId: s.id }); close(); }}>
                      {s.name} <span className="ml-auto text-[10.5px] text-faint">{s.status === "active" ? "идёт" : "далее"}</span>
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
            ) : (
              <LockedField reason={denyMsg}>
                <span className={issue.sprintId ? "" : "text-faint"}>{data.sprints.find((s) => s.id === issue.sprintId)?.name ?? "Бэклог"}</span>
              </LockedField>
            )}
          </Field>

          <Field label="Оценка (очки)">
            {editOk ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (ptsDraft.trim() === "") return;
                const v = Math.max(0, Number(ptsDraft));
                if (Number.isNaN(v)) return;
                updateIssue(issue.id, { points: v });
                setPtsDraft("");
              }}
              className="flex gap-1.5"
            >
              <input
                value={ptsDraft === "" ? (issue.points ?? "") : ptsDraft}
                onChange={(e) => setPtsDraft(e.target.value)}
                placeholder={issue.points != null ? String(issue.points) : "—"}
                inputMode="numeric"
                className="w-16 rounded-md border border-line bg-white px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-accent"
              />
              <button type="submit" className="rounded-md border border-line bg-white px-2.5 text-[12px] font-semibold text-sub hover:border-accent hover:text-accent">OK</button>
            </form>
            ) : (
              <LockedField reason={denyMsg}>
                <span className="font-mono font-bold">{issue.points != null ? `${issue.points} очков` : "—"}</span>
              </LockedField>
            )}
          </Field>

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
                  className="w-20 rounded border border-dashed border-[#c3ccda] bg-transparent px-1.5 py-0.5 text-[11.5px] outline-none focus:border-accent"
                />
              )}
              {issue.labels.length === 0 && !editOk && <span className="text-[12px] text-faint">нет меток</span>}
            </div>
          </Field>

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
        className="w-full resize-none rounded-md border border-accent bg-white p-2 text-[17px] font-bold leading-snug text-ink outline-none ring-2 ring-accent/15"
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
