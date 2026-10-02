import { afterEach, describe, expect, test, vi } from "vitest";

const logoBlobUrl = vi.fn(async (v: number) => `blob:logo-${v}`);
vi.mock("./api", () => ({ brandApi: { get: vi.fn(), logoBlobUrl: (v: number) => logoBlobUrl(v) } }));

import { BRAND_HUE as CONTRACT_HUE, BRAND_EXTRA_HUES as CONTRACT_EXTRA_HUES, TRANSPARENCY_DEFAULTS as CONTRACT_TRANSPARENCY } from "../server/src/contract";
import { TRANSPARENCY_DEFAULTS, readCache, BRAND_EXTRA_HUES, BRAND_HUE, applyHue, isHue, previewHue, resetBrand, setBrand } from "./brand";

const root = document.documentElement;
const hueVar = () => root.style.getPropertyValue("--brand-h");

afterEach(() => {
  resetBrand();
  localStorage.clear();
  logoBlobUrl.mockClear();
});

describe("брендирование (ТЗ 5.14 п.5)", () => {
  test("зеркало диапазона оттенка совпадает с contract.ts (его проверяет contrast:check)", () => {
    expect(BRAND_HUE).toEqual(CONTRACT_HUE);
  });

  test("оттенок ставится на <html> через CSSOM; по умолчанию и вне диапазона — снимается", () => {
    applyHue(300);
    expect(hueVar()).toBe("300");
    applyHue(BRAND_HUE.default);
    expect(hueVar()).toBe("");
    applyHue(300);
    applyHue(200);
    expect(hueVar()).toBe("");
    expect(isHue(254)).toBe(false);
    expect(isHue(320)).toBe(true);
    expect(isHue(300.5)).toBe(false);
  });

  test("ответ сервера: оттенок, заголовок вкладки, кэш для theme-init.js; null — стандартный вид", () => {
    setBrand({ transparencyDefault: "auto", name: "Acme", hue: 262, logoUpdatedAt: null });
    expect(hueVar()).toBe("262");
    expect(document.title).toBe("Acme");
    expect(JSON.parse(localStorage.getItem("taskira.brand")!)).toEqual({ name: "Acme", hue: 262, transparencyDefault: "auto" });

    setBrand({ transparencyDefault: "auto", name: null, hue: null, logoUpdatedAt: null });
    expect(hueVar()).toBe("");
    expect(document.title).toBe("Taskira");
    expect(localStorage.getItem("taskira.brand")).toBeNull();
  });

  test("предпросмотр оттенка возвращается к сохранённому", () => {
    setBrand({ transparencyDefault: "auto", name: null, hue: 270, logoUpdatedAt: null });
    previewHue(310);
    expect(hueVar()).toBe("310");
    previewHue(null);
    expect(hueVar()).toBe("270");
  });

  test("знак грузится только при смене версии", async () => {
    setBrand({ transparencyDefault: "auto", name: null, hue: null, logoUpdatedAt: 5 });
    setBrand({ transparencyDefault: "auto", name: "X", hue: null, logoUpdatedAt: 5 });
    await Promise.resolve();
    expect(logoBlobUrl).toHaveBeenCalledTimes(1);
    expect(logoBlobUrl).toHaveBeenCalledWith(5);
  });
});


test("closed transparency defaults match the contract; old and unknown cache values are auto", () => {
  expect(TRANSPARENCY_DEFAULTS).toEqual(CONTRACT_TRANSPARENCY);
  for (const cache of [{ name: "Acme", hue: 270 }, { transparencyDefault: "off" }]) {
    localStorage.setItem("taskira.brand", JSON.stringify(cache));
    expect(readCache().transparencyDefault).toBe("auto");
  }
});
test("organization-only override survives cache and updates transparency on fresh response", () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduced-transparency") }));
  localStorage.setItem("taskira.transparency", "auto");
  setBrand({ name: null, hue: null, logoUpdatedAt: null, transparencyDefault: "on" });
  expect(JSON.parse(localStorage.getItem("taskira.brand")!)).toEqual({ name: null, hue: null, transparencyDefault: "on" });
  expect(readCache().transparencyDefault).toBe("on");
  expect(root.dataset.transparency).toBe("on");
  setBrand({ name: null, hue: null, logoUpdatedAt: null, transparencyDefault: "auto" });
  expect(root.dataset.transparency).toBe("off");
  expect(localStorage.getItem("taskira.brand")).toBeNull();
  vi.unstubAllGlobals();
});

test("additional brand presets match the contract, cache and palette; legacy values reset the profile", () => {
  expect(BRAND_EXTRA_HUES).toEqual(CONTRACT_EXTRA_HUES);
  for (const hue of BRAND_EXTRA_HUES) {
    setBrand({ name: null, hue, logoUpdatedAt: null, transparencyDefault: "auto" });
    expect(hueVar()).toBe(String(hue));
    expect(readCache().hue).toBe(hue);
    expect(root.dataset.brandPalette).toBe(hue === 55 || hue === 345 ? "warm" : "extended");
  }
  applyHue(300);
  expect(root.hasAttribute("data-brand-palette")).toBe(false);
});
