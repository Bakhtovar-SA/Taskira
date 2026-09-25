/** Тема оформления, атмосфера и текстура фона (ТЗ 5.4 / 5.14, ADR-0012).
 *  Хранится только локально (localStorage), между устройствами не синхронизируется.
 *
 *  Всё переключается атрибутами на <html>, а значения живут в
 *  src/styles/tokens.css — ни одного инлайн-стиля и ни одного CSS-правила,
 *  созданного в рантайме:
 *    data-theme      = light | dark        (+ режим «Как в системе»)
 *    data-atmosphere = violet | dusk | dawn | aurora | graphite
 *    data-texture    = on | off            (зерно на холсте)
 */

export type ThemeMode = "system" | "light" | "dark";

const THEME_KEY = "taskira.theme";
const BG_KEY = "taskira.bg";
const TEXTURE_KEY = "taskira.texture";

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

/** Текстура фона включена по умолчанию; хранится только выключение. */
export function readTexture(): boolean {
  try {
    return localStorage.getItem(TEXTURE_KEY) !== "off";
  } catch {
    return true;
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

/** Ставит атрибуты темы/атмосферы/текстуры на <html>. Дёргается на старте
 *  (после внешнего theme-init.js, который делает то же до загрузки CSS) и при
 *  каждом переключении в настройках. */
export function applyTheme(mode: ThemeMode = readTheme(), bgId: string = readBgId(), texture: boolean = readTexture()): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", effectiveTheme(mode));
  const preset = BG_PRESETS.find((p) => p.id === bgId) ?? BG_PRESETS[0];
  if (preset.id === "default") root.removeAttribute("data-atmosphere");
  else root.setAttribute("data-atmosphere", preset.id);
  root.setAttribute("data-texture", texture ? "on" : "off");
  // До ТЗ 5.4 пресет фона писался инлайн-стилем --c-canvas на <html>; у
  // тех, кто открыл новую версию во вкладке со старой, он перебил бы токены.
  root.style.removeProperty("--c-canvas");
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    if (mode === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* приватный режим — просто не сохранится */
  }
  applyTheme(mode);
}

export function setBg(id: string): void {
  try {
    localStorage.setItem(BG_KEY, id);
  } catch {
    /* noop */
  }
  applyTheme(readTheme(), id);
}

export function setTexture(on: boolean): void {
  try {
    if (on) localStorage.removeItem(TEXTURE_KEY);
    else localStorage.setItem(TEXTURE_KEY, "off");
  } catch {
    /* noop */
  }
  applyTheme(readTheme(), readBgId(), on);
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
