/** ADR-0035 (Accepted, прототип): FLIP карточек доски после переноса или перестановки.
 *
 *  Доска переносит карточку только после ответа сервера, а карточка при смене колонки — новый элемент в другой
 *  колонке. Поэтому снимок положений делается в момент намерения (`snapshotBoard` из `moveOnBoard`), а
 *  проигрывается после каждого коммита колонок (`playBoardFlip` из layout-эффекта `ColumnCards`, который и так
 *  перерисовывается при смене строк) — ни одного нового состояния React и ни одной лишней перерисовки (ADR-0011).
 *  Все записи стилей — WAAPI внутри `flipFrom` (ADR-0010).
 *
 *  Снимок живёт до `TTL_MS` и сбрасывается прокруткой (положения во viewport при прокрутке врут). Повторный проигрыш
 *  идемпотентен: после анимации карточка запоминает новое место, и следующий коммит без сдвига её не трогает. */
import { cssZoom, flash, flipFrom, motionReduced, preloadMotion, stopMotion } from "./motion";

const TTL_MS = 3000;
/** Больше — мгновенно: не гоняем сотни WAAPI-анимаций разом (VDI, ADR-0035 «Последствия»). */
const MAX_ANIMATED = 40;
/** Волна карточек при массовой смене статуса: шаг между соседями и потолок на всю волну (быстро, не очередь). */
const WAVE_STEP_MS = 45;
const WAVE_TOTAL_MS = 220;
const SELECTOR = "article[data-issue-id]";

type Pos = { left: number; top: number };
/** `landing` — точка, откуда прилетает брошенная карточка; применяется, только когда карточка действительно сменила
 *  место (до ответа сервера она стоит на старом, и коммиты в это время не должны её никуда «возвращать»). */
type Snap = { root: HTMLElement; at: number; pos: Map<string, Pos>; lifted: string | null; landing: Pos | null; dead?: boolean; renewed?: boolean };
const snaps = new Set<Snap>();
const MAX_SNAPSHOTS = 4;
let landing: { id: string; left: number; top: number } | null = null;
let scrollWatch = false;

function stopScrollWatch(): void {
  if (snaps.size || !scrollWatch) return;
  document.removeEventListener("scroll", onScroll, true);
  scrollWatch = false;
}
function pruneSnapshots(): void {
  const now = performance.now();
  for (const s of snaps) if (s.dead || now - s.at >= TTL_MS || !s.root.isConnected) snaps.delete(s);
  for (const flight of flights.values()) if (!flight.root.isConnected) flight.cancel();
  stopScrollWatch();
}
function onScroll(event: Event): void {
  const target = event.target;
  for (const s of snaps) {
    if (target === document || target instanceof Node && (s.root.contains(target) || target.contains(s.root))) s.dead = true;
  }
  pruneSnapshots();
}


/** Куда отпустили «призрак» при перетаскивании: брошенная карточка прилетает отсюда, а не со старого места. */
export function noteLanding(id: string, left: number, top: number): void {
  landing = Number.isFinite(left) && Number.isFinite(top) ? { id, left, top } : null;
}

/** Видимое положение (getBoundingClientRect уже включает текущий transform). */
const visible = (el: Element): DOMRect => el.getBoundingClientRect();
/** Положение в раскладке — видимое без текущего transform (translate пружины, scale «приземления» `dropLand`;
 *  transform-origin — центр), без отмены анимаций и лишних пересчётов. translate — в CSS px, под zoom умножается. */
const layoutOf = (el: Element, v: DOMRect): Pos => {
  const m = /matrix(3d)?\(([^)]+)\)/.exec(getComputedStyle(el).transform || "");
  if (!m) return { left: v.left, top: v.top };
  // 2D: matrix(a, b, c, d, e, f); 3D: matrix3d(a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1) — нужны a, d и сдвиг e, f.
  const n = m[2].split(",").map(Number);
  const [a, d, e, f] = m[1] ? [n[0], n[5], n[12], n[13]] : [n[0], n[3], n[4], n[5]];
  const z = cssZoom(el);
  const w = v.width / (a || 1);
  const h = v.height / (d || 1);
  return { left: v.left + (v.width - w) / 2 - (e || 0) * z, top: v.top + (v.height - h) / 2 - (f || 0) * z };
};

