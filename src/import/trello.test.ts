import { describe, expect, test } from "vitest";
import { parseTrelloExport } from "./trello";
import { LIMITS, sanitizeLabel } from "../validation";

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

  test("доска с пустым/пробельным именем — тоже фолбэк, не пустой заголовок «»", () => {
    // Ревью PR #48: в отличие от boardName === undefined (тест выше), это
    // board.name === "" / "   " — раньше проходило как есть.
    expect(parseTrelloExport({ name: "", lists: [], cards: [] }).boardName).toBe("Trello-доска");
    expect(parseTrelloExport({ name: "   ", lists: [], cards: [] }).boardName).toBe("Trello-доска");
  });

  test("длинные имена списков с общим началом дают РАЗНЫЕ метки, не схлопываются (ревью PR #48)", () => {
    // sanitizeLabel() сам по себе обрезал бы "trello:" + имя целиком до 30
    // символов — имени оставалось бы ~23 символа, и оба списка ниже давали
    // одну и ту же метку. trelloListLabel() обрезает само имя ДО префикса.
    const r = parseTrelloExport({
      name: "x",
      lists: [
        { id: "l1", name: "Sprint 24 — Design Review Backlog" },
        { id: "l2", name: "Sprint 24 — Design Review Done" },
      ],
      cards: [
        { id: "c1", name: "A", idList: "l1" },
        { id: "c2", name: "B", idList: "l2" },
      ],
    });
    const labelA = r.items.find((i) => i.title === "A")!.labels[0];
    const labelB = r.items.find((i) => i.title === "B")!.labels[0];
    expect(labelA).not.toBe(labelB);
    expect(labelA.length).toBeLessThanOrEqual(30);
    expect(labelB.length).toBeLessThanOrEqual(30);
  });

  test("метки списков переживают повторный sanitizeLabel() (как в validateLabels перед POST) без коллизии (ревью PR #48, четвёртый раунд)", () => {
    // store.tsx: buildCreatePayload() → validateLabels() прогоняет ВЕСЬ
    // labels ещё раз через sanitizeLabel() перед отправкой на сервер — не
    // важно, что делает этот модуль, именно тот второй проход определяет
    // финальные метки. Гарантия "разные списки — разные метки" держится
    // только на том, что sanitizeLabel() идемпотентна и не трогает "~xxxx".
    // Если это когда-нибудь перестанет быть так, тест ниже должен упасть.
    const r = parseTrelloExport({
      name: "x",
      lists: [
        { id: "l1", name: "Sprint 24 — Design Review Backlog" },
        { id: "l2", name: "Sprint 24 — Design Review Done" },
      ],
      cards: [
        { id: "c1", name: "A", idList: "l1" },
        { id: "c2", name: "B", idList: "l2" },
      ],
    });
    const labelA = r.items.find((i) => i.title === "A")!.labels[0];
    const labelB = r.items.find((i) => i.title === "B")!.labels[0];

    const labelA2 = sanitizeLabel(labelA);
    const labelB2 = sanitizeLabel(labelB);
    expect(labelA2).toBe(labelA);
    expect(labelB2).toBe(labelB);
    expect(labelA2).not.toBe(labelB2);
  });

  test("карточка с LIMITS.labelsPerIssue+ Trello-метками — метки обрезаются, карточка не теряется целиком (ревью PR #48, пятый раунд)", () => {
    const manyLabels = Array.from({ length: LIMITS.labelsPerIssue + 5 }, (_, i) => ({ name: `label${i}` }));
    const r = parseTrelloExport({
      name: "x",
      lists: [{ id: "l1", name: "To Do" }],
      cards: [{ id: "c1", name: "Перегруженная карточка", idList: "l1", labels: manyLabels }],
    });
    const labels = r.items[0].labels;
    // Метка списка не должна быть вытеснена метками самой карточки — иначе
    // карточка "теряет" привязку к своему Trello-списку молча.
    expect(labels).toContain("trello:to do");
    expect(labels.length).toBeLessThanOrEqual(LIMITS.labelsPerIssue);
  });

  test("due: '' (пустая строка) — null, а не невалидная дата (ревью PR #48)", () => {
    const r = parseTrelloExport({
      name: "x",
      lists: [],
      cards: [{ id: "c1", name: "Без срока", due: "" }],
    });
    expect(r.items[0].dueDate).toBeNull();
  });
});
