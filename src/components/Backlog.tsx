import { useMemo, useState } from "react";
import { fmtDate, useStore } from "../store";
import type { Issue } from "../types";
import { ISSUE_TYPES, PRIORITY_ORDER, TYPE_ORDER } from "../types";
import { IcChevD, IcDots, IcFilter, IcInbox, IcSearch, IcTrash, IcX, PriorityIcon, TypeIcon } from "../icons";
import { Avatar, Chip, Dropdown, Empty, Lozenge, MenuItem } from "../ui";

type SortKey = "priority" | "due" | "updated" | "key";
const SORT_LABEL: Record<SortKey, string> = {
  priority: "Приоритет",
  due: "Срок",
  updated: "Обновление",
  key: "Ключ",
};

const keyNum = (key: string) => {
  const n = parseInt(key.slice(key.lastIndexOf("-") + 1), 10);
  return Number.isFinite(n) ? n : 0;
};

const today = () => new Date().toISOString().slice(0, 10);
const isOverdue = (i: Issue, doneIds: Set<string>) =>
  !!i.dueDate && !doneIds.has(i.statusId) && i.dueDate < today();

const selectCls =
  "h-8 rounded-md border border-line bg-panel px-2 text-[12.5px] text-ink outline-none transition-shadow focus:border-accent focus:ring-2 focus:ring-accent/15";

function Row({ issue }: { issue: Issue }) {
  const { data, openIssue, deleteIssue, can } = useStore();
  const assignee = data.users.find((u) => u.id === issue.assigneeId);
  const epic = data.issues.find((i) => i.id === issue.epicId);
  const status = data.workflow.statuses.find((s) => s.id === issue.statusId);

  return (
    <div
      onClick={() => openIssue(issue.id)}
      className="group flex cursor-pointer items-center gap-2.5 border-b border-linesoft bg-panel px-3 py-2 transition-colors last:border-0 hover:bg-accentsoft/50"
    >
      <TypeIcon type={issue.typeId} size={14} />
      <span className="w-14 shrink-0 font-mono text-[11px] font-semibold text-faint">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{issue.title}</span>
      {epic && (
        <span
          className="hidden items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10.5px] font-semibold lg:inline-flex"
          style={{ background: `${epic.color}1a`, color: epic.color ?? undefined }}
        >
          <span className="h-1.5 w-1.5 rounded-sm" style={{ background: epic.color ?? undefined }} />
          <span className="max-w-[110px] truncate">{epic.title}</span>
        </span>
      )}
      <span className="hidden gap-1 xl:flex">
        {issue.labels.slice(0, 2).map((l) => (
          <Chip key={l} text={l} />
        ))}
      </span>
      {issue.dueDate && (
        <span className="hidden shrink-0 font-mono text-[10.5px] text-faint md:inline">{fmtDate(issue.dueDate)}</span>
      )}
      {status && (
        <span className="hidden shrink-0 sm:inline">
          <Lozenge status={status} size="sm" />
        </span>
      )}
      <PriorityIcon p={issue.priorityId} size={14} />
      <Avatar user={assignee ?? null} size={22} />
      <div onClick={(e) => e.stopPropagation()}>
        <Dropdown
          align="right"
          width={190}
          button={() => (
            <button
              className="flex h-6 w-6 items-center justify-center rounded text-faint opacity-0 transition-all hover:bg-todosoft hover:text-ink group-hover:opacity-100"
              aria-label="Действия"
            >
              <IcDots size={14} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem onClick={() => { openIssue(issue.id); close(); }}>Открыть задачу</MenuItem>
              {can("delete") && (
                <>
                  <div className="my-1 border-t border-linesoft" />
                  <MenuItem danger onClick={() => { deleteIssue(issue.id); close(); }}>
                    <IcTrash size={13} /> Удалить
                  </MenuItem>
                </>
              )}
            </>
          )}
        </Dropdown>
      </div>
    </div>
  );
}

