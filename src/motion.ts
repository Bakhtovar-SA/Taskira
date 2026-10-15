/** Движение (ТЗ 5.13, ADR-0015): переходы навигации через View Transitions и FLIP на WAAPI.
 *  Всё прерываемо (новый startViewTransition отменяет прежний, новая анимация того же элемента — предыдущую),
 *  всё уважает prefers-reduced-motion.
 *
 *  ADR-0035 (Accepted, прототип на доске): пружины — ленивый чанк `motionEngine.ts` (`motion/mini` `animate` +
 *  `spring`, весь вывод — WAAPI, разрешено CSP по ADR-0010). Этот файл — единственная точка входа: пока чанк не
 *  загружен или не загрузился вовсе, всё мгновенно (FLIP — старой кривой), ничего не ждёт и не бросает. Каждая
 *  функция сама проверяет `motionReduced()`: библиотека prefers-reduced-motion не учитывает (спайк ADR-0035). */
import { flushSync } from "react-dom";

type Engine = typeof import("./motionEngine");
type Controls = { cancel: () => void; finished: Promise<unknown> };

export const reducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
};

/** Личный выключатель «Уменьшить движение» поверх системного (localStorage, как тема; интерфейс — «Профиль → Внешний
 *  вид»). Единая точка истины для JS (`motionReduced()`) и для CSS: атрибут `data-motion="reduce"` на <html> — его ставит
 *  `public/theme-init.js` до первой отрисовки и `setReducedMotion()` при переключении; правило под ним в `index.css`
 *  гасит CSS-анимации и переходы. */
const REDUCE_KEY = "taskira.reduceMotion";
let userReduced: boolean | null = null;
const applyMotionAttr = (on: boolean): void => {
  try {
    if (on) document.documentElement.setAttribute("data-motion", "reduce");
    else document.documentElement.removeAttribute("data-motion");
  } catch {
    /* нет document (тесты без DOM) */
  }
};
export function setReducedMotion(on: boolean): void {
  userReduced = on;
  applyMotionAttr(on);
  try {
    if (on) localStorage.setItem(REDUCE_KEY, "1");
    else localStorage.removeItem(REDUCE_KEY);
  } catch {
    /* приватное окно — выключатель живёт до перезагрузки */
  }
}
/** Личный выключатель включён (без учёта системной настройки) — для переключателя в настройках. */
export function userReducedMotion(): boolean {
  if (userReduced === null) {
    try {
      userReduced = localStorage.getItem(REDUCE_KEY) === "1";
    } catch {
      userReduced = false;
    }
  }
  return userReduced;
}
/** Движение надо отключить: личный выключатель или системный prefers-reduced-motion. Всё движение проверяет только её. */
export function motionReduced(): boolean {
  return userReducedMotion() || reducedMotion();
}

/** Пресеты пружин (visualDuration — токены: --dur-4 = 300 мс, между --dur-3 и --dur-4 = 250 мс). Полное время
 *  успокоения, которое motion закладывает в WAAPI `duration` + `linear()`, — не дольше 500 мс (проверяет
 *  motion.test.ts тем же `spring.applyToOptions`). */
export const SPRING = { visualDuration: 0.3, bounce: 0.15 } as const; // ≈ 500 мс, перелёт ≈ 2 %
export const SPRING_ENTER = { visualDuration: 0.25, bounce: 0.1 } as const; // ≈ 330 мс
/** Уход быстрее появления: --dur-3, без пружины. `duration` у motion — в секундах. */
export const EXIT = { duration: 0.2, ease: [0.4, 0, 1, 1] as [number, number, number, number] };

let engine: Engine | null = null;
let loading: Promise<Engine | null> | null = null;
let failedAt = -Infinity;
/** После сбоя загрузки чанка (сеть, устаревший хеш после деплоя) новую попытку не раньше чем через столько мс: иначе
 *  каждая анимация доски слала бы по запросу. */
const RETRY_MS = 30_000;
let loader: () => Promise<Engine> = () => import("./motionEngine");

/** Грузит чанк заранее (на простое после первого экрана доски), чтобы первая анимация уже была пружиной.
 *  Ошибка загрузки не бросается: движение остаётся мгновенным, повторная попытка — не раньше `RETRY_MS`. */
export function preloadMotion(): Promise<Engine | null> {
  if (motionReduced()) return Promise.resolve(engine);
  if (!loading && Date.now() - failedAt < RETRY_MS) return Promise.resolve(engine);
  loading ??= loader().then(
    (m) => (engine = m),
    () => {
      loading = null;
      failedAt = Date.now();
      return null;
    },
  );
  return loading;
}
/** Только для тестов: подменить загрузчик чанка и сбросить состояние. */
export function __resetMotionForTests(load?: () => Promise<Engine>): void {
  engine = null;
  loading = null;
  failedAt = -Infinity;
  userReduced = null;
  applyMotionAttr(false);
  loader = load ?? (() => import("./motionEngine"));
}

