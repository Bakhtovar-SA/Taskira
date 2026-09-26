import { describe, expect, it } from "vitest";
import { fuzzyScore, matchScore, swapLayout } from "./fuzzy";

describe("swapLayout", () => {
  it("переводит QWERTY ↔ ЙЦУКЕН", () => {
    expect(swapLayout("ljcrf")).toBe("доска");
    expect(swapLayout("ищфкв")).toBe("board");
    expect(swapLayout("Nf,kbwf")).toBe("таблица");
  });
  it("не трогает цифры и пробелы", () => {
    expect(swapLayout("12 3")).toBe("12 3");
  });
});

describe("fuzzyScore", () => {
  it("находит подпоследовательность и отвергает чужое", () => {
    expect(fuzzyScore("дск", "Доска")).not.toBeNull();
    expect(fuzzyScore("xyz", "Доска")).toBeNull();
  });
  it("начала слов выше середины слова", () => {
    expect(fuzzyScore("нз", "Новая задача")!).toBeGreaterThan(fuzzyScore("нз", "Пенза")!);
  });
  it("префикс выше вхождения внутри", () => {
    expect(fuzzyScore("отч", "Отчёты")!).toBeGreaterThan(fuzzyScore("отч", "Скачать отчёт")!);
  });
  it("ё и е равны", () => {
    expect(fuzzyScore("тема темная", "Тема: тёмная")).not.toBeNull();
  });
});

describe("matchScore", () => {
  it("находит команду, набранную не в той раскладке", () => {
    expect(matchScore("ljcrf", ["Доска"])).not.toBeNull();
    expect(matchScore("ищфкв", ["Доска", "board"])).not.toBeNull();
  });
  it("null, если ничего не подходит", () => {
    expect(matchScore("qqq", ["Доска"])).toBeNull();
  });
});
