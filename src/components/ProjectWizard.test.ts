import { describe, expect, test } from "vitest";
import { suggestKey } from "./ProjectWizard";

describe("suggestKey — ключ проекта из названия", () => {
  test("первые буквы слов латиницей; одно слово — его начало", () => {
    expect(suggestKey("Найм и адаптация", new Set())).toBe("NA");
    expect(suggestKey("Маркетинговые кампании весна", new Set())).toBe("MKV");
    expect(suggestKey("Портал", new Set())).toBe("PORT");
    expect(suggestKey("Customer portal", new Set())).toBe("CP");
  });
  test("занятый ключ получает номер", () => {
    expect(suggestKey("Найм и адаптация", new Set(["NA"]))).toBe("NA2");
  });
  test("пусто или только цифры — пустая подсказка", () => {
    expect(suggestKey("", new Set())).toBe("");
    expect(suggestKey("2026", new Set())).toBe("");
  });
});
