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
import { cssZoom, flipFrom, motionReduced, preloadMotion } from "./motion";

const TTL_MS = 3000;
/** Больше — мгновенно: не гоняем сотни WAAPI-анимаций разом (VDI, ADR-0035 «Последствия»). */
const MAX_ANIMATED = 40;
const SELECTOR = "article[data-issue-id]";

type Pos = { left: number; top: number };
/** `landing` — точка, откуда прилетает брошенная карточка; применяется, только когда карточка действительно сменила
 *  место (до ответа сервера она стоит на старом, и коммиты в это время не должны её никуда «возвращать»). */
let snap: { root: HTMLElement; at: number; pos: Map<string, Pos>; lifted: string | null; landing: Pos | null; dead?: boolean; renewed?: boolean } | null = null;
let landing: { id: string; left: number; top: number } | null = null;
let scrollWatch = false;

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
  if (!root || motionReduced()) return null;
  void preloadMotion();
  const pos = new Map<string, Pos>();
  for (const el of root.querySelectorAll<HTMLElement>(SELECTOR)) pos.set(el.dataset.issueId!, layoutOf(el, visible(el)));
  const own = { root, at: performance.now(), pos, lifted: movedId, landing: l && movedId && l.id === movedId ? { left: l.left, top: l.top } : null };
  snap = own;
  if (!scrollWatch) {
    scrollWatch = true;
    // Прокрутка делает положения во viewport неверными, но снимок не стираем: `flipPending` по-прежнему отличает
    // перенос от новой задачи (иначе перенесённая карточка проиграла бы `enter`), а проигрыш просто пропускается.
    // Только прокрутка доски или страницы (цель — внутри корня снимка или содержит его): модалка и боковые панели
    // положений карточек не меняют.
    document.addEventListener(
      "scroll",
      (e) => {
        const t = e.target;
        if (snap && (t === document || (t instanceof Node && (snap.root.contains(t) || t.contains(snap.root))))) snap.dead = true;
      },
      { capture: true, passive: true },
    );
  }
  return own;
}

/** Перенос или создание отклонены сервером: его снимок (`owner` — результат `snapshotBoard`) больше не нужен, иначе чужой
 *  коммит анимировался бы от него. Снимок другого, более позднего переноса остаётся. */
export function cancelBoardFlip(owner: object | null): void {
  if (snap === owner) snap = null; // чужой (более поздний) снимок не трогаем
}

/** Массовая операция принята сервером: карточки сменят колонку только после перечитывания списка (второй запрос), а он
 *  может идти дольше `TTL_MS`. Возраст снимка сдвигается вперёд на `RENEW_AHEAD_MS` от ответа, поэтому полное окно
 *  после ответа — `TTL_MS + RENEW_AHEAD_MS` (≈ 10 с). Цена окна: посторонняя перезагрузка списка в эти секунды (например,
 *  по WebSocket) может сыграть перелёт от этого снимка, если положения карточек изменились; поэтому после первого
 *  коммита с переездом такой снимок закрывается (`playBoardFlip`). Карточка, которой не было в снимке (создана другим
 *  пользователем), к переезду не относится: `flipPending` для неё ложен, и она появляется обычным `enter`.
 *  Положения не менялись (прокрутка и так гасит снимок). */
const RENEW_AHEAD_MS = 7000;
export function renewBoardFlip(owner: object | null): void {
  if (owner && snap === owner) {
    snap.at = performance.now() + RENEW_AHEAD_MS;
    snap.renewed = true;
  }
}

/** Есть ли для карточки снимок (тогда её появление — перенос, а не новая задача). */
export function flipPending(id: string): boolean {
  return !!snap && snap.pos.has(id) && performance.now() - snap.at < TTL_MS;
}

/** После коммита колонки: всё, что сдвинулось относительно снимка, едет пружиной со старого места. */
export function playBoardFlip(): void {
  const s = snap;
  if (!s) return;
  if (s.dead || performance.now() - s.at > TTL_MS || !s.root.isConnected) {
    snap = null;
    return;
  }
  const moved: { el: HTMLElement; from: Pos; to: Pos; id: string; seen: boolean }[] = [];
  const vh = window.innerHeight;
  const seen = (p: Pos) => p.top > -200 && p.top < vh + 200;
  for (const el of s.root.querySelectorAll<HTMLElement>(SELECTOR)) {
    const id = el.dataset.issueId!;
    const prev = s.pos.get(id);
    if (!prev) continue;
    const v = visible(el);
    const to = layoutOf(el, v);
    if (Math.abs(to.left - prev.left) < 0.5 && Math.abs(to.top - prev.top) < 0.5) continue;
    // Видимое место до смены DOM = прежнее место в раскладке + текущий сдвиг анимации (0, если карточка стояла):
    // так прерванная пружина продолжается с того места, где карточку видно, без скачка.
    let from = { left: prev.left + (v.left - to.left), top: prev.top + (v.top - to.top) };
    if (id === s.lifted && s.landing) {
      from = s.landing;
      s.landing = null;
    }
    moved.push({ el, from, to, id, seen: seen(prev) || seen(to) });
  }
  if (!moved.length) return;
  const animate = moved.length <= MAX_ANIMATED;
  for (const m of moved) {
    if (animate && m.seen) {
      const lift = m.id === s.lifted;
      // Перенесённая карточка (с «подъёмом» — scale) и всё, что меняет колонку, летит над доской: тело колонки
      // прокручивается и обрезало бы её по краям; соседи едут только по вертикали внутри своей колонки.
      if (lift || Math.abs(m.to.left - m.from.left) > 4) fly(m.el, m.from, m.to, lift);
      else void flipFrom(m.el, m.from.left, m.from.top, { lift });
    }
    s.pos.set(m.id, m.to);
  }
  // Продлённый снимок (массовая операция) нужен ровно для первого коммита с переездом: после него окно закрываем,
  // чтобы чужие изменения доски в оставшиеся секунды не анимировались от устаревших положений.
  if (s.renewed) snap = null;
}

/** Перелёт в другую колонку: тело колонки прокручивается (overflow) и обрезало бы карточку, пока она снаружи.
 *  Поэтому летит копия в фиксированном слое поверх доски (как «призрак» перетаскивания — `.drag-ghost`), а сама
 *  карточка на новом месте скрыта до посадки. Место, размеры и стили копии — CSSOM, движение — WAAPI (ADR-0010). */
const flights = new WeakMap<HTMLElement, () => void>();
function fly(el: HTMLElement, from: Pos, to: Pos, lift: boolean): void {
  flights.get(el)?.();
  // Стили слоя и скрытие карточки — CSSOM (разрешён CSP, ADR-0010), без нового CSS: бюджет CSS исчерпан.
  const wrap = document.createElement("div");
  wrap.className = "flip-flight";
  Object.assign(wrap.style, { position: "fixed", zIndex: "40", pointerEvents: "none" });
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
  const land = () => {
    if (landed) return;
    landed = true;
    window.clearTimeout(guard);
    wrap.remove();
    el.style.visibility = visibility;
    flights.delete(el);
  };
  flights.set(el, land);
  void flipFrom(clone, from.left, from.top, { lift }).then(land);
  // Страховка: что бы ни случилось с анимацией, карточка не останется скрытой.
  guard = window.setTimeout(land, 1000);
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
