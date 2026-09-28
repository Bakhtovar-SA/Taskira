import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import ru, { type TKey } from "./ru";

export type { TKey };

export type Lang = "ru" | "en";
/* Английский словарь — отдельным чанком: его грузят только те, кто выбрал English (ТЗ 5.2, бюджет бандла).
 * main.tsx ждёт его до первой отрисовки, если язык уже сохранён, — вспышки русского текста нет. */
type Dict = Record<TKey, string>;
const DICTS: Partial<Record<Lang, Dict>> = { ru };
let enLoading: Promise<void> | null = null;
export function loadLang(l: Lang): Promise<void> {
  if (DICTS[l]) return Promise.resolve();
  enLoading ??= import("./en").then((m) => {
    DICTS.en = m.default;
  });
  return enLoading;
}
/** Язык из localStorage — для main.tsx, чтобы дождаться словаря до первой отрисовки. */
export const storedLang = (): Lang => readStoredLang();
const STORAGE_KEY = "taskira.lang";

function readStoredLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "ru";
  } catch {
    return "ru";
  }
}

type TParams = Record<string, string | number>;
type TFn = (key: TKey, params?: TParams) => string;
/** Числительное + правильная форма существительного из словаря: tn(5, "noun.issue.one", "noun.issue.few", "noun.issue.many"). */
type TnFn = (n: number, one: TKey, few: TKey, many: TKey) => string;

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
  tn: TnFn;
}

const Ctx = createContext<I18nCtx | null>(null);

function interpolate(s: string, params?: TParams): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);
  // Словарь выбранного языка ещё не пришёл (редкий случай: язык сменили только что) — пока русский, потом перерисуем.
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (!DICTS[lang]) void loadLang(lang).then(() => setLoaded((n) => n + 1));
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (l: Lang) => {
    // Сначала словарь, потом переключение — чтобы интерфейс не мигнул русским.
    void loadLang(l).then(() => setLangState(l));
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* приватный режим / заблокировано — язык просто не переживёт перезагрузку */
    }
  };

  const dict = DICTS[lang] ?? ru;
  const t = useMemo<TFn>(() => {
    return (key, params) => interpolate(dict[key] ?? ru[key], params);
  }, [dict]);

  const tn = useMemo<TnFn>(() => {
    return (n, one, few, many) => t(pluralForm(lang, n, [one, few, many]) as TKey);
  }, [lang, t]);

  const value = useMemo<I18nCtx>(() => ({ lang, setLang, t, tn }), [lang, t, tn]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useT() вызван вне <I18nProvider>");
  return ctx;
}

/** Infrastructure providers may be rendered in isolation by tests or embeds.
 * They can use Russian defaults when no app-level I18nProvider is present. */
export function useOptionalT(): I18nCtx | null {
  return useContext(Ctx);
}

/** Число → форма слова. RU: 1/2-4/5+ с исключением на 11-14 (стандартное
 *  правило); EN: единственное/множественное. Используется вместо локальных
 *  копий этой функции, ранее продублированных в Board.tsx и HomeView.tsx. */
export function pluralForm(lang: Lang, n: number, forms: [one: string, few: string, many: string]): string {
  if (lang === "en") return n === 1 ? forms[0] : forms[2];
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}
