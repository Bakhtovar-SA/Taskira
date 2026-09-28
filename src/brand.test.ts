import { afterEach, describe, expect, test, vi } from "vitest";

const logoBlobUrl = vi.fn(async (v: number) => `blob:logo-${v}`);
vi.mock("./api", () => ({ brandApi: { get: vi.fn(), logoBlobUrl: (v: number) => logoBlobUrl(v) } }));

import { BRAND_HUE as CONTRACT_HUE } from "../server/src/contract";
import { BRAND_HUE, applyHue, isHue, previewHue, resetBrand, setBrand } from "./brand";

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
    setBrand({ name: "Acme", hue: 262, logoUpdatedAt: null });
    expect(hueVar()).toBe("262");
    expect(document.title).toBe("Acme");
    expect(JSON.parse(localStorage.getItem("taskira.brand")!)).toEqual({ name: "Acme", hue: 262 });

    setBrand({ name: null, hue: null, logoUpdatedAt: null });
    expect(hueVar()).toBe("");
    expect(document.title).toBe("Taskira");
    expect(localStorage.getItem("taskira.brand")).toBeNull();
  });

  test("предпросмотр оттенка возвращается к сохранённому", () => {
    setBrand({ name: null, hue: 270, logoUpdatedAt: null });
    previewHue(310);
    expect(hueVar()).toBe("310");
    previewHue(null);
    expect(hueVar()).toBe("270");
  });

  test("знак грузится только при смене версии", async () => {
    setBrand({ name: null, hue: null, logoUpdatedAt: 5 });
    setBrand({ name: "X", hue: null, logoUpdatedAt: 5 });
    await Promise.resolve();
    expect(logoBlobUrl).toHaveBeenCalledTimes(1);
    expect(logoBlobUrl).toHaveBeenCalledWith(5);
  });
});
