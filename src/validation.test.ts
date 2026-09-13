import { describe, expect, test } from "vitest";
import {
  LIMITS,
  sanitizeLabel,
  sanitizeLine,
  sanitizeText,
  validateComment,
  validateDescription,
  validateLabels,
  validateTitle,
} from "./validation";

/**
 * Санитизация и валидация ввода. Клиентская проверка — только для UX (сервер
 * повторяет каждую), но именно она решает, покажем ли мы человеку внятную
 * ошибку или отправим заведомо отбиваемый запрос.
 */

describe("sanitizeLine", () => {
  test("схлопывает пробелы и обрезает края", () => {
    expect(sanitizeLine("  привет   мир  ")).toBe("привет мир");
  });

  test("убирает переводы строк — строка остаётся одной", () => {
    expect(sanitizeLine("первая\nвторая")).toBe("первая вторая");
  });

  test("вырезает управляющие символы, но не ломает кириллицу и эмодзи", () => {
    expect(sanitizeLine("текст 🙂")).toBe("текст 🙂");
  });
});

describe("sanitizeText", () => {
  test("нормализует CRLF в LF", () => {
    expect(sanitizeText("a\r\nb", 100)).toBe("a\nb");
  });

  test("схлопывает три и более переводов строки в два", () => {
    expect(sanitizeText("a\n\n\n\n\nb", 100)).toBe("a\n\nb");
  });

  test("двойной перевод строки сохраняется — это абзац", () => {
    expect(sanitizeText("a\n\nb", 100)).toBe("a\n\nb");
  });

  test("режет по максимуму", () => {
    expect(sanitizeText("abcdef", 3)).toBe("abc");
  });

  test("табуляция и одиночный перенос выживают: они нужны в описаниях", () => {
    expect(sanitizeText("код:\n\tотступ", 100)).toBe("код:\n\tотступ");
  });
});

describe("sanitizeLabel", () => {
  test("приводит к нижнему регистру", () => {
    expect(sanitizeLabel("  СРОЧНО  ")).toBe("срочно");
  });

  test("режет по лимиту метки", () => {
    expect(sanitizeLabel("я".repeat(50))).toHaveLength(LIMITS.label.max);
  });
});

describe("validateTitle", () => {
  test("пустое и пробельное название отбивается", () => {
    expect(validateTitle("")).toMatchObject({ ok: false });
    expect(validateTitle("   ")).toMatchObject({ ok: false });
  });

  test("ровно на границе длины — проходит", () => {
    const v = validateTitle("я".repeat(LIMITS.title.max));
    expect(v).toMatchObject({ ok: true });
  });

  test("на символ длиннее — отбивается, и в тексте ошибки есть лимит", () => {
    const v = validateTitle("я".repeat(LIMITS.title.max + 1));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain(String(LIMITS.title.max));
  });

  test("возвращает уже санитизированное значение, а не исходное", () => {
    const v = validateTitle("  много   пробелов  ");
    expect(v).toEqual({ ok: true, value: "много пробелов" });
  });
});

describe("validateComment", () => {
  test("пустой комментарий отбивается", () => {
    expect(validateComment("   \n  ")).toMatchObject({ ok: false });
  });

  test("на границе проходит, за границей — нет", () => {
    expect(validateComment("я".repeat(LIMITS.comment.max)).ok).toBe(true);
    expect(validateComment("я".repeat(LIMITS.comment.max + 1)).ok).toBe(false);
  });
});

describe("validateDescription", () => {
  test("пустое описание допустимо — поле необязательное", () => {
    expect(validateDescription("")).toEqual({ ok: true, value: "" });
  });

  test("за границей отбивается", () => {
    expect(validateDescription("я".repeat(LIMITS.description.max + 1)).ok).toBe(false);
  });
});

describe("validateLabels", () => {
  test("дубликаты схлопываются с учётом регистра и пробелов", () => {
    expect(validateLabels(["Баг", "баг", "  БАГ  "])).toEqual({ ok: true, value: ["баг"] });
  });

  test("пустые метки выбрасываются, а не превращаются в пустые строки", () => {
    expect(validateLabels(["", "   ", "ок"])).toEqual({ ok: true, value: ["ок"] });
  });

  test("больше лимита — отбивается", () => {
    const many = Array.from({ length: LIMITS.labelsPerIssue + 1 }, (_, i) => `метка${i}`);
    expect(validateLabels(many).ok).toBe(false);
  });

  test("ровно лимит после схлопывания дубликатов проходит", () => {
    const exact = Array.from({ length: LIMITS.labelsPerIssue }, (_, i) => `метка${i}`);
    expect(validateLabels([...exact, ...exact]).ok).toBe(true);
  });
});