function ready(): Engine | null {
  if (motionReduced()) return null;
  if (!engine) void preloadMotion();
  return engine;
}

/** Текущая анимация элемента — новая её отменяет (прерывание без наложения двух WAAPI на один transform).
 *  `clear` — inline-свойства, которые движок (motion/mini) по концу анимации оставляет на элементе последним кадром
 *  (`NativeAnimation.onfinish` → `setStyle`): без снятия inline-стиль навсегда перебивает классы (ширина сайдбара,
 *  `opacity` силуэта при перетаскивании, `transform` призрака). Снимаем только если анимацию не перехватила новая. */
const running = new WeakMap<Element, { c: Controls; clear: readonly string[] }>();
function unstyle(el: Element, clear: readonly string[]): void {
  const st = (el as HTMLElement).style;
  if (st) for (const p of clear) st.removeProperty(p);
}
function track(el: Element, c: Controls | null, clear: readonly string[] = []): Controls | null {
  const prev = running.get(el);
  if (prev) {
    prev.c.cancel();
    // Отмена WAAPI сама ничего не пишет, но анимация могла успеть дойти до конца (`onfinish` оставил последний кадр
    // inline), а её `finished.then` ещё не выполнился: после перехвата он уже не снимет стиль — снимаем здесь.
    unstyle(el, prev.clear);
  }
  if (c) {
    running.set(el, { c, clear });
    c.finished.then(
      () => {
        if (running.get(el)?.c !== c) return;
        running.delete(el);
        unstyle(el, clear);
      },
      () => undefined,
    );
  } else running.delete(el);
  return c;
}
function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null; // движение никогда не ломает интерфейс
  }
}

/** Смена представления или открытие задачи полной страницей: короткое перекрёстное затухание (--dur-2,
 *  правила — `html.vt-nav` в index.css). Нет API, reduced-motion или вкладка скрыта — мгновенно. */
type VTDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
export function viewTransition(update: () => void): void {
  const doc = document as VTDoc;
  if (!doc.startViewTransition || motionReduced() || document.visibilityState !== "visible") {
    update();
    return;
  }
  const root = document.documentElement;
  root.classList.add("vt-nav");
  doc
    .startViewTransition(() => flushSync(update))
    .finished.finally(() => root.classList.remove("vt-nav"))
    .catch(() => undefined);
}

/** FLIP: элемент уже на новом месте; анимируем его из старой точки (left/top во viewport). Пружина `SPRING`, если
 *  чанк загружен, иначе прежняя кривая (--dur-4, ease-out). `lift` — лёгкое «опускание» (scale) брошенной карточки;
 *  соседям, которые просто сдвинулись, — без него. Прерывает текущую анимацию элемента: `left/top` вызывающий берёт
 *  из видимого положения (с учётом transform), поэтому движение продолжается с того места, где элемент виден.
 *  `delay` (мс) — старт позже (волна карточек при массовой смене статуса): до старта элемент стоит в начальной точке.
 *  Обещание — конец движения (сразу, если двигать нечего). */
export function flipFrom(el: HTMLElement, left: number, top: number, { lift = true, delay = 0, last }: { lift?: boolean; delay?: number; last?: Pick<DOMRect, "left" | "top"> } = {}): Promise<void> {
  if (motionReduced() || typeof el.animate !== "function") return Promise.resolve();
  const e = ready();
  track(el, null);
  const target = last ?? el.getBoundingClientRect();
  // Координаты viewport → CSS px элемента: под zoom (корневой 1.1 на ≥ 2560 px) translate умножается на него.
  const z = cssZoom(el);
  const dx = (left - target.left) / z;
  const dy = (top - target.top) / z;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return Promise.resolve();
  const from = `translate(${dx}px, ${dy}px)${lift ? " scale(1.035)" : ""}`;
  // До отложенного старта элемент уже должен стоять в начальной точке, а не на новом месте.
  if (delay > 0) el.style.transform = from;
  const c = safe(() =>
    e
      ? track(el, e.animate(el, { transform: [from, "translate(0px, 0px)"] }, { type: e.spring, ...SPRING, ...(delay > 0 ? { delay: delay / 1000 } : {}) }), ["transform"])
      : track(el, el.animate([{ transform: from }, { transform: "none" }], { duration: 300, delay, fill: "backwards", easing: "cubic-bezier(0.16, 1, 0.3, 1)" }), ["transform"]),
  );
  return done(c);
}
/** Итоговый CSS zoom элемента (currentCSSZoom: Chrome 128 / Firefox 126 / Safari 18.2; без него — 1, как ds/floating). */
export const cssZoom = (el: Element): number => (el as Element & { currentCSSZoom?: number }).currentCSSZoom || 1;
/** Конец анимации (и отмена — тоже конец): обещание никогда не отклоняется. */
const done = (c: Controls | null): Promise<void> => (c ? Promise.resolve(c.finished).then(() => undefined, () => undefined) : Promise.resolve());

