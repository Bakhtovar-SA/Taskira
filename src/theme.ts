/** Тема оформления, атмосфера и текстура фона (ТЗ 5.4 / 5.14, ADR-0012).
 *  Хранится только локально (localStorage), между устройствами не синхронизируется.
 *
 *  Всё переключается атрибутами на <html>, а значения живут в
 *  src/styles/tokens.css — ни одного инлайн-стиля и ни одного CSS-правила,
 *  созданного в рантайме:
 *    data-theme      = light | dark        (+ режим «Как в системе»)
 *    data-skin       = dusk | graphite | dawn | paper   (курируемая тема поверх базовой)
 *    data-atmosphere = фон из BG_IDS (default — без атрибута)
 *  Зерно фона убрано решением владельца 25.09.2026 (ADR-0016).
 */

/** Темы (ТЗ 5.14 п.3): «Как в системе», базовые светлая и тёмная и четыре курируемые. Курируемая тема =
 *  базовая (data-theme) + переопределение семантического слоя (data-skin) в tokens.css. */
export const THEMES = ["system", "light", "dark", "dusk", "graphite", "dawn", "paper"] as const;
export type ThemeMode = (typeof THEMES)[number];
type Skin = "dusk" | "graphite" | "dawn" | "paper";
const SKIN_BASE: Record<Skin, "light" | "dark"> = { dusk: "dark", graphite: "dark", dawn: "light", paper: "light" };
const isSkin = (m: string): m is Skin => m in SKIN_BASE;

const THEME_KEY = "taskira.theme";
const BG_KEY = "taskira.bg";

/** Фоны (ТЗ 5.14 п.1): свечение и геометрия за рабочим листом. Значения — в tokens.css
 *  (`:root[data-atmosphere]` и `[data-atmo]` для плашки выбора), подписи — словарь `bg.<id>`.
 *  Первые пять id совпадают с сохранёнными у проектов до 5.14 (projects.background). */
export const BG_IDS = ["default", "dusk", "dawn", "aurora", "sea", "rose", "mint", "graphite", "plain", "grid", "dots", "rings", "prism", "lines"] as const;
export type BgId = (typeof BG_IDS)[number];
const isBg = (v: string | null | undefined): v is BgId => !!v && (BG_IDS as readonly string[]).includes(v);

export function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v && v !== "system" && (THEMES as readonly string[]).includes(v) ? (v as ThemeMode) : "system";
  } catch {
    return "system";
  }
}

export function readBgId(): string {
  try {
    const v = localStorage.getItem(BG_KEY);
    return isBg(v) ? v : "default";
  } catch {
    return "default";
  }
}

const prefersDark = (): boolean => {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
};

/** Фактическая тема с учётом режима «Системная». */
export function effectiveTheme(mode: ThemeMode = readTheme()): "light" | "dark" {
  return mode === "system" ? (prefersDark() ? "dark" : "light") : isSkin(mode) ? SKIN_BASE[mode] : mode;
}

/** Ставит атрибуты темы и атмосферы на <html>. Дёргается на старте
 *  (после внешнего theme-init.js, который делает то же до загрузки CSS) и при
 *  каждом переключении в настройках. */
/** Фон проекта (ТЗ 5.10/5.14): пока открыт проект со своим фоном, он перекрывает личный выбор человека. */
let projectBg: string | null = null;
export function setProjectBackground(id: string | null | undefined): void {
  const next = isBg(id) ? id : null;
  if (next === projectBg) return;
  projectBg = next;
  applyTheme();
}
export const projectBackground = (): string | null => projectBg;

export function applyTheme(mode: ThemeMode = readTheme(), bgId: string = projectBg ?? readBgId()): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", effectiveTheme(mode));
  if (isSkin(mode)) root.setAttribute("data-skin", mode);
  else root.removeAttribute("data-skin");
  if (!isBg(bgId) || bgId === "default") root.removeAttribute("data-atmosphere");
  else root.setAttribute("data-atmosphere", bgId);
  // До ТЗ 5.4 пресет фона писался инлайн-стилем --c-canvas на <html>; у
  // тех, кто открыл новую версию во вкладке со старой, он перебил бы токены.
  root.style.removeProperty("--c-canvas");
}