/** Снимок положений всех карточек доски — до того, как стор применит перенос.
 *  `movedId` — переносимая карточка (летит с «подъёмом» и, если её бросили, из точки броска); `null` — снимок перед
 *  созданием задачи: соседи расступаются, новая карточка появляется сама (`enter`). */
export function snapshotBoard(root: HTMLElement | null, movedId: string | null): object | null {
  const l = landing;
  landing = null;
  pruneSnapshots();
  if (!root?.isConnected || motionReduced()) return null;
  void preloadMotion();
  const pos = new Map<string, Pos>();
  for (const el of root.querySelectorAll<HTMLElement>(SELECTOR)) pos.set(el.dataset.issueId!, layoutOf(el, visible(el)));
  const own: Snap = { root, at: performance.now(), pos, lifted: movedId, landing: l && movedId && l.id === movedId ? { left: l.left, top: l.top } : null };
  snaps.add(own);
  if (snaps.size > MAX_SNAPSHOTS) snaps.delete(snaps.values().next().value!);
  if (!scrollWatch) {
    scrollWatch = true;
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  }
  return own;
}

/** Отказ удаляет только снимок и перелёты данного запроса. Чужие переносы продолжаются. */
export function cancelBoardFlip(owner: object | null): void {
  if (owner) snaps.delete(owner as Snap);
  for (const flight of flights.values()) if (flight.owner === owner) flight.cancel();
  pruneSnapshots();
}

/** Уход с конкретной доски: снимаем все её снимки, копии, страховочные таймеры и слушатель без живых снимков. */
export function clearBoardFlip(root: HTMLElement | null): void {
  for (const s of snaps) if (s.root === root) snaps.delete(s);
  for (const flight of flights.values()) if (flight.root === root) flight.cancel();
  pruneSnapshots();
}

/** Массовый перенос продлевает только свой снимок на время перечитывания списка.
 * После первого относящегося к нему коммита с переездом продлённый снимок закрывается. */
const RENEW_AHEAD_MS = 7000;
export function renewBoardFlip(owner: object | null): void {
  pruneSnapshots();
  if (owner && snaps.has(owner as Snap)) {
    const s = owner as Snap;
    s.at = performance.now() + RENEW_AHEAD_MS;
    s.renewed = true;
  }
}

/** Появление карточки из любого живого снимка — перенос, а не новая задача. */
export function flipPending(id: string): boolean {
  pruneSnapshots();
  return [...snaps].some(s => s.pos.has(id));
}

/** Один обход карточек каждого корня. Место — из самого раннего снимка; подъём/точка броска — своего запроса. */
export function playBoardFlip(): void {
  pruneSnapshots();
  const roots = new Set([...snaps].map(s => s.root));
  for (const root of roots) {
    const live = [...snaps].filter(s => s.root === root);
    const moved: { el: HTMLElement; from: Pos; to: Pos; id: string; seen: boolean; owner: Snap }[] = [];
    const vh = window.innerHeight;
    const seen = (p: Pos) => p.top > -200 && p.top < vh + 200;
    for (const el of root.querySelectorAll<HTMLElement>(SELECTOR)) {
      const id = el.dataset.issueId!;
      const first = live.find(s => s.pos.has(id));
      const prev = first?.pos.get(id);
      if (!prev || !first) continue;
      let owner = first;
      // Личный перенос имеет свою точку броска; массовый — свой продлённый снимок.
      for (const s of live) if (s.renewed && s.pos.has(id)) owner = s;
      for (const s of live) if (s.lifted === id) owner = s;
      const v = visible(el);
      const to = layoutOf(el, v);
      if (Math.abs(to.left - prev.left) < 0.5 && Math.abs(to.top - prev.top) < 0.5) continue;
      let from = { left: prev.left + (v.left - to.left), top: prev.top + (v.top - to.top) };
      if (id === owner.lifted && owner.landing) {
        from = owner.landing;
        owner.landing = null;
      }
      moved.push({ el, from, to, id, seen: seen(prev) || seen(to), owner });
    }
    if (!moved.length) continue;
    const animate = moved.length <= MAX_ANIMATED;
    const waves = new Map(live.filter(s => s.renewed).map(s => [s,
      moved.filter(m => m.owner === s && Math.abs(m.to.left - m.from.left) > 4)
        .sort((a, b) => a.from.top - b.from.top || a.from.left - b.from.left),
    ]));
    const committed = new Set<Snap>();
    for (const m of moved) {
      if (animate && m.seen) {
        const wave = waves.get(m.owner) ?? [];
        const rank = wave.indexOf(m);
        const step = wave.length > 1 ? Math.min(WAVE_STEP_MS, WAVE_TOTAL_MS / (wave.length - 1)) : 0;
        const lift = m.id === m.owner.lifted || rank >= 0;
        if (lift || Math.abs(m.to.left - m.from.left) > 4) fly(root, m.owner, m.el, m.from, m.to, lift, rank >= 0 ? { delay: rank * step, z: wave.length - rank } : undefined);
        else void flipFrom(m.el, m.from.left, m.from.top, { lift });
      }
      // Ответы могут прийти в обратном порядке: ни один оставшийся снимок не должен повторить уже сыгранный сдвиг.
      for (const s of live) if (s.pos.has(m.id)) s.pos.set(m.id, m.to);
      committed.add(m.owner);
    }
    for (const s of committed) if (s.renewed) snaps.delete(s);
  }
  stopScrollWatch();
}

