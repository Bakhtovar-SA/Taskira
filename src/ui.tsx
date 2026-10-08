import type { Status } from "./types";
import { useToasts } from "./store";
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

export function Toasts() {
  const toasts = useToasts();
  const { t } = useT();
  const meta = {
    success: { dot: "var(--status-done)", label: t("toast.success") },
    error: { dot: "var(--status-danger)", label: t("toast.error") },
    info: { dot: "var(--accent-solid)", label: t("toast.info") },
  };
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[360px] max-w-[calc(100vw-2.5rem)] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((item) => {
        const m = meta[item.kind];
        return (
          <div key={item.id} className="glass anim-toast pointer-events-auto flex items-start gap-3 rounded-xl border border-line px-3.5 py-3 shadow-e3">
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
