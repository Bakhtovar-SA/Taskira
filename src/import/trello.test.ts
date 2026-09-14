import { describe, expect, test } from "vitest";
import { parseTrelloExport } from "./trello";

/** Фикстура собрана вручную по документированной (публичной, стабильной)
 *  схеме JSON-экспорта доски Trello — реального файла из живого аккаунта
 *  для проверки нет, честно ограничиваемся этим (см. комментарий в trello.ts). */
const fixture = {
  name: "Мой спринт",
  lists: [
    { id: "l1", name: "To Do" },
    { id: "l2", name: "Done" },
  ],
  cards: [
    {
      id: "c1",
      name: "Починить логин",
      desc: "Кнопка не реагирует на клик",
      idList: "l1",
      closed: false,
      due: "2024-03-15T00:00:00.000Z",
      labels: [{ name: "Bug", color: "red" }, { name: "Срочно", color: "orange" }],
    },
    {
      id: "c2",
      name: "Архивная карточка",
      idList: "l2",
      closed: true,
      due: null,
      labels: [],
    },
    { id: "c3", name: "", idList: "l1" }, // пустое название — должна быть пропущена
    { id: "c4" }, // вообще без name — тоже пропущена
  ],
};

describe("parseTrelloExport", () => {
  test("разбирает карточки, подмешивает имя списка меткой, находит дату и закрытость", () => {
    const r = parseTrelloExport(fixture);
    expect(r.boardName).toBe("Мой спринт");
    expect(r.items).toHaveLength(2);
    expect(r.skipped).toBe(2);

    const c1 = r.items.find((i) => i.title === "Починить логин")!;
    expect(c1.description).toBe("Кнопка не реагирует на клик");
    expect(c1.dueDate).toBe("2024-03-15");
    expect(c1.closed).toBe(false);
    expect(c1.labels).toEqual(expect.arrayContaining(["trello:to do", "bug", "срочно"]));

    const c2 = r.items.find((i) => i.title === "Архивная карточка")!;
    expect(c2.dueDate).toBeNull();
    expect(c2.closed).toBe(true);
    expect(c2.labels).toEqual(["trello:done"]);
  });

  test("метки дедуплицируются и нормализуются (lowercase/trim), как обычные метки Taskira", () => {
    const r = parseTrelloExport({
      name: "x",
      lists: [{ id: "l1", name: "Bugs" }],
      cards: [{ id: "c1", name: "т", idList: "l1", labels: [{ name: "  Bug " }, { name: "bug" }] }],
    });
    expect(r.items[0].labels).toEqual(["trello:bugs", "bug"]);
  });

  test("не Trello-JSON — понятная ошибка, а не крэш", () => {
    expect(() => parseTrelloExport({ foo: "bar" })).toThrow(/не похож на экспорт/);
    expect(() => parseTrelloExport(null)).toThrow();
    expect(() => parseTrelloExport("not an object")).toThrow();
  });

  test("доска без имени — фолбэк на дефолтное название", () => {
    const r = parseTrelloExport({ lists: [], cards: [] });
    expect(r.boardName).toBe("Trello-доска");
    expect(r.items).toEqual([]);
  });
});