/** Перелёт в другую колонку: тело колонки прокручивается (overflow) и обрезало бы карточку, пока она снаружи.
 *  Поэтому летит копия в фиксированном слое поверх доски (как «призрак» перетаскивания — `.drag-ghost`), а сама
 *  карточка на новом месте скрыта до посадки. Место, размеры и стили копии — CSSOM, движение — WAAPI (ADR-0010). */
const flights = new Map<HTMLElement, { root: HTMLElement; owner: Snap; cancel: () => void }>();
function fly(root: HTMLElement, owner: Snap, el: HTMLElement, from: Pos, to: Pos, lift: boolean, wave?: { delay: number; z: number }): void {
  flights.get(el)?.cancel();
  // Стили слоя и скрытие карточки — CSSOM (разрешён CSP, ADR-0010), без нового CSS: бюджет CSS исчерпан.
  const wrap = document.createElement("div");
  wrap.className = "flip-flight";
  Object.assign(wrap.style, { position: "fixed", zIndex: String(40 + (wave?.z ?? 0)), pointerEvents: "none" });
  wrap.setAttribute("aria-hidden", "true");
  const clone = el.cloneNode(true) as HTMLElement;
  clone.className = clone.className.replace(/\banim-\S+/g, ""); // dropLand / вспышка копии не нужны: летит flipFrom
  clone.removeAttribute("id");
  for (const n of clone.querySelectorAll("[id]")) n.removeAttribute("id"); // дубли id (useId) на время полёта
  clone.removeAttribute("data-issue-id"); // J/K и FLIP ищут карточки по этому атрибуту — копия им не карточка
  clone.inert = true;
  clone.style.boxShadow = "var(--highlight-top), var(--elev-3)";
  wrap.appendChild(clone);
  document.body.appendChild(wrap);
  // Координаты viewport → CSS px слоя (корневой zoom на широких экранах умножает left/top/width).
  const z = cssZoom(wrap);
  clone.style.width = `${el.offsetWidth}px`; // ширина раскладки: rect включал бы scale «приземления»
  wrap.style.left = `${to.left / z}px`;
  wrap.style.top = `${to.top / z}px`;
  const visibility = el.style.visibility;
  el.style.visibility = "hidden";
  let landed = false;
  let guard = 0;
  const land = (completed = false) => {
    if (landed) return;
    landed = true;
    window.clearTimeout(guard);
    if (!completed) stopMotion(clone);
    wrap.remove();
    el.style.visibility = visibility;
    flights.delete(el);
    if (completed && root.isConnected && el.isConnected && root.contains(el) && getComputedStyle(el).visibility === "visible" && getComputedStyle(el).display !== "none" && !motionReduced()) flash(el);
  };
  flights.set(el, { root, owner, cancel: () => land() });
  void flipFrom(clone, from.left, from.top, wave && wave.delay > 0 ? { lift, delay: wave.delay } : { lift }).then(() => land(true), () => land());
  // Страховка: что бы ни случилось с анимацией, карточка не останется скрытой.
  guard = window.setTimeout(() => land(), 1000 + (wave?.delay ?? 0));
}

