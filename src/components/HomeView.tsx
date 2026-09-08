import { useMemo, useState } from "react";
import { useStore } from "../store";
import type { AssignedIssue, ProjectSummary } from "../types";
import { ISSUE_TYPES, PRIORITIES } from "../types";
import { IcChevR, IcInbox, IcSearch, Logo, PriorityIcon, TypeIcon } from "../icons";
import { AppearanceSettings, Avatar, Dropdown, Empty, MenuItem, Toasts, catColor } from "../ui";
import { Bell } from "./Topbar";

const PROJECT_KEY = "taskira.project";
const readLastProject = (): string => {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? "";
  } catch {
    return "";
  }
};

const today = () => new Date().toISOString().slice(0, 10);
const isOverdue = (i: AssignedIssue) => !!i.dueDate && i.statusCategory !== "done" && i.dueDate < today();

const plural = (n: number, forms: [string, string, string]) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
};

function StatCard({ num, label, tone }: { num: number; label: string; tone?: "accent" | "danger" }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <div
        className="font-disp text-[22px] font-bold leading-none"
        style={tone === "accent" ? { color: "var(--c-accent)" } : tone === "danger" ? { color: "var(--c-danger)" } : { color: "var(--c-ink)" }}
      >
        {num}
      </div>
      <div className="mt-1 text-[11px] font-semibold text-faint">{label}</div>
    </div>
  );
}

function TaskRow({ issue, onOpen }: { issue: AssignedIssue; onOpen: () => void }) {
  const c = catColor(issue.statusCategory as "todo" | "inprogress" | "done");
  const overdue = isOverdue(issue);
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-2.5 border-b border-linesoft bg-panel px-3.5 py-2.5 text-left transition-colors last:border-0 hover:bg-accentsoft/50"
    >
      <span className="shrink-0" title={ISSUE_TYPES[issue.typeId]?.name}>
        <TypeIcon type={issue.typeId} size={14} />
      </span>
      <span className="w-14 shrink-0 font-mono text-[10.5px] font-semibold text-faint">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{issue.title}</span>
      {overdue && issue.dueDate && (
        <span className="hidden shrink-0 font-mono text-[10px] font-bold text-danger lg:inline">{issue.dueDate.slice(5)}</span>
      )}
      <span className="hidden shrink-0 text-[10.5px] font-semibold text-faint sm:inline">{issue.projectKey}</span>
      <span
        className="hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide md:inline"
        style={{ background: c.bg, color: c.fg }}
      >
        {issue.statusName}
      </span>
      <span className="shrink-0" title={PRIORITIES[issue.priorityId]?.name}>
        <PriorityIcon p={issue.priorityId} size={13} />
      </span>
    </button>
  );
}

