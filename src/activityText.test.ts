/** История задачи на языке интерфейса (трек E): событие — через словарь, запись до трека E — по тексту. */
import { describe, expect, test } from "vitest";
import ru, { type TKey } from "./i18n/ru";
import en from "./i18n/en";
import { activityLine } from "./activityText";

const make = (dict: Record<string, string>) => (k: TKey, p: Record<string, string | number> = {}) =>
  dict[k].replace(/\{(\w+)\}/g, (_, n: string) => String(p[n] ?? `{${n}}`));
const tRu = make(ru);
const tEn = make(en);

describe("событие рисуется через словарь", () => {
  test("приоритет, статус, массовая операция — на обоих языках", () => {
    expect(activityLine({ kind: "priority", from: "medium", to: "critical" }, "x", tEn, "en")).toBe("changed priority: Medium → Critical");
    expect(activityLine({ kind: "priority", from: "medium", to: "critical" }, "x", tRu, "ru")).toBe("изменил(а) приоритет: Средний → Критичный");
    // Стандартные названия статусов переводятся, как везде в интерфейсе; свои — данные, остаются как есть.
    expect(activityLine({ kind: "status", from: "Готово", to: "В работе", bulk: true }, "x", tEn, "en")).toBe("moved from “Done” to “In progress” (bulk action)");
    expect(activityLine({ kind: "status", from: "Согласование", to: "Готово" }, "x", tEn, "en")).toBe("moved from “Согласование” to “Done”");
    expect(activityLine({ kind: "assigneeBulk", cleared: true }, "x", tEn, "en")).toBe("removed the assignees (bulk action)");
    // Дата текущего года — без года (fmtDate), поэтому берём этот год, а не фиксированный.
    const y = new Date().getFullYear();
    expect(activityLine({ kind: "due", from: null, to: `${y}-10-01` }, "x", tEn, "en")).toBe("changed the due date: — → Oct 1");
    expect(activityLine({ kind: "link", type: "blocked_by", key: "CORP-2" }, "x", tEn, "en")).toBe("marked the issue as blocked by CORP-2");
  });

  test("имена людей и текст пунктов — данные, не переводятся", () => {
    expect(activityLine({ kind: "assigneeAdded", name: "Анна Иванова" }, "x", tEn, "en")).toBe("assigned Анна Иванова");
    expect(activityLine({ kind: "checklistAdded", text: "Проверить договор" }, "x", tEn, "en")).toBe("added checklist item “Проверить договор”");
  });
});

describe("запись до трека E (event: null)", () => {
  test("русский интерфейс — текст как есть", () => {
    expect(activityLine(null, "переместил(а) из «А» в «Б»", tRu, "ru")).toBe("переместил(а) из «А» в «Б»");
  });

  test("английский — известная фраза переводится, включая массовую операцию", () => {
    expect(activityLine(null, "создал(а) задачу", tEn, "en")).toBe("created the issue");
    expect(activityLine(null, "изменил(а) приоритет: Низкий → Высокий (массовая операция)", tEn, "en")).toBe("changed priority: Low → High (bulk action)");
    expect(activityLine(null, "назначил(а) исполнителя (массовая операция)", tEn, "en")).toBe("set the assignee (bulk action)");
    expect(activityLine(null, "снял(а) исполнителя Анна", tEn, "en")).toBe("unassigned Анна");
    expect(activityLine(null, "связал(а) с CORP-7", tEn, "en")).toBe("linked it to CORP-7");
  });

  test("незнакомая фраза — как есть, а не пустая строка", () => {
    expect(activityLine(null, "сделал(а) что-то новое", tEn, "en")).toBe("сделал(а) что-то новое");
  });
});
