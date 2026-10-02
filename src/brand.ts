/** Брендирование инсталляции на клиенте (ТЗ 5.14 п.5): название, оттенок акцента, знак.
 *
 *  Источник правды — сервер (`GET /api/instance/brand`, публичный — нужен экрану входа). Название и оттенок кэшируются
 *  в localStorage (`taskira.brand`), чтобы `public/theme-init.js` поставил `--brand-h` до первой отрисовки, а экран
 *  входа сразу показал своё название — без мигания фиолетовым «Taskira». Оттенок живёт только как `--brand-h` на <html>
 *  (CSSOM, ADR-0010); акцентные токены tokens.css используют оттенок и профиль палитры. Допустимые значения —
 *  contract.ts BRAND_HUE и BRAND_EXTRA_HUES,
 *  его целиком проверяет `npm run contrast:check`, поэтому любой сохранённый оттенок проходит контраст 4.5. */
import type { BrandDto } from "../server/src/contract";
import { setOrgTransparency } from "./theme";
import { brandApi } from "./api";
import { createExternalStore, useExternalStore } from "./store/external";

/** Зеркало contract.ts BRAND_HUE: значение оттуда импортировать нельзя — потянет zod в бандл (типы — можно).
 *  Расхождение ловит brand.test.ts. */
export const BRAND_HUE = { min: 255, max: 320, default: 288 } as const;
export const BRAND_EXTRA_HUES = [55, 145, 185, 235, 345] as const;
export const TRANSPARENCY_DEFAULTS = ["auto", "on"] as const;
export const DEFAULT_BRAND_NAME = "Taskira";
const KEY = "taskira.brand";

export type Brand = { transparencyDefault: BrandDto["transparencyDefault"]; name: string | null; hue: number | null; logoUpdatedAt: number | null; logoUrl: string | null };

const EMPTY: Brand = { transparencyDefault: "auto", name: null, hue: null, logoUpdatedAt: null, logoUrl: null };

export function readCache(): Brand {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Brand> | null;
    if (!raw) return EMPTY;
    return {
      ...EMPTY,
      transparencyDefault: raw.transparencyDefault === "on" ? "on" : "auto",
      name: typeof raw.name === "string" ? raw.name : null,
      hue: isHue(raw.hue) ? raw.hue : null,
    };
  } catch {
    return EMPTY;
  }
}

function writeCache(b: Brand): void {
  try {
    if (b.name === null && b.hue === null && b.transparencyDefault === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ name: b.name, hue: b.hue, transparencyDefault: b.transparencyDefault }));
  } catch {
    // хранилище недоступно — оттенок просто появится после ответа сервера
  }
}

export const isHue = (h: unknown): h is number =>
  typeof h === "number" && Number.isInteger(h) && ((h >= BRAND_HUE.min && h <= BRAND_HUE.max) || BRAND_EXTRA_HUES.some(value => value === h));

/** Поставить оттенок на <html>; null — вернуть значение из tokens.css. */
export function applyHue(hue: number | null): void {
  const root = document.documentElement;
  if (isHue(hue) && BRAND_EXTRA_HUES.some(value => value === hue)) root.setAttribute("data-brand-palette", hue === 55 || hue === 345 ? "warm" : "extended");
  else root.removeAttribute("data-brand-palette");
  if (isHue(hue) && hue !== BRAND_HUE.default) root.style.setProperty("--brand-h", String(hue));
  else root.style.removeProperty("--brand-h");
}

const store = createExternalStore<Brand>(readCache());
setOrgTransparency(store.getState().transparencyDefault);

function applyTitle(name: string | null): void {
  document.title = name ?? DEFAULT_BRAND_NAME;
}

/** Применить ответ сервера: оттенок, название, кэш; знак грузится blob-ссылкой только если он сменился. */
export function setBrand(dto: BrandDto): void {
  const prev = store.getState();
  const logoChanged = dto.logoUpdatedAt !== prev.logoUpdatedAt;
  if (logoChanged && prev.logoUrl) URL.revokeObjectURL(prev.logoUrl);
  const next: Brand = { transparencyDefault: dto.transparencyDefault === "on" ? "on" : "auto", name: dto.name, hue: dto.hue, logoUpdatedAt: dto.logoUpdatedAt, logoUrl: logoChanged ? null : prev.logoUrl };
  store.setState(() => next);
  setOrgTransparency(next.transparencyDefault);
  applyHue(dto.hue);
  applyTitle(dto.name);
  writeCache(next);
  if (logoChanged && dto.logoUpdatedAt !== null) {
    const v = dto.logoUpdatedAt;
    void brandApi.logoBlobUrl(v).then((url) => {
      if (!url) return;
      // Пока грузился, знак могли сменить или убрать — устаревшую ссылку не ставим.
      if (store.getState().logoUpdatedAt !== v) return URL.revokeObjectURL(url);
      store.setState((b) => ({ ...b, logoUrl: url }));
    });
  }
}

export function loadBrand(): void {
  const cached = store.getState();
  applyTitle(cached.name);
  brandApi.get().then(setBrand, () => undefined); // без бренда — стандартный вид, ошибка не мешает работе
}

/** Предпросмотр оттенка в настройках до сохранения; `previewHue(null)` — вернуть сохранённый. */
export function previewHue(hue: number | null): void {
  applyHue(hue ?? store.getState().hue);
}

export const useBrand = () => useExternalStore(store);
export const useBrandName = () => useExternalStore(store, (b) => b.name ?? DEFAULT_BRAND_NAME);
export const useBrandLogo = () => useExternalStore(store, (b) => b.logoUrl);

/** Для тестов. */
export function resetBrand(): void {
  store.setState(() => EMPTY);
  applyHue(null);
  setOrgTransparency("auto");
}
