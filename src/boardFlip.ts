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
let snap: { root: HTMLElement; at: number; pos: Map<string, Pos>; lifted: string | null; landing: Pos | null; dead?: boolean } | null = null;
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
 *  может идти дольше `TTL_MS`. Поэтому возраст снимка отсчитываем от ответа и даём ещё `RENEW_EXTRA_MS` на перечитывание.
 *  Положения не менялись (прокрутка и так гасит снимок). */
const RENEW_EXTRA_MS = 7000;
export function renewBoardFlip(owner: object | null): void {
  if (owner && snap === owner) snap.at = performance.now() + RENEW_EXTRA_MS;
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