export default function Backlog() {
  const { data } = useStore();
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fAssignee, setFAssignee] = useState(""); // "" | "none" | userId
  const [fType, setFType] = useState("");
  const [fOverdue, setFOverdue] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const doneIds = useMemo(
    () => new Set(data.workflow.statuses.filter((s) => s.category === "done").map((s) => s.id)),
    [data.workflow.statuses],
  );

  const pickSort = (k: SortKey) => {
    setSortKey(k);
    setSortDir(k === "updated" ? "desc" : "asc");
  };

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const filtered = data.issues.filter((i) => {
      if (fStatus && i.statusId !== fStatus) return false;
      if (fAssignee === "none" ? i.assigneeId !== null : fAssignee ? i.assigneeId !== fAssignee : false) return false;
      if (fType && i.typeId !== fType) return false;
      if (s && !i.title.toLowerCase().includes(s) && !i.key.toLowerCase().includes(s)) return false;
      if (fOverdue && !isOverdue(i, doneIds)) return false;
      return true;
    });
    const cmp: Record<SortKey, (a: Issue, b: Issue) => number> = {
      priority: (a, b) => PRIORITY_ORDER.indexOf(a.priorityId) - PRIORITY_ORDER.indexOf(b.priorityId),
      due: (a, b) => (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99"),
      updated: (a, b) => a.updatedAt - b.updatedAt,
      key: (a, b) => keyNum(a.key) - keyNum(b.key),
    };
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => cmp[sortKey](a, b) * dir || keyNum(a.key) - keyNum(b.key));
  }, [data.issues, q, fStatus, fAssignee, fType, fOverdue, sortKey, sortDir, doneIds]);

  const filterActive = !!(q || fStatus || fAssignee || fType || fOverdue);
  const resetFilters = () => {
    setQ("");
    setFStatus("");
    setFAssignee("");
    setFType("");
    setFOverdue(false);
  };

  return (
    <div className="flex h-full flex-col">
      {/* шапка */}
      <div className="border-b border-line bg-panel/70 px-6 py-3.5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-2">
            <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">Список задач</h1>
            <p className="mt-0.5 text-[11.5px] text-faint">
              {rows.length} из {data.issues.length} задач
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-panel px-2.5">
              <IcSearch size={13} className="text-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск по названию или ключу"
                className="w-44 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
              />
              {q && (
                <button onClick={() => setQ("")} className="text-faint hover:text-ink" aria-label="Очистить">
                  <IcX size={12} />
                </button>
              )}
            </div>

            {/* сортировка */}
            <Dropdown
              align="right"
              width={180}
              button={(open) => (
                <button className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium ${open ? "border-accent" : "border-line"} bg-panel text-sub`}>
                  <IcFilter size={12} className="text-faint" />
                  {SORT_LABEL[sortKey]}
                  <IcChevD size={11} className="text-faint" />
                </button>
              )}
            >
              {(close) => (
                <>
                  {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                    <MenuItem key={k} onClick={() => { pickSort(k); close(); }}>
                      {SORT_LABEL[k]} {k === sortKey && <span className="ml-auto text-[10.5px] text-accent">✓</span>}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
            <button
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              title={sortDir === "asc" ? "По возрастанию" : "По убыванию"}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-panel text-sub hover:text-ink"
              aria-label="Направление сортировки"
            >
              <IcChevD size={13} className={sortDir === "asc" ? "rotate-180" : ""} />
            </button>
          </div>
        </div>

        {/* фильтры */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${selectCls} cursor-pointer`}>
            <option value="">Все статусы</option>
            {data.workflow.statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} className={`${selectCls} cursor-pointer`}>
            <option value="">Любой исполнитель</option>
            <option value="none">Без исполнителя</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <select value={fType} onChange={(e) => setFType(e.target.value)} className={`${selectCls} cursor-pointer`}>
            <option value="">Все типы</option>
            {TYPE_ORDER.map((t) => (
              <option key={t} value={t}>{ISSUE_TYPES[t].name}</option>
            ))}
          </select>
          <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 text-[12.5px] font-medium text-sub">
            <input type="checkbox" checked={fOverdue} onChange={(e) => setFOverdue(e.target.checked)} />
            Просроченные
          </label>
          {filterActive && (
            <button onClick={resetFilters} className="flex h-8 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-faint hover:text-ink">
              <IcX size={11} /> Сбросить
            </button>
          )}
        </div>
      </div>

      {/* список */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1060px] px-6 py-5">
          {rows.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
              {rows.map((i) => (
                <Row key={i.id} issue={i} />
              ))}
            </div>
          ) : (
            <Empty
              icon={<IcInbox size={22} />}
              title={filterActive ? "Ничего не найдено" : "Задач пока нет"}
              sub={filterActive ? "Измените или сбросьте фильтры" : "Создайте задачу кнопкой «Создать» в шапке"}
            />
          )}
        </div>
      </div>
    </div>
  );
}