export default function HomeView({ onLogout }: { onLogout: () => void }) {
  const { data, enterProject } = useStore();
  const me = data.users.find((u) => u.id === data.currentUserId) ?? data.users[0];
  const last = readLastProject();
  const [q, setQ] = useState("");

  const overdueCount = useMemo(() => data.assignedToMe.filter(isOverdue).length, [data.assignedToMe]);

  const tasks = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data.assignedToMe;
    return data.assignedToMe.filter(
      (t) => t.key.toLowerCase().includes(s) || t.title.toLowerCase().includes(s) || t.projectName.toLowerCase().includes(s),
    );
  }, [data.assignedToMe, q]);

  const countInProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data.assignedToMe) m.set(t.projectId, (m.get(t.projectId) ?? 0) + 1);
    return m;
  }, [data.assignedToMe]);

  const groups = useMemo(() => {
    const byDept = new Map<string, ProjectSummary[]>();
    for (const p of data.projects) {
      const arr = byDept.get(p.departmentId) ?? [];
      arr.push(p);
      byDept.set(p.departmentId, arr);
    }
    const deptName = (id: string) => data.departments.find((d) => d.id === id)?.name ?? "Без отдела";
    return [...byDept.entries()]
      .map(([deptId, projects]) => ({
        deptId,
        deptName: deptName(deptId),
        projects: [...projects].sort((a, b) => (a.id === last ? -1 : b.id === last ? 1 : a.name.localeCompare(b.name))),
      }))
      .sort((a, b) => a.deptName.localeCompare(b.deptName));
  }, [data.projects, data.departments, last]);

  const openTask = (t: AssignedIssue) => {
    try {
      location.hash = `#/issue/${t.projectId}/${t.issueId}`;
    } catch {
      /* noop */
    }
    enterProject(t.projectId);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      {/* шапка */}
      <header className="flex h-[54px] shrink-0 items-center gap-4 border-b border-line bg-panel px-5">
        <div className="flex items-center gap-2">
          <Logo size={24} />
          <span className="font-disp text-[14px] font-bold text-ink">Taskira</span>
        </div>

        <label className="flex h-8 w-[320px] items-center gap-2 rounded-md border border-line bg-canvas px-2.5">
          <IcSearch size={13} className="shrink-0 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск задач и проектов…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
          />
        </label>

        <div className="ml-auto flex items-center gap-2.5">
          <Bell />
          <div className="ml-1 border-l border-line pl-2.5">
            <Dropdown
              align="right"
              width={280}
              button={(open) => (
                <button
                  className={`flex items-center gap-2 rounded-md border py-1 pl-1.5 pr-2 transition-colors ${
                    open ? "border-accent bg-accentsoft" : "border-line bg-panel hover:border-line2"
                  }`}
                >
                  <Avatar user={me ?? null} size={24} />
                  <span className="hidden text-left sm:block">
                    <span className="block text-[12px] font-semibold leading-tight text-ink">{me?.name?.split(" ")[0] ?? "—"}</span>
                    <span className="block text-[10px] leading-tight text-faint">{me?.role}</span>
                  </span>
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="border-b border-linesoft px-3.5 py-3">
                    <p className="truncate text-[13px] font-bold text-ink">{me?.name ?? "—"}</p>
                    <p className="text-[11px] text-faint">{me?.role}</p>
                  </div>
                  <AppearanceSettings />
                  <MenuItem
                    onClick={() => {
                      onLogout();
                      close();
                    }}
                  >
                    Выйти
                  </MenuItem>
                </>
              )}
            </Dropdown>
          </div>
        </div>
      </header>

      {/* тело */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1160px] min-[1536px]:max-w-[1440px] min-[1920px]:max-w-[1760px] px-7 py-7">
          <h1 className="font-disp text-[20px] font-bold tracking-tight text-ink">Здравствуйте, {me?.name?.split(" ")[0] ?? ""}</h1>
          <p className="mt-0.5 text-[12.5px] text-faint">Вот что у вас в работе прямо сейчас.</p>

          {/* плашки-счётчики */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard num={data.assignedToMe.length} label="Мои задачи" tone="accent" />
            <StatCard num={overdueCount} label="Просрочено" tone="danger" />
            <StatCard num={data.projects.length} label={plural(data.projects.length, ["Проект", "Проекта", "Проектов"])} />
            <StatCard num={data.departments.length} label={plural(data.departments.length, ["Отдел", "Отдела", "Отделов"])} />
          </div>

          {/* две колонки */}
          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.7fr_1fr]">
            {/* Мои задачи */}
            <section>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-[13px] font-bold text-ink">Мои задачи</h2>
                <span className="rounded bg-linesoft px-1.5 py-0.5 font-mono text-[10px] font-bold text-sub">{tasks.length}</span>
              </div>
              {tasks.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-line bg-panel">
                  {tasks.map((t) => (
                    <TaskRow key={t.issueId} issue={t} onOpen={() => openTask(t)} />
                  ))}
                </div>
              ) : (
                <Empty
                  icon={<IcInbox size={22} />}
                  title={q ? "Ничего не найдено" : "Открытых задач на вас нет"}
                  sub={q ? "Измените запрос" : "Задачи, где вы исполнитель, появятся здесь"}
                />
              )}
            </section>

            {/* Проекты */}
            <section>
              <h2 className="mb-2 text-[13px] font-bold text-ink">Проекты</h2>
              <div className="space-y-4">
                {groups.map((g) => (
                  <div key={g.deptId}>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-faint">{g.deptName}</p>
                    <div className="space-y-2">
                      {g.projects.map((p) => {
                        const n = countInProject.get(p.id) ?? 0;
                        return (
                          <button
                            key={p.id}
                            onClick={() => enterProject(p.id)}
                            className="group flex w-full items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2.5 text-left transition-colors hover:border-accent"
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accentsoft font-mono text-[10.5px] font-bold text-accent">
                              {p.key}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-semibold text-ink">{p.name}</span>
                              <span className="block text-[10.5px] text-faint">
                                {p.id === last ? "продолжить" : p.isShared ? "общий проект" : "проект команды"}
                                {n > 0 && ` · ${n} ${plural(n, ["задача", "задачи", "задач"])}`}
                              </span>
                            </span>
                            <IcChevR size={13} className="shrink-0 text-line2 group-hover:text-accent" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
      <Toasts />
    </div>
  );
}
