import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Status, Toast } from "./types";
import { useToasts } from "./store";
import { exit, flipFrom, motionReduced, preloadMotionIdle, stopMotion } from "./motion";
import { useT } from "./i18n";
import { PROJECT_ICON_MAP, type ProjectColor, type ProjectIcon } from "./projectLook";
import { hidePop, showPop } from "./ds/floating";
import { NATIVE_DIALOG_CLOSE_EVENT, NATIVE_DIALOG_OPEN_EVENT } from "./ds/topLayer";

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

function ToastAction({ item, leaving, descriptionId }: { item: Toast; leaving: boolean; descriptionId: string }) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  if (!item.action) return null;
  return <button type="button" className="ds-btn ds-focus shrink-0" data-variant="ghost" data-size="sm"
    aria-describedby={descriptionId} disabled={leaving} aria-disabled={busy || undefined} aria-busy={busy || undefined}
    onClick={async event => {
      const button = event.currentTarget;
      if (running.current || leaving) return;
      running.current = true; setBusy(true); item.pause?.();
      try { if (await item.action!.run()) item.dismiss?.(); }
      finally {
        running.current = false; setBusy(false);
        if (!button.closest("[data-toast-id]")?.contains(document.activeElement)) item.resume?.();
      }
    }}>{item.action.label}</button>;
}

/** Тосты (ADR-0035, прототип): появление — прежняя CSS-анимация `anim-toast` (её объект Animation проверяет
 *  e2e/toast-over-panel: очередь не должна его перезапускать), уход — пружина `exit`, соседи доезжают FLIP'ом. Таймер действия приостанавливается, пока фокус в тосте; снятый стором тост остаётся здесь в `gone`, пока не доиграет уход (по образцу `ds/Presence`); под
 *  reduced-motion — снимается сразу, как раньше. Перерисовывается только `Toasts` — он и так подписчик стора тостов. */
