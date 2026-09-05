import { useState } from "react";
import { useStore } from "../store";
import type { Transition } from "../types";
import { IcChevR, IcFlow, IcLock, IcPlus, IcTrash, IcUndo } from "../icons";
import { Lozenge, catColor } from "../ui";

const POS: Record<string, { x: number; y: number; w: number; h: number }> = {
  todo: { x: 40, y: 140, w: 190, h: 76 },
  inprogress: { x: 390, y: 32, w: 190, h: 76 },
  review: { x: 390, y: 248, w: 190, h: 76 },
  done: { x: 750, y: 140, w: 190, h: 76 },
};

/* заранее проложенные маршруты стрелок, чтобы схема читалась как в Jira */
const PATHS: Record<string, string> = {
  "todo>inprogress": "M230,158 C305,140 315,72 384,70",
  "todo>done": "M230,178 L744,178",
  "inprogress>todo": "M388,92 C310,112 292,192 236,192",
  "inprogress>review": "M497,108 C522,150 522,208 497,242",
  "review>inprogress": "M471,248 C447,206 447,148 471,114",
  "review>done": "M580,286 C662,286 682,206 744,196",
  "inprogress>done": "M580,56 C660,42 690,124 744,152",
  "done>inprogress": "M845,138 C845,8 545,4 490,26",
};

function edgePath(t: Transition) {
  const key = `${t.from}>${t.to}`;
  if (PATHS[key]) return PATHS[key];
  const a = POS[t.from] ?? POS.todo;
  const b = POS[t.to] ?? POS.done;
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  return `M${ax},${ay} Q${(ax + bx) / 2},${Math.min(ay, by) - 60} ${bx},${by}`;
}

