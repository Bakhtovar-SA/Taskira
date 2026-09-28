import { afterEach, describe, expect, test } from "vitest";
import { applyTheme, effectiveTheme, readBgId, readTheme, setProjectBackground } from "./theme";

const root = document.documentElement;
afterEach(() => {
  localStorage.clear();
  setProjectBackground(null);
  root.removeAttribute("data-skin");
  root.removeAttribute("data-atmosphere");
});

describe("темы и фоны (ТЗ 5.14)", () => {
  test("курируемая тема = базовая светлая/тёмная + data-skin", () => {
    applyTheme("dusk", "default");
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.getAttribute("data-skin")).toBe("dusk");
    applyTheme("paper", "default");
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.getAttribute("data-skin")).toBe("paper");
    applyTheme("light", "default");
    expect(root.hasAttribute("data-skin")).toBe(false);
    expect(effectiveTheme("graphite")).toBe("dark");
  });

  test("фон — data-atmosphere; «default» и неизвестный id — без атрибута; фон проекта перекрывает личный", () => {
    applyTheme("light", "rings");
    expect(root.getAttribute("data-atmosphere")).toBe("rings");
    applyTheme("light", "nope");
    expect(root.hasAttribute("data-atmosphere")).toBe(false);
    localStorage.setItem("taskira.bg", "mint");
    setProjectBackground("grid");
    expect(root.getAttribute("data-atmosphere")).toBe("grid");
    setProjectBackground(null);
    expect(root.getAttribute("data-atmosphere")).toBe("mint");
  });

  test("мусор в localStorage не ломает выбор", () => {
    localStorage.setItem("taskira.theme", "neon");
    localStorage.setItem("taskira.bg", "neon");
    expect(readTheme()).toBe("system");
    expect(readBgId()).toBe("default");
  });
});
