import { useMemo } from "react";
import { useStore } from "../store";
import type { AssignedIssue, ProjectSummary } from "../types";
import { PRIORITIES } from "../types";
import { IcChevR, IcInbox, Logo, PriorityIcon } from "../icons";
import { Avatar, Empty, Toasts, catColor } from "../ui";
import { Bell } from "./Topbar";

const PROJECT_KEY = "taskira.project";
const readLastProject = (): string => {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? "";
  } catch {
    return "";
  }
};

function TaskRow({ issue, onOpen }: { issue: AssignedIssue; onOpen: () => void }) {
  const c = catColor(issue.statusCategory as "todo" | "inprogress" | "done");
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-3 border-b border-linesoft bg-panel px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-accentsoft/50"
    >
      <span className="w-16 shrink-0 font-mono text-[11px] font-semibold text-faint">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{issue.title}</span>
      <span className="hidden shrink-0 text-[11.5px] text-faint sm:inline">{issue.projectName}</span>
      <span
        className="hidden shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide md:inline-flex"
        style={{ background: c.bg, color: c.fg }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />
        {issue.statusName}
      </span>
      <span className="shrink-0" title={PRIORITIES[issue.priorityId]?.name}>
        <PriorityIcon p={issue.priorityId} size={14} />
      </span>
      <IcChevR size={13} className="shrink-0 text-line2 group-hover:text-faint" />
    </button>
  );
}

export default function HomeView({ onLogout }: { onLogout: () => void }) {
  const { data, enterProject } = useStore();
  const me = data.users.find((u) => u.id === data.currentUserId) ?? data.users[0];
  const last = readLastProject();

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
      <header className="flex h-[54px] shrink-0 items-center gap-3 border-b border-line bg-panel px-5">
        <div className="flex items-center gap-2.5">
          <Logo size={24} />
          <span className="font-disp text-[14px] font-bold text-ink">Taskira</span>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <Bell />
          <div className="ml-1 flex items-center gap-2 border-l border-line pl-3">
            <Avatar user={me ?? null} size={26} />
            <div className="leading-tight">
              <p className="text-[12.5px] font-semibold text-ink">{me?.name ?? "—"}</p>
              <button onClick={onLogout} className="text-[11px] text-faint transition-colors hover:text-danger">
                Выйти
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[880px] px-6 py-8">
          <h1 className="font-disp text-[19px] font-bold tracking-tight text-ink">Здравствуйте, {me?.name ?? ""}</h1>
          <p className="mt-0.5 text-[12.5px] text-faint">Выберите проект или откройте задачу из назначенных вам.</p>

          {/* Мои задачи */}
          <section className="mt-7">
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-[14px] font-bold text-ink">Мои задачи</h2>
              <span className="rounded-full bg-todosoft px-2 py-0.5 font-mono text-[10.5px] font-bold text-sub">
                {data.assignedToMe.length}
              </span>
            </div>
            {data.assignedToMe.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
                {data.assignedToMe.map((t) => (
                  <TaskRow key={t.issueId} issue={t} onOpen={() => openTask(t)} />
                ))}
              </div>
            ) : (
              <Empty icon={<IcInbox size={22} />} title="Открытых задач на вас нет" sub="Задачи, где вы исполнитель, появятся здесь" />
            )}
          </section>

          {/* Недавние проекты */}
          <section className="mt-8 pb-8">
            <h2 className="mb-2 text-[14px] font-bold text-ink">Недавние проекты</h2>
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.deptId}>
                  <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">{g.deptName}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {g.projects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => enterProject(p.id)}
                        className="group flex items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-3 text-left shadow-[0_1px_3px_rgba(20,35,64,0.05)] transition-colors hover:border-accent"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accentsoft font-mono text-[11px] font-bold text-accent">
                          {p.key}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-ink">{p.name}</span>
                          <span className="block text-[11px] text-faint">
                            {p.id === last ? "продолжить" : p.isShared ? "общий проект" : "проект команды"}
                          </span>
                        </span>
                        <IcChevR size={14} className="shrink-0 text-line2 group-hover:text-accent" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      <Toasts />
    </div>
  );
}
