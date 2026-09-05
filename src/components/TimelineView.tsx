import { useMemo, useState } from "react";
import { useStore } from "../store";
import { IcChevR, IcTimeline } from "../icons";
import { Lozenge, Empty } from "../ui";
import { TypeIcon } from "../icons";

const WEEKS = 8;

export default function TimelineView() {
  const { data, openIssue } = useStore();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const weeks = useMemo(() => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return Array.from({ length: WEEKS }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i * 7);
      return d;
    });
  }, []);

  const epics = data.issues.filter((i) => i.typeId === "epic");
  const children = (epicId: string) => data.issues.filter((i) => i.epicId === epicId);
  const dayOfWeek = (new Date().getDay() + 6) % 7;
  const todayPct = ((0 + (dayOfWeek + 0.5) / 7) / WEEKS) * 100;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1120px] px-6 py-5">
        <div className="anim-fadeup">
          <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">Таймлайн</h1>
          <p className="mt-0.5 text-[11.5px] text-faint">Дорожная карта эпиков на ближайшие {WEEKS} недель</p>
        </div>

        {epics.length === 0 ? (
          <div className="mt-6">
            <Empty icon={<IcTimeline size={24} />} title="Эпиков пока нет" sub="Создайте задачу типа «Эпик», и она появится на таймлайне" />
          </div>
        ) : (
          <div className="anim-fadeup mt-4 overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]" style={{ animationDelay: "60ms" }}>
            {/* шапка недель */}
            <div className="grid border-b border-line bg-canvas/60" style={{ gridTemplateColumns: `260px repeat(${WEEKS}, 1fr)` }}>
              <div className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-faint">Эпик</div>
              {weeks.map((w, i) => (
                <div key={i} className={`border-l border-linesoft px-2 py-2.5 text-center ${i === 0 ? "bg-accentsoft/60" : ""}`}>
                  <p className="font-mono text-[11px] font-bold text-sub">{w.toLocaleDateString("ru-RU", { day: "numeric" })}</p>
                  <p className="text-[10px] capitalize text-faint">{w.toLocaleDateString("ru-RU", { month: "short" })}</p>
                </div>
              ))}
            </div>

            {epics.map((epic) => {
              const kids = children(epic.id);
              const done = kids.filter((k) => data.workflow.statuses.find((s) => s.id === k.statusId)?.category === "done").length;
              const start = Math.max(0, Math.min(epic.tStart ?? 0, WEEKS - 1));
              const span = Math.max(1, Math.min(epic.tSpan ?? 3, WEEKS - start));
              const expanded = open[epic.id];
              return (
                <div key={epic.id} className="border-b border-linesoft last:border-0">
                  <div className="grid items-center" style={{ gridTemplateColumns: `260px repeat(${WEEKS}, 1fr)` }}>
                    <button onClick={() => setOpen((o) => ({ ...o, [epic.id]: !expanded }))} className="flex items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-canvas/60">
                      <IcChevR size={12} className={`shrink-0 text-faint transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
                      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: epic.color }} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-ink">{epic.title}</span>
                        <span className="block font-mono text-[10px] text-faint">{done}/{kids.length} задач · {epic.key}</span>
                      </span>
                    </button>
                    <div className="relative col-span-full row-start-1" style={{ gridColumn: `2 / span ${WEEKS}` }}>
                      <div className="relative h-[46px]">
                        {/* линия сегодня */}
                        <span className="absolute bottom-0 top-0 z-10 w-px bg-danger/70" style={{ left: `${todayPct}%` }} title="Сегодня" />
                        {weeks.map((_, i) => (
                          <span key={i} className="absolute bottom-1 top-1 border-l border-linesoft" style={{ left: `${(i / WEEKS) * 100}%` }} />
                        ))}
                        <button
                          onClick={() => openIssue(epic.id)}
                          title={`${epic.title} · ${done}/${kids.length} готово`}
                          className="group absolute top-1/2 flex h-6 -translate-y-1/2 items-center overflow-hidden rounded-full text-white shadow-sm transition-transform hover:scale-y-110"
                          style={{ left: `${(start / WEEKS) * 100}%`, width: `${(span / WEEKS) * 100}%`, background: epic.color }}
                        >
                          <span className="absolute inset-y-0 left-0 bg-black/25" style={{ width: `${kids.length ? (done / kids.length) * 100 : 0}%` }} />
                          <span className="relative z-10 truncate px-2.5 text-[10.5px] font-bold">{epic.key}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  {expanded && (
                    <div className="anim-fadeup border-t border-dashed border-linesoft bg-canvas/40">
                      {kids.length === 0 && <p className="px-10 py-2.5 text-[12px] text-faint">В эпике пока нет задач.</p>}
                      {kids.map((k) => {
                        const st = data.workflow.statuses.find((s) => s.id === k.statusId)!;
                        return (
                          <button key={k.id} onClick={() => openIssue(k.id)} className="flex w-full items-center gap-2.5 px-10 py-2 text-left transition-colors hover:bg-accentsoft/60">
                            <TypeIcon type={k.typeId} size={13} />
                            <span className="font-mono text-[10.5px] font-semibold text-faint">{k.key}</span>
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{k.title}</span>
                            <Lozenge status={st} size="sm" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="anim-fadeup mt-3 flex items-center gap-2 text-[11px] text-faint" style={{ animationDelay: "120ms" }}>
          <span className="inline-block h-3 w-px bg-danger/70" /> сегодня · тёмная часть полосы — доля закрытых задач эпика
        </p>
      </div>
    </div>
  );
}
