import { describe, expect, test, vi, afterEach } from "vitest";
import { applyNotificationAction, assignableUsers, canTransition, fmtDate, relTime, statusById } from "./store";
import type { Data, NotificationT, ProjectRole, User, Workflow } from "./types";

/**
 * Чистые хелперы стора. Здесь самая плотная логика на строку во всём клиенте
 * и при этом ноль DOM — идеальные кандидаты в тесты (аудит DEBT-02).
 */

const wf: Workflow = {
  statuses: [
    { id: "todo", sid: "todo", name: "К работе", category: "todo" },
    { id: "prog", sid: "inprogress", name: "В работе", category: "inprogress" },
    { id: "done", sid: "done", name: "Готово", category: "done" },
  ],
  transitions: [
    { id: "t1", from: "todo", to: "prog" },
    { id: "t2", from: "prog", to: "done" },
  ],
};

describe("canTransition", () => {
  test("разрешает переход, описанный в схеме", () => {
    expect(canTransition(wf, "todo", "prog")).toBe(true);
  });

  test("запрещает переход, которого в схеме нет", () => {
    expect(canTransition(wf, "todo", "done")).toBe(false);
  });

  test("переход в самого себя разрешён — это переупорядочивание внутри колонки", () => {
    expect(canTransition(wf, "done", "done")).toBe(true);
  });

  test("направление имеет значение: обратного ребра нет", () => {
    expect(canTransition(wf, "prog", "todo")).toBe(false);
  });
});

describe("statusById", () => {
  test("находит статус и возвращает undefined для неизвестного", () => {
    expect(statusById(wf, "prog")?.name).toBe("В работе");
    expect(statusById(wf, "нет-такого")).toBeUndefined();
  });
});

describe("assignableUsers", () => {
  const mkUser = (id: string): User => ({
    id,
    name: id,
    initials: "XX",
    color: "#333",
    role: "qa",
    phone: "",
    globalRole: "member",
    accessRole: "employee",
    avatarUpdatedAt: null,
  });
  const data = {
    users: [mkUser("a"), mkUser("b"), mkUser("c")],
    members: { a: "employee" as ProjectRole, b: "manager" as ProjectRole },
  };

  test("предлагает только участников проекта", () => {
    expect(assignableUsers(data).map((u) => u.id)).toEqual(["a", "b"]);
  });

  test("текущий исполнитель остаётся в списке, даже если его вывели из проекта", () => {
    // Иначе он молча исчез бы из пикера у уже созданной задачи, и было бы
    // непонятно, кто её вообще делает.
    expect(assignableUsers(data, ["c"]).map((u) => u.id)).toEqual(["a", "b", "c"]);
  });

  test("не дублирует исполнителя, который и так участник", () => {
    expect(assignableUsers(data, ["a"]).map((u) => u.id)).toEqual(["a", "b"]);
  });
});

describe("relTime", () => {
  afterEach(() => vi.useRealTimers());

  const at = (isoNow: string, ts: number) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(isoNow));
    return relTime(ts);
  };
  const now = new Date("2026-09-13T12:00:00Z").getTime();

  test("только что", () => {
    expect(at("2026-09-13T12:00:00Z", now - 30_000)).toBe("только что");
  });

  test("минуты и часы", () => {
    expect(at("2026-09-13T12:00:00Z", now - 5 * 60_000)).toBe("5 мин назад");
    expect(at("2026-09-13T12:00:00Z", now - 3 * 3_600_000)).toBe("3 ч назад");
  });

  test("вчера — отдельным словом, а не «1 дн назад»", () => {
    expect(at("2026-09-13T12:00:00Z", now - 25 * 3_600_000)).toBe("вчера");
  });

  test("дальше недели переходит на дату", () => {
    const res = at("2026-09-13T12:00:00Z", now - 30 * 86_400_000);
    expect(res).not.toContain("назад");
    expect(res).toMatch(/\d/);
  });
});

describe("fmtDate", () => {
  test("разбирает дату без времени, не съезжая на сутки", () => {
    // Дата приходит как "ГГГГ-ММ-ДД"; парсить её как UTC-полночь опасно —
    // в минусовых поясах получился бы предыдущий день.
    expect(fmtDate("2026-03-08")).toContain("8");
  });
});

describe("applyNotificationAction", () => {
  const n = (id: string, read: boolean): NotificationT => ({
    id,
    type: "issue.assigned",
    actor: null,
    projectId: null,
    issueId: null,
    payload: {},
    createdAt: 0,
    read,
  });

  const base = {
    notifications: [n("a", false), n("b", false), n("c", true)],
    unreadCount: 7, // на сервере непрочитанных больше, чем в загруженной странице
  } as unknown as Data;

  test("с ids помечает прочитанными только их", () => {
    const next = applyNotificationAction(base, ["a"], "read");
    expect(next.notifications.map((x) => [x.id, x.read])).toEqual([
      ["a", true],
      ["b", false],
      ["c", true],
    ]);
    expect(next.unreadCount).toBe(6);
  });

  test("повторный вызов с уже прочитанным id не уводит счётчик в минус", () => {
    const once = applyNotificationAction(base, ["a"], "read");
    const twice = applyNotificationAction(once, ["a"], "read");
    expect(twice.unreadCount).toBe(6);
  });

  test("без ids действие применяется ко всем на сервере — счётчик обнуляется целиком", () => {
    // Лента пагинируется, и в памяти лежит не всё. Поэтому «прочитать все»
    // должно обнулить весь серверный счётчик, а не вычесть три загруженных.
    const next = applyNotificationAction(base, undefined, "read");
    expect(next.unreadCount).toBe(0);
    expect(next.notifications.every((x) => x.read)).toBe(true);
  });

  test("пустой массив ids равнозначен «все»", () => {
    expect(applyNotificationAction(base, [], "read").unreadCount).toBe(0);
  });

  test("dismiss убирает из ленты, а не помечает прочитанным", () => {
    const next = applyNotificationAction(base, ["a"], "dismiss");
    expect(next.notifications.map((x) => x.id)).toEqual(["b", "c"]);
    expect(next.unreadCount).toBe(6);
  });

  test("dismiss всех очищает ленту и счётчик", () => {
    const next = applyNotificationAction(base, undefined, "dismiss");
    expect(next.notifications).toEqual([]);
    expect(next.unreadCount).toBe(0);
  });

  test("счётчик никогда не уходит ниже нуля", () => {
    const skewed = { ...base, unreadCount: 1 } as Data;
    expect(applyNotificationAction(skewed, ["a", "b"], "read").unreadCount).toBe(0);
  });
});
