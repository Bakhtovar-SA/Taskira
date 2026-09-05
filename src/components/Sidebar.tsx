import { useStore } from "../store";
import type { ViewId } from "../types";
import { IcBacklog, IcBoard, IcFlow, IcTimeline, IcUndo, Logo } from "../icons";
import { Avatar, Kbd } from "../ui";

const NAV: { id: ViewId; label: string; icon: (p: { size?: number }) => React.ReactNode; kbd: string }[] = [
  { id: "board", label: "Доска", icon: (p) => <IcBoard {...p} />, kbd: "1" },
  { id: "backlog", label: "Бэклог", icon: (p) => <IcBacklog {...p} />, kbd: "2" },
  { id: "timeline", label: "Таймлайн", icon: (p) => <IcTimeline {...p} />, kbd: "3" },
  { id: "workflow", label: "Рабочий процесс", icon: (p) => <IcFlow {...p} />, kbd: "4" },
];

export default function Sidebar() {
  const { data, ui, setView, resetDemo } = useStore();
  const me = data.users.find((u) => u.id === data.currentUserId);
  const openCount = data.issues.filter((i) => i.typeId !== "epic" && data.workflow.statuses.find((s) => s.id === i.statusId)?.category !== "done").length;

  return (
    <aside className="flex w-[232px] shrink-0 flex-col bg-sidebar text-[#c6d2e4]">
      <div className="flex items-center gap-2.5 px-4 pb-5 pt-5">
        <Logo size={30} />
        <div className="leading-none">
          <p className="font-disp text-[15px] font-bold tracking-tight text-white">Taskira</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[#5f7396]">issue tracking</p>
        </div>
      </div>

      <div className="mx-3 mb-4 flex items-center gap-2.5 rounded-lg border border-[#24385a] bg-sidebar2/70 p-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent font-disp text-[13px] font-bold text-white">{data.project.key[0]}</span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold text-white">{data.project.name}</p>
          <p className="font-mono text-[10px] text-[#7b8fb2]">{data.project.key} · проект команды</p>
        </div>
      </div>

      <p className="px-4 pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#5f7396]">Планирование</p>
      <nav className="flex flex-col gap-0.5 px-3">
        {NAV.map((item) => {
          const active = ui.view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-all duration-150 ${
                active ? "bg-white/[0.09] text-white" : "text-[#9db0cd] hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent" />}
              <span className={active ? "text-[#7ab3ff]" : "text-[#647ba1] group-hover:text-[#9db0cd]"}>{item.icon({ size: 16 })}</span>
              <span className="flex-1">{item.label}</span>
              <span className="opacity-0 transition-opacity group-hover:opacity-100">
                <Kbd>{item.kbd}</Kbd>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mx-3 mt-5 rounded-lg border border-[#24385a] bg-sidebar2/50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-[#9db0cd]">Открытых задач</p>
          <span className="font-mono text-[15px] font-bold text-white">{openCount}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#24385a]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-[#22a06b] transition-all duration-700"
            style={{ width: `${Math.round((1 - openCount / Math.max(1, data.issues.filter((i) => i.typeId !== "epic").length)) * 100)}%` }}
          />
        </div>
        <p className="mt-1.5 text-[10px] text-[#5f7396]">доля закрытых по проекту</p>
      </div>

      <div className="mt-auto px-3 pb-4">
        <button
          onClick={resetDemo}
          className="mb-3 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12.5px] font-medium text-[#7b8fb2] transition-colors hover:bg-white/[0.05] hover:text-white"
        >
          <IcUndo size={15} /> Сбросить демо-данные
        </button>
        <div className="rounded-lg border border-[#24385a] bg-sidebar2/70 p-2.5">
          <div className="flex items-center gap-2.5">
            <Avatar user={me} size={30} />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[12.5px] font-semibold text-white">{me?.name}</p>
              <p className="text-[10.5px] text-[#7b8fb2]">{me?.role}</p>
            </div>
            <span className="ml-auto h-2 w-2 rounded-full bg-[#22a06b] pulse-dot" title="В сети" />
          </div>
          <p className="mt-2 border-t border-[#24385a] pt-2 text-[10px] leading-relaxed text-[#5f7396]">
            <Kbd>/</Kbd> поиск · <Kbd>C</Kbd> создать · <Kbd>1–4</Kbd> разделы
          </p>
        </div>
      </div>
    </aside>
  );
}