export default function WorkflowView() {
  const { data, addTransition, removeTransition, resetWorkflow, toast, can } = useStore();
  const canEditWf = can("editWorkflow");
  const [from, setFrom] = useState("todo");
  const [to, setTo] = useState("review");
  const [formErr, setFormErr] = useState("");
  const [hover, setHover] = useState<string | null>(null);

  const countBy = (sid: string) => data.issues.filter((i) => i.typeId !== "epic" && i.statusId === sid).length;
  const stName = (id: string) => data.workflow.statuses.find((s) => s.id === id);

  const submit = () => {
    const err = addTransition(from, to);
    if (err) setFormErr(err);
    else {
      setFormErr("");
      setTo(data.workflow.statuses.find((s) => s.id !== from)?.id ?? "done");
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1060px] px-6 py-5">
        <div className="anim-fadeup flex items-end gap-3">
          <div>
            <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">Рабочий процесс</h1>
            <p className="mt-0.5 text-[11.5px] text-faint">
              Схема переходов проекта {data.project.key} — доска и карточки подчиняются этим правилам · {data.workflow.transitions.length} переходов
            </p>
          </div>
          {canEditWf && (
            <button onClick={resetWorkflow} className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-[12.5px] font-semibold text-sub transition-colors hover:border-accent hover:text-accent">
              <IcUndo size={13} /> Сбросить схему
            </button>
          )}
        </div>

        {/* граф */}
        <div className="anim-fadeup mt-4 overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_3px_rgba(20,35,64,0.05)]" style={{ animationDelay: "60ms" }}>
          <div className="flex items-center gap-2 border-b border-linesoft bg-canvas/60 px-4 py-2.5">
            <IcFlow size={14} className="text-accent" />
            <span className="text-[12px] font-bold uppercase tracking-wider text-sub">Карта статусов</span>
            <span className="ml-auto text-[11px] text-faint">наведите на переход в списке — подсветится стрелка</span>
          </div>
          <svg viewBox="0 0 980 360" className="block w-full">
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0L10,5L0,10z" fill="#8fa3bf" />
              </marker>
              <marker id="arrA" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0L10,5L0,10z" fill="#0b5fd9" />
              </marker>
            </defs>
            <g className="pointer-events-none">
              {data.workflow.transitions.map((t, i) => {
                const active = hover === t.id;
                return (
                  <path
                    key={t.id}
                    d={edgePath(t)}
                    fill="none"
                    stroke={active ? "#0b5fd9" : "#aebbd0"}
                    strokeWidth={active ? 2.6 : 1.6}
                    markerEnd={`url(#${active ? "arrA" : "arr"})`}
                    className="edge-draw transition-all duration-200"
                    style={{ animationDelay: `${i * 70}ms` }}
                  />
                );
              })}
            </g>
            {data.workflow.statuses.map((s) => {
              const p = POS[s.id];
              if (!p) return null;
              const c = catColor(s.category);
              return (
                <g key={s.id}>
                  <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="12" fill="#fdfdfe" stroke={active2(hover, data.workflow.transitions, s.id) ? "#0b5fd9" : "#d5dde9"} strokeWidth={active2(hover, data.workflow.transitions, s.id) ? 2 : 1.2} className="transition-all" />
                  <rect x={p.x} y={p.y} width="6" height={p.h} rx="3" fill={c.dot} />
                  <text x={p.x + 22} y={p.y + 32} fontSize="14.5" fontWeight="700" fill="#17233b" fontFamily="Golos Text, sans-serif">{s.name}</text>
                  <text x={p.x + 22} y={p.y + 54} fontSize="11.5" fill="#8b95a7" fontFamily="JetBrains Mono, monospace">{countBy(s.id)} задач</text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* список переходов */}
        <div className="anim-fadeup mt-4 grid gap-4 lg:grid-cols-[1fr_320px]" style={{ animationDelay: "120ms" }}>
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            <p className="border-b border-linesoft bg-canvas/60 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wider text-sub">Разрешённые переходы</p>
            {data.workflow.transitions.length === 0 && (
              <p className="px-4 py-6 text-center text-[12.5px] text-faint">Переходов нет — доска полностью заблокирована. Добавьте первый справа.</p>
            )}
            {data.workflow.transitions.map((t) => {
              const a = stName(t.from);
              const b = stName(t.to);
              if (!a || !b) return null;
              return (
                <div
                  key={t.id}
                  onMouseEnter={() => setHover(t.id)}
                  onMouseLeave={() => setHover(null)}
                  className={`flex items-center gap-3 border-b border-linesoft px-4 py-2.5 transition-colors last:border-0 ${hover === t.id ? "bg-accentsoft" : "hover:bg-canvas/60"}`}
                >
                  <Lozenge status={a} size="sm" />
                  <IcChevR size={13} className={hover === t.id ? "text-accent" : "text-faint"} />
                  <Lozenge status={b} size="sm" />
                  <span className="ml-auto font-mono text-[10.5px] text-faint">{countBy(t.from)} → {countBy(t.to)}</span>
                  {canEditWf && (
                    <button
                      onClick={() => removeTransition(t.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-faint transition-colors hover:bg-dangersoft hover:text-danger"
                      aria-label="Удалить переход"
                    >
                      <IcTrash size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="h-fit rounded-xl border border-line bg-panel p-4">
            {!canEditWf ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <IcLock size={22} className="text-faint" />
                <p className="text-[13px] font-bold text-sub">Схема только для чтения</p>
                <p className="text-[11.5px] leading-relaxed text-faint">
                  Изменять переходы может только <b className="text-[#B42318]">Администратор</b>. Переключите пользователя в меню сверху, чтобы редактировать схему.
                </p>
              </div>
            ) : (
            <>
            <p className="text-[12px] font-bold uppercase tracking-wider text-sub">Новый переход</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-faint">Правило сразу начнёт действовать: карточки на доске нельзя будет перетащить против схемы.</p>
            <div className="mt-3 space-y-2.5">
              <label className="block">
                <span className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-faint">Из статуса</span>
                <select value={from} onChange={(e) => setFrom(e.target.value)} className="w-full cursor-pointer rounded-md border border-line bg-white px-2.5 py-2 text-[13px] outline-none focus:border-accent">
                  {data.workflow.statuses.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10.5px] font-bold uppercase tracking-wider text-faint">В статус</span>
                <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full cursor-pointer rounded-md border border-line bg-white px-2.5 py-2 text-[13px] outline-none focus:border-accent">
                  {data.workflow.statuses.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              {formErr && <p className="rounded bg-dangersoft px-2.5 py-1.5 text-[11.5px] font-semibold text-danger">{formErr}</p>}
              <button
                onClick={submit}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-[12.5px] font-semibold text-white shadow-[0_2px_8px_rgba(11,95,217,0.3)] transition-all hover:bg-accentdeep active:scale-[0.98]"
              >
                <IcPlus size={13} /> Добавить переход
              </button>
              <button
                onClick={() => toast("info", "Подсказка: удалите переход «Готово → В работе», чтобы запретить возврат из готовых")}
                className="w-full rounded-md px-3 py-1.5 text-[11.5px] font-semibold text-faint hover:text-accent"
              >
                Как это работает?
              </button>
            </div>
            </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function active2(hover: string | null, trs: Transition[], sid: string) {
  if (!hover) return false;
  const t = trs.find((x) => x.id === hover);
  return !!t && (t.from === sid || t.to === sid);
}