/** Появление на пружине. `kind`: `rise` — карточка/строка (подъём 8 px, как было у доски); `dialog` — окно
 *  (подъём без масштаба: scale в хвосте пружины меняет getBoundingClientRect содержимого, а e2e меряет размеры сразу после показа); `panel` — боковая панель (выезд справа, как `dsPanelIn`);
 *  `toast` — тост (выезд справа, как `toastIn`). У всех видов последний кадр — `transform: none`: motion по концу
 *  пишет его в inline-стиль (CSSOM), а не-`none` transform сделал бы окно контейнером для fixed-потомков.
 *  Чанк не загружен или движение уменьшено — мгновенно. */
type EnterKind = "rise" | "dialog" | "panel" | "toast" | "pop";
const ENTER_FRAMES: Record<EnterKind, { opacity: [number, number]; transform: [string, string] }> = {
  rise: { opacity: [0, 1], transform: ["translateY(8px) scale(0.98)", "none"] },
  dialog: { opacity: [0, 1], transform: ["translateY(10px)", "none"] },
  panel: { opacity: [0.4, 1], transform: ["translateX(32px)", "none"] },
  toast: { opacity: [0, 1], transform: ["translateX(28px)", "none"] },
  pop: { opacity: [0.5, 1], transform: ["scale(0.55)", "none"] },
};
/** Бейдж «подпрыгивает» заметнее остального: больше перелёт. */
export const SPRING_POP = { visualDuration: 0.25, bounce: 0.3 } as const; // ≤ 500 мс успокоения (проверяет motion.test.ts)
export function enter(el: HTMLElement, kind: EnterKind = "rise"): void {
  if (motionReduced() || typeof el.animate !== "function") return;
  const e = ready();
  if (!e) return;
  safe(() => track(el, e.animate(el, ENTER_FRAMES[kind], { type: e.spring, ...(kind === "pop" ? SPRING_POP : SPRING_ENTER) }), ["opacity", "transform"]));
}

/** Уход: обещание, после которого вызывающий снимает элемент. Движение уменьшено, чанка нет или ошибка — сразу.
 *  `toast` уходит вправо (откуда пришёл), остальное — вниз на 4 px. */
export function exit(el: HTMLElement, kind: "rise" | "toast" = "rise"): Promise<void> {
  if (motionReduced() || typeof el.animate !== "function") return Promise.resolve();
  const e = ready();
  if (!e) return Promise.resolve();
  const transform = kind === "toast" ? ["none", "translateX(24px)"] : ["translateY(0px)", "translateY(4px)"];
  return done(safe(() => track(el, e.animate(el, { opacity: [1, 0], transform }, EXIT))));
}

/** Счётчик (COV-01): число на `el` «дорастает» от `from` до `to` за --dur-4 (300 мс, ease-out, без перелёта: цифры не
 *  должны уходить выше итога). Текст элемента — итоговое число — не трогается вообще: кадры пишутся только в атрибут
 *  `data-shown`, а видимой его делает CSS (`.count-up[data-counting]::after { content: attr(data-shown) }`). Поэтому
 *  `textContent` и дерево доступности всё время содержат итог, а читатель с экрана и одноразовые чтения e2e не видят
 *  промежуточных значений. Кадры — `requestAnimationFrame`, без React-состояния. Движение уменьшено или нечего расти —
 *  ничего не делает (итог уже на экране). Возвращает отмену (снимает атрибуты и кадр; безопасно вызывать повторно). */
export const COUNT_MS = 300;
export function countTo(el: HTMLElement, from: number, to: number, format: (n: number) => string = String): () => void {
  if (motionReduced() || typeof requestAnimationFrame !== "function" || !(to > from) || !Number.isFinite(to - from)) return () => undefined;
  let raf = 0;
  let t0: number | null = null;
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    el.removeAttribute("data-counting");
    el.removeAttribute("data-shown");
  };
  const frame = (now: number) => {
    t0 ??= now;
    const p = Math.min(1, (now - t0) / COUNT_MS);
    if (p >= 1) return stop();
    el.setAttribute("data-shown", format(Math.round(from + (to - from) * (1 - (1 - p) ** 3))));
    raf = requestAnimationFrame(frame);
  };
  el.setAttribute("data-shown", format(from));
  el.setAttribute("data-counting", "");
  raf = requestAnimationFrame(frame);
  return stop;
}

