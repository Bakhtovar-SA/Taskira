import { useState } from "react";
import { useStore } from "../store";
import type { IssueTypeId, PriorityId } from "../types";
import { ISSUE_TYPES, PRIORITY_ORDER, PRIORITIES, TYPE_ORDER } from "../types";
import { IcChevD, IcX, TypeIcon } from "../icons";
import { Avatar, Dropdown, Modal, Chip } from "../ui";
import { IcCheck, PriorityIcon } from "../icons";
import { LIMITS } from "../validation";

const inputCls = "w-full rounded-md border border-line bg-panel px-3 py-2 text-[13px] outline-none transition-shadow placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/15";

export default function CreateIssueModal() {
  const { data, setCreateOpen, createIssue } = useStore();
  const [typeId, setTypeId] = useState<IssueTypeId>("task");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [description, setDescription] = useState("");
  const [priorityId, setPriorityId] = useState<PriorityId>("medium");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [epicId, setEpicId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [labelDraft, setLabelDraft] = useState("");
  const [again, setAgain] = useState(false);

  // Тип "epic" упразднён (миграция 002): «эпик» — обычная задача, на которую
  // ссылаются через epicId. Список «эпиков» = задачи, у которых есть дети.
  const epicIds = new Set(data.issues.map((i) => i.epicId).filter(Boolean));
  const epics = data.issues.filter((i) => epicIds.has(i.id));
  const assignee = data.users.find((u) => u.id === assigneeId);

  const addLabel = () => {
    const l = labelDraft.trim().toLowerCase();
    if (l && !labels.includes(l)) setLabels((p) => [...p, l]);
    setLabelDraft("");
  };

  const submit = () => {
    if (!title.trim()) {
      setError("Укажите название — без него задачу создать нельзя");
      return;
    }
    createIssue({
      title,
      description,
      typeId,
      priorityId,
      assigneeId,
      epicId,
      labels,
      points: null,
      dueDate: dueDate || null,
    });
    if (again) {
      setTitle("");
      setDescription("");
      setError("");
      setDueDate("");
      setLabels([]);
    } else {
      setCreateOpen(false);
    }
  };

  return (
    <Modal onClose={() => setCreateOpen(false)} w={620}>
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <span className="font-disp text-[14px] font-bold text-ink">Новая задача</span>
        <span className="rounded bg-linesoft px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-sub">{data.project.key}-{data.seq}</span>
        <button onClick={() => setCreateOpen(false)} className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-canvas hover:text-ink" aria-label="Закрыть">
          <IcX size={15} />
        </button>
      </div>

      <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
        {/* тип */}
        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">Тип задачи</p>
          <div className="flex gap-1.5">
            {TYPE_ORDER.map((t) => (
              <button
                key={t}
                onClick={() => setTypeId(t)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-2 py-2 text-[12.5px] font-semibold transition-all ${
                  typeId === t ? "border-accent bg-accentsoft text-accent shadow-[0_0_0_2px_rgba(11,95,217,0.15)]" : "border-line bg-panel text-sub hover:border-line2"
                }`}
              >
                <TypeIcon type={t} size={14} /> {ISSUE_TYPES[t].name}
              </button>
            ))}
          </div>
        </div>

        {/* название */}
        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">Название *</p>
          <input
            autoFocus
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Например: Экран восстановления пароля"
            maxLength={LIMITS.title.max}
            className={`${inputCls} ${error ? "border-danger ring-2 ring-danger/15" : ""}`}
          />
          {error && <p className="mt-1 text-[11.5px] font-semibold text-danger">{error}</p>}
        </div>

        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">Описание</p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={LIMITS.description.max}
            placeholder="Что нужно сделать и критерии готовности…"
            className={`${inputCls} resize-y`}
          />
          {description.length > LIMITS.description.max * 0.8 && (
            <p className="mt-1 text-right font-mono text-[10.5px] text-faint">{description.length} / {LIMITS.description.max}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">Приоритет</p>
            <Dropdown
              width={220}
              button={(open) => (
                <button className={`flex w-full items-center gap-2 rounded-md border bg-panel px-3 py-2 text-[13px] font-medium ${open ? "border-accent" : "border-line"}`}>
                  <PriorityIcon p={priorityId} size={14} /> {PRIORITIES[priorityId].name}
                  <IcChevD size={12} className="ml-auto text-faint" />
                </button>
              )}
            >
              {(close) => (
                <>
                  {PRIORITY_ORDER.map((p) => (
                    <button key={p} onClick={() => { setPriorityId(p); close(); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-accentsoft">
                      <PriorityIcon p={p} size={14} /> {PRIORITIES[p].name} {p === priorityId && <IcCheck size={12} className="ml-auto text-accent" />}
                    </button>
                  ))}
                </>
              )}
            </Dropdown>
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">Исполнитель</p>
            <Dropdown
              width={220}
              button={(open) => (
                <button className={`flex w-full items-center gap-2 rounded-md border bg-panel px-3 py-2 text-[13px] font-medium ${open ? "border-accent" : "border-line"}`}>
                  <Avatar user={assignee ?? null} size={18} />
                  <span className={assignee ? "" : "text-faint"}>{assignee?.name ?? "Не назначен"}</span>
                  <IcChevD size={12} className="ml-auto text-faint" />
                </button>
              )}
            >
              {(close) => (
                <>
                  <button onClick={() => { setAssigneeId(null); close(); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-accentsoft">
                    <Avatar user={null} size={18} /> Не назначен {!assigneeId && <IcCheck size={12} className="ml-auto text-accent" />}
                  </button>
                  {data.users
                    .filter((u) => u.id in data.members)
                    .map((u) => (
                      <button key={u.id} onClick={() => { setAssigneeId(u.id); close(); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-accentsoft">
                        <Avatar user={u} size={18} /> {u.name} {assigneeId === u.id && <IcCheck size={12} className="ml-auto text-accent" />}
                      </button>
                    ))}
                </>
              )}
            </Dropdown>
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">Направление</p>
            <select value={epicId ?? ""} onChange={(e) => setEpicId(e.target.value || null)} className={`${inputCls} cursor-pointer`}>
              <option value="">Без направления</option>
              {epics.map((e) => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </select>
            {epics.length === 0 && (
              <p className="mt-1 text-[10.5px] leading-snug text-faint">
                Направлений пока нет — любая задача становится направлением, как только другая
                сошлётся на неё здесь.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">Срок</p>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${inputCls} cursor-pointer`} />
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">Метки</p>
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
                placeholder="+ Enter"
                className="min-w-[70px] flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-line px-5 py-3.5">
        <button onClick={submit} className="rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(11,95,217,0.3)] transition-all hover:bg-accentdeep active:scale-[0.97]">
          Создать задачу
        </button>
        <button onClick={() => setCreateOpen(false)} className="rounded-md px-3 py-2 text-[13px] font-semibold text-sub hover:bg-canvas">
          Отмена
        </button>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12px] text-sub">
          <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          создать ещё одну следом
        </label>
      </div>
    </Modal>
  );
}
