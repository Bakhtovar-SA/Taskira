/** Тема оформления, атмосфера и текстура фона (ТЗ 5.4 / 5.14, ADR-0012).
 *  Хранится только локально (localStorage), между устройствами не синхронизируется.
 *
 *  Всё переключается атрибутами на <html>, а значения живут в
 *  src/styles/tokens.css — ни одного инлайн-стиля и ни одного CSS-правила,
 *  созданного в рантайме:
 *    data-theme      = light | dark        (+ режим «Как в системе»)
 *    data-atmosphere = violet | dusk | dawn | aurora | graphite
 *  Зерно фона убрано решением владельца 25.09.2026 (ADR-0016).
 */

export type ThemeMode = "system" | "light" | "dark";

const THEME_KEY = "taskira.theme";
const BG_KEY = "taskira.bg";

/** Атмосферные пресеты: меняют только свечение за рабочим пространством.
 *  Хром и акцент остаются фиолетовыми в любом из них. `swatch` — превью в
 *  настройках (градиент на кнопке выбора), по паре для светлой и тёмной темы. */
export const BG_PRESETS: { id: string; name: string; light: string; dark: string }[] = [
  {
    id: "default",
    name: "Фиалка",
    light: "linear-gradient(135deg, oklch(0.8 0.11 288), oklch(0.93 0.04 330))",
    dark: "linear-gradient(135deg, oklch(0.42 0.17 288), oklch(0.26 0.06 325))",
  },
  {
    id: "dusk",
    name: "Сумерки",
    light: "linear-gradient(135deg, oklch(0.72 0.14 300), oklch(0.8 0.12 340))",
    dark: "linear-gradient(135deg, oklch(0.45 0.2 300), oklch(0.36 0.15 340))",
  },
  {
    id: "dawn",
    name: "Рассвет",
    light: "linear-gradient(135deg, oklch(0.86 0.09 55), oklch(0.84 0.09 350))",
    dark: "linear-gradient(135deg, oklch(0.42 0.1 50), oklch(0.36 0.12 350))",
  },
  {
    id: "aurora",
    name: "Сияние",
    light: "linear-gradient(135deg, oklch(0.84 0.08 200), oklch(0.8 0.1 290))",
    dark: "linear-gradient(135deg, oklch(0.4 0.1 200), oklch(0.4 0.15 290))",
  },
  {
    id: "graphite",
    name: "Графит",
    light: "linear-gradient(135deg, oklch(0.9 0.01 288), oklch(0.96 0.005 288))",
    dark: "linear-gradient(135deg, oklch(0.3 0.015 288), oklch(0.2 0.012 288))",
  },
];

export function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function readBgId(): string {
  try {
    const v = localStorage.getItem(BG_KEY);
    return v && BG_PRESETS.some((p) => p.id === v) ? v : "default";
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
  return mode === "system" ? (prefersDark() ? "dark" : "light") : mode;
}

/** Ставит атрибуты темы и атмосферы на <html>. Дёргается на старте
 *  (после внешнего theme-init.js, который делает то же до загрузки CSS) и при
 *  каждом переключении в настройках. */
export function applyTheme(mode: ThemeMode = readTheme(), bgId: string = readBgId()): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", effectiveTheme(mode));
  const preset = BG_PRESETS.find((p) => p.id === bgId) ?? BG_PRESETS[0];
  if (preset.id === "default") root.removeAttribute("data-atmosphere");
  else root.setAttribute("data-atmosphere", preset.id);
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
  const before = document.documentElement.getAttribute("data-theme");
  if (!doc.startViewTransition || reducedMotion() || before === effectiveTheme(mode)) {
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

export function setThemeMode(mode: ThemeMode): void {
  watchPointer();
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
  applyTheme(readTheme(), id);
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