// Где человек нажал последний раз — отсюда раскрывается новая тема. Слушатель
// ставится при первой смене темы; для клавиатуры (палитра) берём центр сверху.
let lastPointer: { x: number; y: number; at: number } | null = null;
let pointerWatch = false;
const watchPointer = () => {
  if (pointerWatch || typeof document === "undefined") return;
  pointerWatch = true;
  document.addEventListener("pointerdown", (e) => (lastPointer = { x: e.clientX, y: e.clientY, at: Date.now() }), true);
};

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
};

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } };

/** Смена темы (ТЗ 5.13, навигационный слой): новая тема раскрывается кругом от
 *  точки нажатия через View Transitions, не дольше --dur-5 (450 мс). Без
 *  поддержки API и при reduced-motion — мгновенно, как раньше. Анимация идёт
 *  через WAAPI (разрешён CSP, ADR-0010), класс vt-theme ограничивает правила
 *  псевдоэлементов только этим переходом. */
function applyThemeAnimated(mode: ThemeMode): void {
  const doc = document as ViewTransitionDoc;
  const root0 = document.documentElement;
  const same = root0.getAttribute("data-theme") === effectiveTheme(mode) && (root0.getAttribute("data-skin") ?? "") === (isSkin(mode) ? mode : "");
  if (!doc.startViewTransition || reducedMotion() || same) {
    applyTheme(mode);
    return;
  }
  const recent = lastPointer && Date.now() - lastPointer.at < 1500 ? lastPointer : null;
  const x = recent?.x ?? window.innerWidth / 2;
  const y = recent?.y ?? 0;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const root = document.documentElement;
  root.classList.add("vt-theme");
  const vt = doc.startViewTransition(() => applyTheme(mode));
  vt.ready
    .then(() =>
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${Math.ceil(r)}px at ${x}px ${y}px)`] },
        { duration: 420, easing: "cubic-bezier(0.2, 0, 0, 1)", pseudoElement: "::view-transition-new(root)" },
      ),
    )
    .catch(() => undefined);
  vt.finished.finally(() => root.classList.remove("vt-theme")).catch(() => undefined);
}

/** Слушатель выбора темы человеком (онбординг, ТЗ 5.11: шаг «выбрать тему»; тема живёт только в браузере). */
let themeChosen: (() => void) | null = null;
export const onThemeChosen = (fn: (() => void) | null): void => {
  themeChosen = fn;
};

export function setThemeMode(mode: ThemeMode): void {
  watchPointer();
  themeChosen?.();
  try {
    if (mode === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* приватный режим — просто не сохранится */
  }
  applyThemeAnimated(mode);
}

export function setBg(id: string): void {
  try {
    localStorage.setItem(BG_KEY, id);
  } catch {
    /* noop */
  }
  applyTheme(readTheme(), projectBg ?? id);
}

/** Плотность интерфейса (ТЗ 5.7, ADR-0014 п. 3): data-density на <html>; до первой отрисовки её ставит
 *  public/theme-init.js. Только localStorage — как тема. */
export type Density = "comfortable" | "compact";
const DENSITY_KEY = "taskira.density";
export function readDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}
export function setDensity(d: Density): void {
  try {
    if (d === "compact") localStorage.setItem(DENSITY_KEY, d);
    else localStorage.removeItem(DENSITY_KEY);
  } catch {
    /* noop */
  }
  if (d === "compact") document.documentElement.setAttribute("data-density", d);
  else document.documentElement.removeAttribute("data-density");
}

/** Реагировать на смену системной темы, пока выбран режим «Системная». */
export function watchSystemTheme(): () => void {
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => {
      if (readTheme() === "system") applyTheme("system");
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  } catch {
    return () => {};
  }
}
