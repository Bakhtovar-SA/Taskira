import { describe, expect, test } from "vitest";
import { can, canEditIssue, denialReason, isOwnIssue, resolveRole, roleHas, type PermId } from "./permissions";
import type { AccessRole, Issue, User } from "./types";

/**
 * Права доступа — клиентская копия.
 *
 * Она НЕ граница безопасности (сервер перепроверяет каждую мутацию), но именно
 * она решает, какие кнопки человек видит. Ошибка здесь = «кнопка есть, жмёшь,
 * получаешь отказ» либо «право есть, а кнопки нет» — худший для доверия класс
 * багов. Синхронность с серверной копией отдельно стережёт
 * server/test/permissions-sync.test.ts.
 */

const user = (accessRole: AccessRole, id = "u1"): User => ({
  id,
  name: "Тест",
  initials: "ТТ",
  color: "#334455",
  role: "qa",
  globalRole: accessRole === "admin" ? "admin" : "member",
  accessRole,
});

const issue = (over: Partial<Issue> = {}): Issue => ({
  id: "i1",
  key: "CORP-1",
  title: "задача",
  description: "",
  typeId: "task",
  statusId: "s1",
  priorityId: "medium",
  assigneeId: null,
  reporterId: "someone-else",
  epicId: null,
  labels: [],
  points: null,
  doneAt: null,
  archivedAt: null,
  comments: [],
  activity: [],
  collaborators: [],
  attachments: [],
  links: [],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe("resolveRole", () => {
  test("глобальный admin — admin в любом проекте, даже без членства", () => {
    expect(resolveRole("admin", undefined)).toBe("admin");
  });

  test("обычный участник получает свою проектную роль", () => {
    expect(resolveRole("member", "manager")).toBe("manager");
    expect(resolveRole("member", "viewer")).toBe("viewer");
  });

  test("не участник проекта — null, то есть доступа нет", () => {
    expect(resolveRole("member", undefined)).toBeNull();
  });
});

describe("матрица ролей", () => {
  test("viewer только смотрит", () => {
    expect(roleHas("viewer", "browse")).toBe(true);
    for (const p of ["create", "edit", "delete", "transition", "comment"] as PermId[]) {
      expect(roleHas("viewer", p), `viewer не должен уметь ${p}`).toBe(false);
    }
  });

  test("удалять задачи может только admin и manager", () => {
    expect(roleHas("admin", "delete")).toBe(true);
    expect(roleHas("manager", "delete")).toBe(true);
    expect(roleHas("employee", "delete")).toBe(false);
    expect(roleHas("viewer", "delete")).toBe(false);
  });

  test("workflow и доступы — только admin", () => {
    for (const p of ["editWorkflow", "manageAccess"] as PermId[]) {
      expect(roleHas("admin", p)).toBe(true);
      for (const r of ["manager", "employee", "viewer"] as AccessRole[]) {
        expect(roleHas(r, p), `${r} не должен уметь ${p}`).toBe(false);
      }
    }
  });

  test("подключать к задаче — admin и manager", () => {
    expect(roleHas("manager", "manageCollaborators")).toBe(true);
    expect(roleHas("employee", "manageCollaborators")).toBe(false);
  });
});

describe("правило «своей» задачи", () => {
  test("своя = я исполнитель ИЛИ я автор", () => {
    const me = user("employee");
    expect(isOwnIssue(me, issue({ assigneeId: "u1" }))).toBe(true);
    expect(isOwnIssue(me, issue({ reporterId: "u1" }))).toBe(true);
    expect(isOwnIssue(me, issue())).toBe(false);
  });

  test("employee правит только свои задачи", () => {
    const emp = user("employee");
    expect(canEditIssue(emp, issue({ assigneeId: "u1" }))).toBe(true);
    expect(canEditIssue(emp, issue({ reporterId: "u1" }))).toBe(true);
    expect(canEditIssue(emp, issue())).toBe(false);
  });

  test("manager и admin правят любые", () => {
    expect(canEditIssue(user("manager"), issue())).toBe(true);
    expect(canEditIssue(user("admin"), issue())).toBe(true);
  });

  test("viewer не правит даже свою задачу", () => {
    expect(canEditIssue(user("viewer"), issue({ assigneeId: "u1" }))).toBe(false);
  });
});

describe("can()", () => {
  test("без задачи edit проверяется только по роли", () => {
    // Кнопка «редактировать» в общем меню не знает конкретной задачи —
    // employee должен видеть её включённой.
    expect(can(user("employee"), "edit")).toBe(true);
  });

  test("с задачей применяется сужение по владельцу", () => {
    expect(can(user("employee"), "edit", issue())).toBe(false);
    expect(can(user("employee"), "edit", issue({ assigneeId: "u1" }))).toBe(true);
  });

  test("задача не влияет на права, не связанные с ней", () => {
    expect(can(user("employee"), "delete", issue({ assigneeId: "u1" }))).toBe(false);
  });
});

describe("denialReason()", () => {
  test("для чужой задачи объясняет именно правило владельца", () => {
    const msg = denialReason(user("employee"), "edit", issue());
    expect(msg).toContain("исполнитель или автор");
  });

  test("для нехватки роли называет и роль, и нужное разрешение", () => {
    const msg = denialReason(user("viewer"), "create");
    expect(msg).toContain("Наблюдатель");
    expect(msg.length).toBeGreaterThan(20); // не голое «Forbidden»
  });

  test("текст отказа не пустой ни для одной пары роль/право", () => {
    for (const r of ["admin", "manager", "employee", "viewer"] as AccessRole[]) {
      for (const p of ["browse", "create", "edit", "delete", "transition", "comment", "editWorkflow", "manageAccess", "manageCollaborators"] as PermId[]) {
        expect(denialReason(user(r), p).trim().length, `${r}/${p}`).toBeGreaterThan(0);
      }
    }
  });
});
