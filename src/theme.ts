/** Тема оформления и фон рабочей области.
 *  Хранится только локально (localStorage), между устройствами не синхронизируется.
 *  См. ticket-theme-background-home-logo.md §3–4. */

export type ThemeMode = "system" | "light" | "dark";

const THEME_KEY = "taskira.theme";
const BG_KEY = "taskira.bg";

/** Пресеты фона рабочей области — свой оттенок для светлой и тёмной темы
 *  (один пастельный тон читается по-разному на светлом/тёмном). Мягкие,
 *  в тон остальной палитры, без кислотных цветов. */
export const BG_PRESETS: { id: string; name: string; light: string; dark: string }[] = [
  { id: "default", name: "Стандартный", light: "#f1f3f7", dark: "#161a20" },
  { id: "cool", name: "Прохладный", light: "#edf2f9", dark: "#141922" },
  { id: "mint", name: "Мятный", light: "#eef5f0", dark: "#141d18" },
  { id: "sand", name: "Песочный", light: "#f5f2ec", dark: "#1b1a15" },
  { id: "slate", name: "Графит", light: "#eceef2", dark: "#191b21" },
  { id: "lavender", name: "Лавандовый", light: "#f1f0f8", dark: "#181722" },
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

/** Ставит data-theme и --bg-preset на <html>. Дёргается на старте и при смене. */
export function applyTheme(mode: ThemeMode = readTheme(), bgId: string = readBgId()): void {
  const eff = effectiveTheme(mode);
  const root = document.documentElement;
  root.setAttribute("data-theme", eff);
  const preset = BG_PRESETS.find((p) => p.id === bgId) ?? BG_PRESETS[0];
  root.style.setProperty("--bg-preset", eff === "dark" ? preset.dark : preset.light);
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    if (mode === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* приватный режим — просто не сохранится */
  }
  applyTheme(mode, readBgId());
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
      if (readTheme() === "system") applyTheme("system", readBgId());
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  } catch {
    return () => {};
  }
}
