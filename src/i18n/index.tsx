import { createContext, lazy, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import ruCore from "./ruCore";
import type { TKey } from "./ru";
import { apiErrorText } from "./apiErrors";

export type { TKey };

export type Lang = "ru" | "en";
/* Английский словарь — отдельным чанком: его грузят только те, кто выбрал English (ТЗ 5.2, бюджет бандла).
 * main.tsx ждёт его до первой отрисовки, если язык уже сохранён, — вспышки русского текста нет. */
type Dict = Record<TKey, string>;
/* Русский словарь разделён: `ruCore` (ключи стартового графа) лежит в бандле, `ruLazy` (ключи ленивых экранов) —
 * отдельный чанк. Ленивые экраны открываются через `lazyView()` / `withRuLazy()`, которые дожидаются `ruLazy`
 * раньше самого экрана, так что `t()` в них не видит пропусков. Английский словарь полный. */
const DICTS: Partial<Record<Lang, Dict>> = {};
type PartialDict = Partial<Record<TKey, string>>;
let ruLazyDict: PartialDict | null = null;
let ruLazyLoading: Promise<void> | null = null;
const ruLazyListeners = new Set<() => void>();
/** Положить ленивую часть русского словаря в память (чанк загружен или тестовое окружение). */
export function registerRuLazy(d: PartialDict): void {
  ruLazyDict = d;
  ruLazyListeners.forEach((fn) => fn());
}
function subscribeRuLazy(fn: () => void): () => void {
  ruLazyListeners.add(fn);
  return () => void ruLazyListeners.delete(fn);
}
export function loadRuLazy(): Promise<void> {
  if (ruLazyDict) return Promise.resolve();
  ruLazyLoading ??= import("./ruLazy")
    .then((m) => registerRuLazy(m.default))
    .catch((err: unknown) => {
      // No retry here on purpose: Chromium keeps a failed module fetch for the lifetime of the page, so importing
      // the same chunk again fails at once without a request (checked in a browser test). Recovery is a page
      // reload, which the error boundary offers — the same as when a screen's own chunk fails to load.
      // The promise is dropped so that browsers which do allow a second fetch get one on the next call.
      ruLazyLoading = null;
      throw err;
    });
  return ruLazyLoading;
}
/** Обернуть динамический импорт экрана: модуль вернётся только когда русские строки ленивых экранов уже есть. */
export function withRuLazy<M>(factory: () => Promise<M>): () => Promise<M> {
  return () => Promise.all([factory(), readStoredLang() === "ru" ? loadRuLazy() : undefined]).then(([m]) => m);
}
/** `lazy()` для экрана вне стартового графа: см. `withRuLazy`. */
export function lazyView<C extends ComponentType<any>>(factory: () => Promise<{ default: C }>) {
  return lazy(withRuLazy(factory));
}

let enLoading: Promise<void> | null = null;
export function loadLang(l: Lang): Promise<void> {
  if (l === "ru") return loadRuLazy();
  if (DICTS[l]) return Promise.resolve();
  enLoading ??= import("./en")
    .then((m) => {
      DICTS.en = m.default;
    })
    .catch((err: unknown) => {
      enLoading = null; // same as ruLazyLoading above
      throw err;
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
  /** Текст ошибки сервера на языке интерфейса: по-русски — `reason` сервера, по-английски — по коду (apiErrors.ts). */
  errText: (e: unknown, fallback: string) => string;
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
  const ruLazyNow = useSyncExternalStore(subscribeRuLazy, () => ruLazyDict);
  useEffect(() => {
    if (lang !== "ru" && !DICTS[lang]) void loadLang(lang).then(() => setLoaded((n) => n + 1));
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (l: Lang) => {
    // Сначала словарь, потом переключение — чтобы интерфейс не мигнул русским. Выбор сохраняем только после
    // успешной загрузки: иначе при сбое сети интерфейс оставался на прежнем языке, а после перезагрузки стартовал на новом.
    loadLang(l).then(
      () => {
        setLangState(l);
        try {
          localStorage.setItem(STORAGE_KEY, l);
        } catch {
          /* приватный режим / заблокировано — язык просто не переживёт перезагрузку */
        }
      },
      () => {
        /* словарь не загрузился — остаёмся на текущем языке, выбор не сохраняем */
      },
    );
  };

  const dict = DICTS[lang] ?? (ruCore as PartialDict);
  // `t` must keep its identity when the lazy part arrives: effects across the app list `t` / `errText` (and callbacks built
  // on them) as dependencies, and a new `t` re-ran them all once per session — the realtime subscription restarted and
  // e2e/realtime.pw.ts caught it. So `t` reads the module-level `ruLazyDict` at call time instead of closing over it.
  const t = useMemo<TFn>(() => {
    return (key, params) => {
      const text = dict[key] ?? ruCore[key as keyof typeof ruCore] ?? (lang === "ru" ? ruLazyDict?.[key] : undefined);
      if (text === undefined) {
        // Two different cases. With the lazy part loaded (or another language) the key simply does not exist: callers
        // such as webhookUi rely on "" for an unknown key (`t(key) || fallback`), so stay silent and do nothing.
        // With the lazy part still missing, a lazy-screen key was read too early (should not happen through
        // lazyView): start the load so the label fills in on the re-render, and say so in dev.
        if (lang === "ru" && !ruLazyDict) {
          if (import.meta.env.DEV) console.warn(`[i18n] "${key}" was read before the lazy dictionary loaded; open this screen through lazyView()/withRuLazy()`);
          void loadRuLazy().catch(() => undefined);
        }
        return "";
      }
      return interpolate(text, params);
    };
  }, [dict, lang]);

  const tn = useMemo<TnFn>(() => {
    return (n, one, few, many) => t(pluralForm(lang, n, [one, few, many]) as TKey);
  }, [lang, t]);

  const errText = useMemo(() => (e: unknown, fallback: string) => apiErrorText(e, lang, t, fallback), [lang, t]);

  // `ruLazyNow` is a dependency only to hand consumers a new context value (a re-render) when the lazy part arrives, so a
  // label that fell back to "" fills in; `t`, `tn` and `errText` themselves stay the same functions.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setLang closes over nothing that changes; ruLazyNow: see above.
  const value = useMemo<I18nCtx>(() => ({ lang, setLang, t, tn, errText }), [lang, t, tn, errText, ruLazyNow]);
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
