/** Холст шкалы времени (ТЗ 5.12 f): сетка делений, линия «сегодня» и липкая стеклянная шапка из двух рядов.
 *  Строки — children, позиционируются теми же x из `TimeScale`. Общий для Таймлайна направлений и роадмапа
 *  проектов (ТЗ 5.15). Позиции — CSS-переменные через CSSOM (`cssVars`), не inline style. */
import { memo, type ReactNode } from "react";
import { cssVars } from "../cssVars";
import type { Tick, TimeScale } from "../timeScale";

/** Поле слева от начала шкалы — чтобы подпись строки у края не липла к рамке. */
export const TIME_PAD = 24;

type FrameProps = {
  scale: TimeScale;
  ticks: { major: Tick[]; minor: Tick[] };
  /** x центра сегодняшнего дня на шкале и подпись; null — сегодня вне шкалы. */
  today: { x: number; label: string } | null;
};

export function TimeCanvas({ scale, ticks, today, children }: FrameProps & { children: ReactNode }) {
  return (
    <div className="relative min-h-full w-[var(--canvas-w)]" ref={cssVars({ "--canvas-w": TIME_PAD + scale.width + 48 })}>
      <Frame ticks={ticks} today={today} />
      {children}
    </div>
  );
}

/** Сетка, «сегодня» и шапка — memo: строки под ними (children) меняются чаще (прокрутка роадмапа рисует только
 *  видимые строки), а делений сотни — их перерисовка на каждый шаг прокрутки стоила кадров. Вызывающий держит
 *  ticks и today стабильными (useMemo). */
const Frame = memo(function Frame({ ticks, today }: Omit<FrameProps, "scale">) {
  const todayAt = today ? TIME_PAD + today.x : -1;
  // Подпись первого крупного деления не прячется под плашкой «сегодня».
  const firstMajorAt = (t: Tick) => (t.x === 0 && today && today.x < 80 ? Math.max(6, today.x + 34) : 6);
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 left-[24px]">
        {ticks.minor.map((t) => t.x > 0 && <span key={`n${t.x}`} ref={cssVars({ "--x": t.x })} className="time-line absolute inset-y-0 left-[var(--x)]" />)}
        {ticks.major.map((t) => t.x > 0 && <span key={`j${t.x}`} ref={cssVars({ "--x": t.x })} className="absolute inset-y-0 left-[var(--x)] border-l border-dashed border-line" />)}
      </div>
      {today && (
        <span aria-hidden ref={cssVars({ "--x": todayAt })} className="pointer-events-none absolute inset-y-0 left-[var(--x)] z-20 w-px bg-accent shadow-[0_0_12px_var(--accent-glow)]" />
      )}

      <div className="glass sticky top-0 z-10 border-b border-linesoft">
        <div className="relative h-6">
          {ticks.major.map((t) => (
            <span
              key={t.x}
              ref={cssVars({ "--x": TIME_PAD + t.x, "--w": t.w, "--in": firstMajorAt(t) })}
              className="absolute left-[var(--x)] top-[7px] w-[var(--w)] truncate pl-[var(--in)] pr-1 text-[11px] font-bold uppercase tracking-[0.06em] text-sub"
            >
              {t.w >= 28 && t.label}
            </span>
          ))}
        </div>
        <div className="relative h-6">
          {ticks.minor.map((t) => (
            <span
              key={t.x}
              ref={cssVars({ "--x": TIME_PAD + t.x, "--w": t.w })}
              className="absolute left-[var(--x)] top-0.5 w-[var(--w)] truncate px-1.5 text-[11.5px] tabular text-faint"
            >
              {/* Хвост единицы у левого края уже подписи — обрубок «с» вместо «сент» хуже, чем ничего. */}
              {t.w >= 28 && t.label}
            </span>
          ))}
          {today && (
            <em
              ref={cssVars({ "--x": todayAt })}
              className="absolute -top-5 left-[var(--x)] z-30 -translate-x-1/2 whitespace-nowrap rounded-md bg-accent px-1.5 text-[10.5px] font-bold not-italic leading-4 text-onaccent shadow-[0_2px_10px_-2px_var(--accent-glow)]"
            >
              {today.label}
            </em>
          )}
        </div>
      </div>
    </>
  );
});
