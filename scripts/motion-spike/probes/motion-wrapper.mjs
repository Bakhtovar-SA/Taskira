// ADR-0035 — прототип обёртки src/motion/index.ts, проверяемый спайком под production CSP.
// Публичная поверхность — три функции и выключатель; сама библиотека — ленивый чанк motion-engine.
// Пока чанк не загружен или движение уменьшено, всё происходит мгновенно (никаких «догоняющих» анимаций).
// Все записи стилей — через WAAPI (el.animate внутри motion/mini): CSSOM, разрешено CSP (ADR-0010).

/** Пружина на токенах: visualDuration = --dur-4 (300 мс) — «видимая» длительность, хвост успокоения длиннее. */
export const SPRING = { visualDuration: 0.3, bounce: 0.15 };
/** Уход быстрее появления: --dur-3 (200 мс), без пружины. */
export const EXIT = { duration: 0.2, ease: [0.4, 0, 1, 1] };

let engine = null;
let loading = null;
let userReduced = false;
const media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

/** Глобальный выключатель «Уменьшить движение» из личных настроек (поверх системного). */
export function setReducedMotion(value) {
  userReduced = value;
}
export function motionReduced() {
  return userReduced || !!media?.matches;
}
/** Грузит чанк заранее (на простое после первого экрана), чтобы первая анимация не была мгновенной. */
export function preloadMotion() {
  loading ??= import("./motion-engine.mjs").then((m) => (engine = m));
  return loading;
}
function ready() {
  if (motionReduced()) return null;
  if (!engine) void preloadMotion();
  return engine;
}

/**
 * FLIP: снимок позиций до изменения DOM → функция «проиграть» после изменения (в React — из useLayoutEffect).
 * Ключ элемента — data-flip. Позиция с учётом текущего transform, поэтому прерванная анимация продолжается
 * с того места, где элемент виден сейчас, а не прыгает.
 */
export function flipSnapshot(container, selector = "[data-flip]") {
  const first = new Map();
  for (const el of container.querySelectorAll(selector)) first.set(el.dataset.flip, el.getBoundingClientRect());
  return function play() {
    const e = ready();
    if (!e) return [];
    const out = [];
    for (const el of container.querySelectorAll(selector)) {
      const a = first.get(el.dataset.flip);
      if (!a) continue;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      out.push(e.animate(el, { transform: [`translate(${dx}px, ${dy}px)`, "translate(0px, 0px)"] }, { type: e.spring, ...SPRING }));
    }
    return out;
  };
}

/** Появление: прозрачность + небольшой подъём на пружине. При уменьшенном движении — мгновенно. */
export function enter(el) {
  const e = ready();
  if (!e) return null;
  return e.animate(el, { opacity: [0, 1], transform: ["translateY(6px)", "translateY(0px)"] }, { type: e.spring, ...SPRING });
}

/** Уход: обещание, после которого вызывающий удаляет элемент. При уменьшенном движении — сразу. */
export function exit(el) {
  const e = ready();
  if (!e) return Promise.resolve();
  return e.animate(el, { opacity: [1, 0], transform: ["translateY(0px)", "translateY(4px)"] }, EXIT).finished;
}
