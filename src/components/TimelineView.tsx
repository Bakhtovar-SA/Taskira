import { useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { IcChevR, IcTimeline } from "../icons";
import { Lozenge, Empty } from "../ui";
import { TypeIcon } from "../icons";

// 52 недель (год) с пиксельными колонками + горизонтальный скролл — раньше
// было 8 фиксированных недель без возможности посмотреть дальше (overdrive).
const WEEKS = 52;
const WEEK_PX = 56;
const LABEL_PX = 260;
const GRID_COLS = `${LABEL_PX}px repeat(${WEEKS}, ${WEEK_PX}px)`;

export default function TimelineView() {
  const { data, openIssue } = useStore();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Тип "epic" упразднён (миграция 002): «эпик» — задача, на которую ссылаются
  // другие через epicId.
  const epicIds = new Set(data.issues.map((i) => i.epicId).filter(Boolean));
  const epics = data.issues.filter((i) => epicIds.has(i.id));
  const children = (epicId: string) => data.issues.filter((i) => i.epicId === epicId);
  const dayOfWeek = (new Date().getDay() + 6) % 7;
  const todayPx = ((dayOfWeek + 0.5) / 7) * WEEK_PX;

  const scrollToToday = () => scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1120px] min-[1536px]:max-w-[1380px] min-[1920px]:max-w-[1680px] px-6 py-5">
        <div className="anim-fadeup flex items-end justify-between gap-3">
          <div>
            <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">Таймлайн</h1>
            <p className="mt-0.5 text-[11.5px] text-faint">Дорожная карта направлений на ближайший год · тяните колёсиком/трекпадом, чтобы посмотреть дальше</p>
          </div>
          {epics.length > 0 && (
            <button
              onClick={scrollToToday}
              className="mb-0.5 flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-line bg-panel px-3 text-[12px] font-medium text-sub transition-colors hover:border-accent hover:text-accent"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-danger" /> Сегодня
            </button>
          )}
        </div>

        {epics.length === 0 ? (
          <div className="mt-6">
            <Empty
              icon={<IcTimeline size={24} />}
              title="Направлений пока нет"
              sub="Направление — это обычная задача, на которую ссылаются другие. Откройте любую задачу, в поле «Направление» выберите родителя — он появится здесь как дорожка с датами t-start / t-span."
            />
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="anim-fadeup mt-4 overflow-x-auto overflow-y-hidden rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]"
            style={{ animationDelay: "60ms" }}
          >
            {/* шапка недель */}
            <div className="grid border-b border-line bg-canvas/60" style={{ gridTemplateColumns: GRID_COLS, width: LABEL_PX + WEEKS * WEEK_PX }}>
              <div className="sticky left-0 z-10 bg-canvas px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-faint">Направление</div>
              {weeks.map((w, i) => (
                <div key={i} className={`border-l border-linesoft px-1.5 py-2.5 text-center ${i === 0 ? "bg-accentsoft/60" : ""}`}>
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
                <div key={epic.id} className="border-b border-linesoft last:border-0" style={{ width: LABEL_PX + WEEKS * WEEK_PX }}>
                  <div className="grid items-center" style={{ gridTemplateColumns: GRID_COLS }}>
                    <button
                      onClick={() => setOpen((o) => ({ ...o, [epic.id]: !expanded }))}
                      className="sticky left-0 z-10 flex items-center gap-2.5 bg-panel px-4 py-3 text-left transition-colors hover:bg-canvas/60"
                    >
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
                        <span className="absolute bottom-0 top-0 z-10 w-px bg-danger/70" style={{ left: todayPx }} title="Сегодня" />
                        {weeks.map((_, i) => (
                          <span key={i} className="absolute bottom-1 top-1 border-l border-linesoft" style={{ left: i * WEEK_PX }} />
                        ))}
                        <button
                          onClick={() => openIssue(epic.id)}
                          title={`${epic.title} · ${done}/${kids.length} готово`}
                          className="timeline-bar group absolute top-1/2 flex h-6 items-center overflow-hidden rounded-full text-white shadow-sm"
                          style={{ "--bar-x": `${start * WEEK_PX}px`, width: span * WEEK_PX, background: epic.color } as React.CSSProperties}
                        >
                          <span className="timeline-bar-fill absolute inset-y-0 left-0 bg-black/25" style={{ width: `${kids.length ? (done / kids.length) * 100 : 0}%` }} />
                          <span className="relative z-10 truncate px-2.5 text-[10.5px] font-bold">{epic.key}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  {expanded && (
                    <div className="anim-fadeup sticky left-0 border-t border-dashed border-linesoft bg-canvas/40" style={{ width: `min(100%, calc(100vw - 2px))` }}>
                      {kids.length === 0 && <p className="px-10 py-2.5 text-[12px] text-faint">В направлении пока нет задач.</p>}
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
          <span className="inline-block h-3 w-px bg-danger/70" /> сегодня · тёмная часть полосы — доля закрытых задач направления
        </p>
      </div>
    </div>
  );
}