/** FIX-12 (трек N): после переноса клавишей (`M`) или из меню карточка — новый элемент в другой колонке, и фокус уходит
 *  на `body`. Возвращаем его на кнопку открытия карточки, как только новая карточка видна (при перелёте `fly` она скрыта
 *  до посадки: фокус на скрытый элемент не ставится). «Новая» — кнопка, отличная от старой (`stale`: кнопка карточки
 *  ДО начала переноса — её запоминает вызывающий до запроса, ответ сервера может прийти уже после отрисовки) и от
 *  `before` (элемент, державший фокус, например пункт меню): пока кнопка прежняя, перенос ещё не отрисован. Если фокус
 *  осознанно ушёл на что-то другое, не трогаем. Попытки — всего до ~1.2 с (сумма пауз), без состояния React. Возвращает отмену. */
const FOCUS_RETRY_MS = [30, 60, 120, 200, 300, 500]; // сумма пауз ≈ 1.2 с
export function restoreCardFocus(root: HTMLElement | null, id: string, before: Element | null, stale: Element | null, onDone?: () => void): () => void {
  const sel = `article[data-issue-id="${CSS.escape(id)}"] .board-card-open`;
  let timer = 0;
  let i = 0;
  const attempt = () => {
    const found = root?.isConnected ? root.querySelector<HTMLElement>(sel) : null;
    const btn = found && found !== stale && found !== before ? found : null;
    const active = document.activeElement;
    const lost = !active || active === document.body || active === before || active === stale;
    if (btn && active === btn) return onDone?.();
    if (btn && lost && getComputedStyle(btn).visibility !== "hidden") {
      btn.focus({ preventScroll: true });
      if (document.activeElement === btn) return onDone?.();
    } else if (!lost && !(active instanceof Element && active.closest(`article[data-issue-id="${CSS.escape(id)}"], [popover]`))) {
      return onDone?.(); // фокус осознанно ушёл в другое место
    }
    if (i < FOCUS_RETRY_MS.length) timer = window.setTimeout(attempt, FOCUS_RETRY_MS[i++]);
    else onDone?.();
  };
  timer = window.setTimeout(attempt, 0);
  return () => window.clearTimeout(timer);
}

/** NEW-02: «перенос отправлен». Доска ждёт ответа сервера до переноса (см. шапку файла); на медленном канале (VDI,
 *  300+ мс) карточка выглядела бы «не реагирующей». Через `PENDING_DELAY_MS` ставим на неё `data-pending` +
 *  `aria-busy` (стиль — приглушение и курсор `progress` в index.css, без анимации); быстрый ответ успевает раньше,
 *  и карточка не мигает. Без состояния React: отметка на DOM, поэтому остальные карточки не перерисовываются.
 *  Возвращает снятие отметки (идемпотентно). */
export const PENDING_DELAY_MS = 150;
export function markPending(root: HTMLElement | null, id: string): () => void {
  const sel = `article[data-issue-id="${CSS.escape(id)}"]`;
  const card = () => (root?.isConnected ? root.querySelector<HTMLElement>(sel) : null);
  const timer = window.setTimeout(() => {
    const el = card();
    if (!el) return;
    el.setAttribute("data-pending", "");
    el.setAttribute("aria-busy", "true");
  }, PENDING_DELAY_MS);
  return () => {
    window.clearTimeout(timer);
    const el = card();
    el?.removeAttribute("data-pending");
    el?.removeAttribute("aria-busy");
  };
}

/** Отметки «отправлено» доски: по одной на задачу. Повторный перенос той же карточки снимает прежнюю отметку и ставит
 *  свою; завершение устаревшего запроса чужую (текущую) отметку не трогает. `start` возвращает завершение запроса. */
export function createPendingMarks(getRoot: () => HTMLElement | null) {
  const marks = new Map<string, () => void>();
  return {
    start(id: string): () => void {
      marks.get(id)?.();
      const clear = markPending(getRoot(), id);
      marks.set(id, clear);
      return () => {
        if (marks.get(id) !== clear) return;
        marks.delete(id);
        clear();
      };
    },
    clearAll(): void {
      marks.forEach((clear) => clear());
      marks.clear();
    },
  };
}
