/** Движение (ТЗ 5.13, ADR-0015): переходы навигации через View Transitions и FLIP на WAAPI.
 *  Всё прерываемо (новый startViewTransition отменяет прежний, новая анимация того же элемента — предыдущую),
 *  всё уважает prefers-reduced-motion.
 *
 *  ADR-0035 (Proposed, прототип на доске): пружины — ленивый чанк `motionEngine.ts` (`motion/mini` `animate` +
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

/** Личный выключатель «Уменьшить движение» поверх системного (localStorage, как тема). Интерфейса пока нет —
 *  прототип; включается `setReducedMotion(true)` или `localStorage["taskira.reduceMotion"] = "1"`. */
const REDUCE_KEY = "taskira.reduceMotion";
let userReduced: boolean | null = null;
export function setReducedMotion(on: boolean): void {
  userReduced = on;
  try {
    if (on) localStorage.setItem(REDUCE_KEY, "1");
    else localStorage.removeItem(REDUCE_KEY);
  } catch {
    /* приватное окно — выключатель живёт до перезагрузки */
  }
}
export function motionReduced(): boolean {
  if (userReduced === null) {
    try {
      userReduced = localStorage.getItem(REDUCE_KEY) === "1";
    } catch {
      userReduced = false;
    }
  }
  return userReduced || reducedMotion();
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
let loader: () => Promise<Engine> = () => import("./motionEngine");

/** Грузит чанк заранее (на простое после первого экрана доски), чтобы первая анимация уже была пружиной.
 *  Ошибка загрузки не бросается: движение остаётся мгновенным (повторная попытка — при следующем вызове). */
export function preloadMotion(): Promise<Engine | null> {
  if (motionReduced()) return Promise.resolve(engine);
  loading ??= loader().then(
    (m) => (engine = m),
    () => {
      loading = null;
      return null;
    },
  );
  return loading;
}
/** Только для тестов: подменить загрузчик чанка и сбросить состояние. */
export function __resetMotionForTests(load?: () => Promise<Engine>): void {
  engine = null;
  loading = null;
  userReduced = null;
  loader = load ?? (() => import("./motionEngine"));
}

function ready(): Engine | null {
  if (motionReduced()) return null;
  if (!engine) void preloadMotion();
  return engine;
}

/** Текущая анимация элемента — новая её отменяет (прерывание без наложения двух WAAPI на один transform). */
const running = new WeakMap<Element, Controls>();
function track(el: Element, c: Controls | null): Controls | null {
  running.get(el)?.cancel();
  if (c) {
    running.set(el, c);
    c.finished.then(
      () => running.get(el) === c && running.delete(el),
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
  if (!doc.startViewTransition || reducedMotion() || document.visibilityState !== "visible") {
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
 *  Обещание — конец движения (сразу, если двигать нечего). */
export function flipFrom(el: HTMLElement, left: number, top: number, { lift = true }: { lift?: boolean } = {}): Promise<void> {
  if (motionReduced() || typeof el.animate !== "function") return Promise.resolve();
  const e = ready();
  track(el, null);
  const last = el.getBoundingClientRect();
  // Координаты viewport → CSS px элемента: под zoom (корневой 1.1 на ≥ 2560 px) translate умножается на него.
  const z = cssZoom(el);
  const dx = (left - last.left) / z;
  const dy = (top - last.top) / z;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return Promise.resolve();
  const from = `translate(${dx}px, ${dy}px)${lift ? " scale(1.035)" : ""}`;
  const c = safe(() =>
    e
      ? track(el, e.animate(el, { transform: [from, "translate(0px, 0px)"] }, { type: e.spring, ...SPRING }))
      : track(el, el.animate([{ transform: from }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" })),
  );
  return done(c);
}
/** Итоговый CSS zoom элемента (currentCSSZoom: Chrome 128 / Firefox 126 / Safari 18.2; без него — 1, как ds/floating). */
export const cssZoom = (el: Element): number => (el as Element & { currentCSSZoom?: number }).currentCSSZoom || 1;
/** Конец анимации (и отмена — тоже конец): обещание никогда не отклоняется. */
const done = (c: Controls | null): Promise<void> => (c ? Promise.resolve(c.finished).then(() => undefined, () => undefined) : Promise.resolve());

/** Появление: прозрачность + небольшой подъём на пружине. Чанк не загружен или движение уменьшено — мгновенно. */
export function enter(el: HTMLElement): void {
  if (motionReduced()) return;
  const e = ready();
  if (!e) return;
  safe(() => track(el, e.animate(el, { opacity: [0, 1], transform: ["translateY(8px) scale(0.98)", "translateY(0px) scale(1)"] }, { type: e.spring, ...SPRING_ENTER })));
}

/** Уход: обещание, после которого вызывающий снимает элемент. Движение уменьшено, чанка нет или ошибка — сразу. */
export function exit(el: HTMLElement): Promise<void> {
  if (motionReduced()) return Promise.resolve();
  const e = ready();
  if (!e) return Promise.resolve();
  return done(safe(() => track(el, e.animate(el, { opacity: [1, 0], transform: ["translateY(0px)", "translateY(4px)"] }, EXIT))));
}