export function Toasts() {
  const descriptionPrefix = useId();
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
  const tops = useRef(new Map<number, number>());
  const exiting = useRef(new WeakSet<HTMLElement>());
  useEffect(() => preloadMotionIdle(), []);
  // После каждого коммита: новые тосты въезжают, сдвинутые соседи едут со старого места. Сдвиг делает обёртка-слот
  // (`data-toast-slot`), а въезд и уход — сам тост (`data-toast-id`): так сдвиг соседа не отменяет его анимацию входа
  // (его animation остаётся тем же объектом — это проверяет e2e/toast-over-panel). Положение — раскладочное
  // (offsetTop от неподвижного контейнера), а не rect: rect включал бы идущую анимацию.
  useLayoutEffect(() => {
    const root = host.current;
    if (!root?.isConnected) return;
    const base = root.getBoundingClientRect().top;
    const next = new Map<number, number>();
    for (const slot of root.querySelectorAll<HTMLElement>("[data-toast-slot]")) {
      const id = Number(slot.dataset.toastSlot);
      const el = slot.firstElementChild as HTMLElement;
      const top = base + slot.offsetTop;
      next.set(id, top);
      const was = tops.current.get(id);
      if (was !== undefined && Math.abs(was - top) >= 1 && !exiting.current.has(el)) void flipFrom(slot, slot.getBoundingClientRect().left, was, { lift: false });
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
  const [visualHost] = useState(() => {
    const el = document.createElement("div");
    el.setAttribute("popover", "manual");
    el.setAttribute("data-toast-host", "");
    el.className = "pointer-events-none fixed bottom-5 right-5 left-auto top-auto z-[70] m-0 flex w-[360px] max-w-[calc(100vw-2.5rem)] flex-col gap-2 overflow-visible border-0 bg-transparent p-0";
    return el;
  });
  const host = useRef(visualHost);
  const hasActions = shown.some(item => !!item.action);
  const actionHost = useRef(hasActions);
  actionHost.current = hasActions;
  const syncVisualHost = useRef<(() => void) | null>(null);
  const announcer = useRef<HTMLDivElement>(null);
  const [announcementHost, setAnnouncementHost] = useState<HTMLDivElement | null>(null);
  const activeAnnouncementHost = useRef<HTMLDivElement | null>(null);
  const announcedIds = useRef(new Set<number>());
  const [announcement, setAnnouncement] = useState<{ host: HTMLDivElement | null; toasts: ReturnType<typeof useToasts> }>({ host: null, toasts: [] });
  // A modal makes outside live regions inert. Mount one empty announcer in the
  // active dialog's slot (or the root slot), then append only new messages.
  // Queue updates never re-open the visual host or restart existing animations.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    let dialogs = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"));
    const announceInsideActiveDialog = () => {
      dialogs = dialogs.filter(dialog => dialog.isConnected && dialog.open);
      // Interactive toast actions must be descendants of the active modal, otherwise they are inert.
      // Keep the portal target and its children stable when moving between modal roots.
      const parent = actionHost.current && dialogs.at(-1)?.isConnected ? dialogs.at(-1)! : document.body;
      if (el.parentElement !== parent) {
        const active = document.activeElement;
        const focused = active instanceof HTMLElement && el.contains(active) ? active : null;
        const mover = parent as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
        if (el.isConnected && typeof mover.moveBefore === "function") mover.moveBefore(el, null);
        else {
          // Older browsers cannot move a live subtree without cancelling CSS animations.
          // Complete the entrance once instead of replaying it after relocation.
          if (el.parentElement) for (const toast of el.querySelectorAll<HTMLElement>("[data-toast-id]")) {
            toast.setAttribute("data-toast-relocated", "");
            stopMotion(toast);
          }
          parent.appendChild(el);
        }
        if (focused?.isConnected && document.activeElement === document.body) focused.focus({ preventScroll: true });
      }
      const target = dialogs.at(-1)?.querySelector<HTMLDivElement>(":scope > [data-toast-announcer]") ?? announcer.current;
      activeAnnouncementHost.current = target;
      setAnnouncementHost(target);
    };
    const onOpen = (event: Event) => {
      const dialog = (event as CustomEvent<HTMLDialogElement>).detail;
      dialogs = [...dialogs.filter(item => item !== dialog), dialog];
      announceInsideActiveDialog();
      hidePop(el);
      showPop(el);
    };
    const onClose = (event: Event) => {
      dialogs = dialogs.filter(item => item !== (event as CustomEvent<HTMLDialogElement>).detail);
      announceInsideActiveDialog();
      showPop(el);
    };
    syncVisualHost.current = () => { announceInsideActiveDialog(); showPop(el); };
    announceInsideActiveDialog();
    showPop(el);
    document.addEventListener(NATIVE_DIALOG_OPEN_EVENT, onOpen);
    document.addEventListener(NATIVE_DIALOG_CLOSE_EVENT, onClose);
    return () => {
      syncVisualHost.current = null;
      document.removeEventListener(NATIVE_DIALOG_OPEN_EVENT, onOpen);
      document.removeEventListener(NATIVE_DIALOG_CLOSE_EVENT, onClose);
      for (const item of el.querySelectorAll<HTMLElement>("[data-toast-id], [data-toast-slot]")) stopMotion(item);
      hidePop(el);
      el.remove();
    };
  }, []);
  useLayoutEffect(() => { syncVisualHost.current?.(); }, [hasActions]);
  useEffect(() => {
    // Dialog layout effects may have changed the target before this effect runs.
    if (!announcementHost || announcementHost !== activeAnnouncementHost.current) return;
    const visibleIds = new Set(toasts.map(item => item.id));
    for (const id of announcedIds.current) if (!visibleIds.has(id)) announcedIds.current.delete(id);
    const additions = toasts.filter(item => !announcedIds.current.has(item.id));
    for (const item of additions) announcedIds.current.add(item.id);
    setAnnouncement(previous => {
      const retained = previous.host === announcementHost ? previous.toasts.filter(item => visibleIds.has(item.id)) : [];
      if (previous.host === announcementHost && retained.length === previous.toasts.length && !additions.length) return previous;
      return { host: announcementHost, toasts: [...retained, ...additions] };
    });
  }, [toasts, announcementHost]);
  return (
    <>
      <div ref={announcer} className="sr-only" />
      {announcementHost && createPortal(
        <div role="status" aria-label={t("topbar.notifications")} aria-live="polite" aria-atomic="false" aria-relevant="additions text">
          {announcement.host === announcementHost && announcement.toasts.map(item => <div key={item.id}>{meta[item.kind].label}: {item.text}</div>)}
        </div>,
        announcementHost,
      )}
      {createPortal(<>
        {shown.map((item) => {
          const m = meta[item.kind];
          return (
            <div key={item.id} data-toast-slot={item.id}>
              <div data-toast-id={item.id} onFocusCapture={() => item.pause?.()} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !event.currentTarget.querySelector('[aria-busy="true"]')) item.resume?.(); }} className={`glass anim-toast flex items-start gap-3 rounded-xl border border-line px-3.5 py-3 shadow-e3 ${leaving.has(item.id) ? "" : "pointer-events-auto"}`}>
                <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: m.dot, boxShadow: `0 0 0 3px color-mix(in oklch, ${m.dot} 22%, transparent)` }} />
                <p id={`${descriptionPrefix}-${item.id}`} className="min-w-0 text-[14px] leading-snug text-ink">
                  <span className="sr-only">{m.label}: </span>
                  {item.text}
                </p>
                <ToastAction item={item} leaving={leaving.has(item.id)} descriptionId={`${descriptionPrefix}-${item.id}`} />
              </div>
            </div>
          );
        })}
      </>, visualHost)}
    </>
  );
}