/** Короткая подсветка элемента, у которого сменилось значение (статус, приоритет, срок): акцентная заливка гаснет за
 *  300 мс (--dur-4). Только цвет фона (WAAPI, ADR-0010) — без transform, раскладку не трогает. Движение уменьшено — ничего. */
const flashing = new WeakMap<HTMLElement, Animation>();
export function flash(el: HTMLElement): void {
  if (motionReduced() || typeof el.animate !== "function") return;
  // Повторная смена значения заменяет подсветку, а не накладывает ещё одну (отдельно от `track`: тот ведёт transform).
  flashing.get(el)?.cancel();
  const a = safe(() => el.animate([{ backgroundColor: "color-mix(in oklch, var(--accent-solid) 22%, transparent)" }, { backgroundColor: "transparent" }], { duration: 300, easing: "ease-out" }));
  if (a) {
    flashing.set(el, a);
    const forget = () => { if (flashing.get(el) === a) flashing.delete(el); };
    a.addEventListener("finish", forget);
    a.addEventListener("cancel", forget);
  }
}

/** Плавное изменение ширины панели (сворачивание/разворачивание сайдбара: другая разметка, тот же «корпус»). Ширина —
 *  WAAPI по `width` (не transform: панель — часть раскладки, содержимое рядом едет вместе с ней); пружина `SPRING` при
 *  загруженном чанке, иначе кривая 300 мс (--dur-4). Ничего не делает при reduced-motion или одинаковых значениях. */
export function glideWidth(el: HTMLElement, from: number, to: number): void {
  if (motionReduced() || typeof el.animate !== "function" || Math.abs(from - to) < 1) return;
  const e = ready();
  const frames = { width: [`${from}px`, `${to}px`] };
  safe(() => track(el, e ? e.animate(el, frames, { type: e.spring, ...SPRING }) : el.animate(frames, { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }), ["width"]));
}

/** Снять текущую анимацию элемента (например, пружину появления окна, когда оно уже закрывается: WAAPI из скрипта
 *  перекрывал бы CSS-анимацию ухода). */
export function stopMotion(el: Element): void {
  track(el, null);
}

/** Чанк — на простое после первого экрана (для мест вне доски: тосты, окна, вкладки, строки списка). Возвращает отмену. */
export function preloadMotionIdle(): () => void {
  if (motionReduced()) return () => undefined;
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(() => void preloadMotion(), { timeout: 2000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(() => void preloadMotion(), 500);
  return () => window.clearTimeout(id);
}

/** «Перелетающий» индикатор вкладок: один элемент, место и размер — CSSOM (`style.width/height/transform`,
 *  ADR-0010), движение от прежнего места — пружина по transform (`translate` + `scaleX`, transform-origin слева задаёт
 *  CSS). Первое размещение, `animate: false`, reduced-motion или чанк не загружен — мгновенно. Прерывание стартует с
 *  видимого места идущей пружины, а не с прошлой цели. */
export type GlideBox = { x: number; y: number; w: number; h: number };
const glided = new WeakMap<HTMLElement, GlideBox>();
export function glideTo(el: HTMLElement, to: GlideBox, { animate = true }: { animate?: boolean } = {}): void {
  let prev = glided.get(el);
  if (prev && running.has(el)) {
    const m = /matrix\(([^)]+)\)/.exec(safe(() => getComputedStyle(el).transform) || "");
    if (m) {
      const [a, , , , tx, ty] = m[1].split(",").map(Number);
      if ([a, tx, ty].every(Number.isFinite)) prev = { x: tx, y: ty, w: prev.w * a, h: prev.h };
    }
  }
  glided.set(el, to);
  track(el, null);
  const at = `translate(${to.x}px, ${to.y}px)`;
  el.style.width = `${to.w}px`;
  el.style.height = `${to.h}px`;
  el.style.transform = at;
  if (!animate || !prev || !to.w || motionReduced() || typeof el.animate !== "function") return;
  if (Math.abs(prev.x - to.x) < 0.5 && Math.abs(prev.y - to.y) < 0.5 && Math.abs(prev.w - to.w) < 0.5) return;
  const e = ready();
  if (!e) return;
  const from = `translate(${prev.x}px, ${prev.y}px) scaleX(${prev.w / to.w})`;
  safe(() => track(el, e.animate(el, { transform: [from, `${at} scaleX(1)`] }, { type: e.spring, ...SPRING })));
}
