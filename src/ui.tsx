import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Status, Toast } from "./types";
import { useToasts } from "./store";
import { enter, exit, flipFrom, motionReduced, preloadMotionIdle } from "./motion";
import { useT } from "./i18n";
import { PROJECT_ICON_MAP, type ProjectColor, type ProjectIcon } from "./projectLook";

/** Аватары — в components/UserAvatar.tsx (трек G). Карточку человека и загрузку фото берут и экраны трека H. */
export { useAvatarSrc, UserCardBody } from "./components/UserAvatar";

/** Знак проекта: плашка в тоне проекта с иконкой или первой буквой ключа. Цвет и иконку выбирают в мастере
 *  и в настройках проекта (ТЗ 5.10); без них — буква и тон по ключу из палитры проектов (ТЗ 5.3 п.6), так
 *  что проект без настроек всегда одного цвета. */
const PROJECT_TONES = ["blue", "pink", "orange", "green", "teal", "red", "amber", "sky", "indigo"] as const;
export const projectTone = (key: string) => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PROJECT_TONES[h % PROJECT_TONES.length];
};
/** Тон метки: у меток нет цвета в БД, поэтому стабильный хэш текста → один из
 *  фирменных тонов (`tk-tone-*`). Одна и та же метка везде одного цвета. */
const LABEL_TONES = ["violet", "pink", "teal", "amber", "sky", "green", "orange", "indigo", "red"] as const;
export const labelTone = (text: string) => {
  let h = 0;
  for (const ch of text.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LABEL_TONES[h % LABEL_TONES.length];
};
export const ProjectMark = ({ projectKey, icon, color, size = 20 }: { projectKey: string; icon?: ProjectIcon | null; color?: ProjectColor | null; size?: number }) => {
  const Icon = icon ? PROJECT_ICON_MAP[icon] : null;
  return (
    <span
      className={`tk-tone-${color ?? projectTone(projectKey)} inline-flex shrink-0 items-center justify-center rounded-md bg-current/15 font-bold ring-1 ring-inset ring-current/25`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      aria-hidden="true"
    >
      {Icon ? <Icon size={Math.round(size * 0.62)} /> : projectKey[0]}
    </span>
  );
};

/** Цвет направления: сохранённый в БД цвет, иначе — детерминированный тон из
 *  палитры проектов (ТЗ 5.3 п.6) по id, чтобы соседние полосы не сливались в
 *  один фиолетовый. */
const DIRECTION_HUES = [262, 312, 350, 25, 60, 150, 190, 230];
export const directionColor = (id: string, color?: string | null) => {
  if (color) return color;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `oklch(0.64 0.14 ${DIRECTION_HUES[h % DIRECTION_HUES.length]})`;
};

export const catColor = (cat: Status["category"]) =>
  cat === "done"
    ? { dot: "var(--c-ok)", bg: "var(--c-oksoft)", fg: "var(--c-ok-fg)" }
    : cat === "inprogress"
      ? { dot: "var(--c-warndot)", bg: "var(--c-warnsoft)", fg: "var(--c-warn-fg)" }
      : { dot: "var(--c-todo)", bg: "var(--c-todosoft)", fg: "var(--c-todo-fg)" };

/** Классы «плашки» колонки доски. Один источник для настоящей колонки
 *  (`Board.tsx`) и для скелета (`SkeletonColumn`), чтобы во время bootstrap
 *  заглушка выглядела как готовая колонка, а не «прыгала» в неё после загрузки
 *  (ticket-board-columns-theme-fix). */
/** Ширину ограничивает сетка доски; лишние колонки прокручиваются по горизонтали. */
export const BOARD_COLUMN_SHELL =
  "flex h-full max-h-full min-w-0 flex-col";
/** Жёлоб с карточками под заголовком колонки (ADR-0016: заголовок — над ним, не внутри). */
export const BOARD_COLUMN_BODY = "board-col-body flex min-h-0 flex-col gap-1.5 overflow-y-auto";

/** Тосты (ADR-0035, прототип): появление — пружина `enter`, уход — `exit`, соседи доезжают FLIP'ом. Стор и таймеры
 *  не меняются: снятый стором тост остаётся здесь в `gone`, пока не доиграет уход (по образцу `ds/Presence`); под
 *  reduced-motion — снимается сразу, как раньше. Перерисовывается только `Toasts` — он и так подписчик стора тостов. */
export function Toasts() {
  const toasts = useToasts();
  const { t } = useT();
  const [prev, setPrev] = useState(toasts);
  const [gone, setGone] = useState<Toast[]>([]);
  if (prev !== toasts) {
    setPrev(toasts);
    const ids = new Set(toasts.map((x) => x.id));
    const removed = prev.filter((x) => !ids.has(x.id));
    if (removed.length && !motionReduced()) setGone((g) => [...g.filter((x) => !ids.has(x.id)), ...removed.filter((r) => !g.some((x) => x.id === r.id))]);
  }
  // Порядок — по id (он растёт): уходящий тост остаётся на своём месте среди оставшихся.
  const shown = gone.length ? [...gone.filter((x) => !toasts.some((y) => y.id === x.id)), ...toasts].sort((x, y) => x.id - y.id) : toasts;
  const leaving = new Set(gone.map((x) => x.id));
  const box = useRef<HTMLDivElement>(null);
  const tops = useRef(new Map<number, number>());
  const exiting = useRef(new WeakSet<HTMLElement>());
  useEffect(() => preloadMotionIdle(), []);
  // После каждого коммита: новые тосты въезжают, сдвинутые соседи едут со старого места. Положение — раскладочное
  // (offsetTop от неподвижного контейнера), а не rect: rect включал бы идущую анимацию.
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const base = root.getBoundingClientRect().top;
    const next = new Map<number, number>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-toast-id]")) {
      const id = Number(el.dataset.toastId);
      const top = base + el.offsetTop;
      next.set(id, top);
      const was = tops.current.get(id);
      if (was === undefined) {
        if (!leaving.has(id)) enter(el, "toast");
      } else if (Math.abs(was - top) >= 1 && !exiting.current.has(el)) void flipFrom(el, el.getBoundingClientRect().left, was, { lift: false });
      if (leaving.has(id) && !exiting.current.has(el)) {
        exiting.current.add(el);
        void exit(el, "toast").then(() => setGone((g) => g.filter((x) => x.id !== id)));
      }
    }
    tops.current = next;
  });
  const meta = {
    success: { dot: "var(--status-done)", label: t("toast.success") },
    error: { dot: "var(--status-danger)", label: t("toast.error") },
    info: { dot: "var(--accent-solid)", label: t("toast.info") },
  };
  return (
    <div ref={box} className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[360px] max-w-[calc(100vw-2.5rem)] flex-col gap-2" role="status" aria-live="polite">
      {shown.map((item) => {
        const m = meta[item.kind];
        const out = leaving.has(item.id);
        return (
          <div key={item.id} data-toast-id={item.id} aria-hidden={out || undefined} className={`glass flex items-start gap-3 rounded-xl border border-line px-3.5 py-3 shadow-e3 ${out ? "" : "pointer-events-auto"}`}>
            <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: m.dot, boxShadow: `0 0 0 3px color-mix(in oklch, ${m.dot} 22%, transparent)` }} />
            <p className="min-w-0 text-[14px] leading-snug text-ink">
              <span className="sr-only">{m.label}: </span>
              {item.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}
