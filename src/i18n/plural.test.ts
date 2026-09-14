import { describe, expect, test } from "vitest";
import { pluralForm } from "./index";
import ru from "./ru";
import en from "./en";

/** То, что tn() делает внутри: pluralForm() выбирает ключ, словарь его резолвит. */
function resolve(dict: Record<string, string>, lang: "ru" | "en", n: number, keys: [string, string, string]): string {
  return dict[pluralForm(lang, n, keys)];
}

const ACC: [string, string, string] = ["noun.issueAcc.one", "noun.issueAcc.few", "noun.issueAcc.many"];

describe("noun.issueAcc — винительный падеж («команда закрыла {n} задачу»)", () => {
  // Ревью PR #43: board.closedRecently раньше брал noun.issue.* (именительный)
  // — «команда закрыла 1 задача» вместо «закрыла 1 задачу». Именительный и
  // винительный совпадают у форм few/many этого существительного, расходятся
  // только в единственном числе — отдельный ключ нужен именно ради него.
  test("RU: 1 → задачу, 2 → задачи, 5 → задач, 21 → задачу, 11 → задач (исключение)", () => {
    expect(resolve(ru, "ru", 1, ACC)).toBe("задачу");
    expect(resolve(ru, "ru", 2, ACC)).toBe("задачи");
    expect(resolve(ru, "ru", 5, ACC)).toBe("задач");
    expect(resolve(ru, "ru", 21, ACC)).toBe("задачу");
    expect(resolve(ru, "ru", 11, ACC)).toBe("задач");
  });

  test("EN: нет падежей — просто singular/plural, как noun.issue.*", () => {
    expect(resolve(en, "en", 1, ACC)).toBe("issue");
    expect(resolve(en, "en", 2, ACC)).toBe("issues");
    expect(resolve(en, "en", 5, ACC)).toBe("issues");
  });
});

const NOM: [string, string, string] = ["noun.issue.one", "noun.issue.few", "noun.issue.many"];

describe("noun.issue — именительный/счётная форма («Показаны {n} задач»)", () => {
  // Ревью PR #43, второй заход: board.truncatedBanner/home.assignedTruncated
  // хардкодили "задач" независимо от числа — тот же класс бага, что и у
  // closedRecently выше, просто в именительном/счётном падеже вместо
  // винительного. Проверяем сам механизм выбора формы для {n} задач-фраз.
  test("RU: 1 → задача, 2 → задачи, 5 → задач, 21 → задача, 11 → задач (исключение)", () => {
    expect(resolve(ru, "ru", 1, NOM)).toBe("задача");
    expect(resolve(ru, "ru", 2, NOM)).toBe("задачи");
    expect(resolve(ru, "ru", 5, NOM)).toBe("задач");
    expect(resolve(ru, "ru", 21, NOM)).toBe("задача");
    expect(resolve(ru, "ru", 11, NOM)).toBe("задач");
  });
});
