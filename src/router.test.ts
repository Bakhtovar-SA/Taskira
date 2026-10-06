import { describe, expect, test } from "vitest";
import { EMPTY_FILTERS, customFieldCondition, filtersFromSearch, parsePath, pathForIssue, pathForView, samePlace, searchFromFilters } from "./router";

describe("pathForView / pathForIssue", () => {
  test("personal tokens and service accounts have stable projectless settings URLs",() => {
    expect(pathForView("CORP","settings","tokens")).toBe("/settings/tokens");
    expect(parsePath("/settings/tokens")).toEqual({ kind: "global",view: "settings",section: "tokens" });
    expect(pathForView("CORP","orgSettings","service-accounts")).toBe("/admin/service-accounts");
    expect(parsePath("/admin/service-accounts")).toEqual({ kind: "global",view: "orgSettings",section: "service-accounts" });
  });
  test("project integrations have a settings URL",() => {
    expect(pathForView("CORP","projectSettings","integrations")).toBe("/p/CORP/settings/integrations");
    expect(parsePath("/p/CORP/settings/integrations")).toEqual({ kind: "view",projectKey: "CORP",view: "projectSettings",section: "integrations" });
  });
  test("calendar has a project URL and preserves same-place navigation", () => {
    expect(pathForView("CORP", "calendar")).toBe("/p/CORP/calendar");
    expect(parsePath("/p/CORP/calendar")).toEqual({ kind: "view", projectKey: "CORP", view: "calendar" });
    expect(samePlace("/p/CORP/calendar", "/p/CORP/calendar/")).toBe(true);
    expect(samePlace("/p/CORP/calendar", "/p/CORP/timeline")).toBe(false);
  });
  test("ADR-0013 §5: разделы без проекта — свои пути, представления и настройки — под /p/:projectKey", () => {
    expect(pathForView("CORP", "reports")).toBe("/reports");
    expect(pathForView("CORP", "orgSettings")).toBe("/admin/departments");
    expect(pathForView("CORP", "orgSettings", "users")).toBe("/admin/users");
    expect(pathForView("CORP", "settings")).toBe("/settings/profile");
    expect(pathForView("CORP", "settings", "appearance")).toBe("/settings/appearance");
    expect(pathForView("CORP", "projectSettings")).toBe("/p/CORP/settings/general");
    expect(pathForView("CORP", "docs")).toBe("/help");
    expect(pathForView("CORP", "inbox")).toBe("/inbox");
    expect(pathForView("CORP", "my")).toBe("/my-issues");
    expect(pathForView("CORP", "collaborating")).toBe("/shared");
    expect(pathForView("CORP", "board")).toBe("/p/CORP/board");
    expect(pathForView("CORP", "backlog")).toBe("/p/CORP/list");
    expect(pathForView("CORP", "projectSettings", "workflow")).toBe("/p/CORP/settings/workflow");
    expect(pathForView("CORP", "projectSettings", "access")).toBe("/p/CORP/settings/access");
    expect(pathForView("CORP", "projectSettings", "nonsense")).toBe("/p/CORP/settings/general");
  });

  test("issue — всегда /p/:projectKey/issue/:issueKey", () => {
    expect(pathForIssue("CORP", "CORP-123")).toBe("/p/CORP/issue/CORP-123");
  });

  test("проектный ключ и ключ задачи кодируются в URL", () => {
    expect(pathForView("A B", "board")).toBe("/p/A%20B/board");
    expect(pathForIssue("A B", "A B-1")).toBe("/p/A%20B/issue/A%20B-1");
  });
});

describe("parsePath", () => {
  test("разделы без проекта → kind global", () => {
    expect(parsePath("/reports")).toEqual({ kind: "global", view: "reports" });
    expect(parsePath("/admin/departments")).toEqual({ kind: "global", view: "orgSettings", section: "departments" });
    expect(parsePath("/admin")).toEqual({ kind: "global", view: "orgSettings", section: "departments" });
    expect(parsePath("/settings/language")).toEqual({ kind: "global", view: "settings", section: "language" });
    expect(parsePath("/settings")).toEqual({ kind: "global", view: "settings", section: "profile" });
    expect(parsePath("/settings/nonsense")).toEqual({ kind: "root" });
    expect(parsePath("/help")).toEqual({ kind: "global", view: "docs" });
    expect(parsePath("/shared/")).toEqual({ kind: "global", view: "collaborating" });
    expect(parsePath("/inbox")).toEqual({ kind: "global", view: "inbox" });
    expect(parsePath("/my-issues")).toEqual({ kind: "global", view: "my" });
  });

  test("старые адреса (до ADR-0013) разбираются в тот же вид, что новые", () => {
    expect(parsePath("/p/CORP/backlog")).toEqual({ kind: "view", projectKey: "CORP", view: "backlog" });
    expect(parsePath("/p/CORP/list")).toEqual({ kind: "view", projectKey: "CORP", view: "backlog" });
    expect(parsePath("/p/CORP/workflow")).toEqual({ kind: "view", projectKey: "CORP", view: "projectSettings", section: "workflow" });
    expect(parsePath("/p/CORP/settings/workflow")).toEqual({ kind: "view", projectKey: "CORP", view: "projectSettings", section: "workflow" });
    expect(parsePath("/p/CORP/settings")).toEqual({ kind: "view", projectKey: "CORP", view: "projectSettings", section: "general" });
    // Разделы без проекта по старому адресу — та же форма, что у нового (ревью PR #93): без ключа проекта.
    expect(parsePath("/p/CORP/admin")).toEqual({ kind: "global", view: "orgSettings", section: "departments" });
    expect(parsePath("/p/CORP/docs")).toEqual({ kind: "global", view: "docs" });
    expect(parsePath("/p/OLD/collaborating")).toEqual({ kind: "global", view: "collaborating" });
    expect(samePlace("/p/CORP/docs", "/help")).toBe(true);
    expect(samePlace("/p/CORP/admin", "/admin/departments")).toBe(true);
    expect(samePlace("/p/OLD/collaborating", "/shared")).toBe(true);
    expect(parsePath("/p/CORP/settings/nonsense")).toEqual({ kind: "root" });
    expect(samePlace("/p/CORP/backlog", "/p/CORP/list")).toBe(true);
    expect(samePlace("/p/CORP/access", "/p/CORP/settings/access")).toBe(true);
    expect(samePlace("/p/CORP/board", "/p/CORP/list")).toBe(false);
  });

  test("/p/:key/issue/:key → kind issue, ключи декодированы", () => {
    expect(parsePath("/p/CORP/issue/CORP-123")).toEqual({ kind: "issue", projectKey: "CORP", issueKey: "CORP-123" });
    expect(parsePath("/p/A%20B/issue/A%20B-1")).toEqual({ kind: "issue", projectKey: "A B", issueKey: "A B-1" });
  });

  test("/p/:key/<вид> → kind view для известных видов, root для неизвестных", () => {
    expect(parsePath("/p/CORP/board")).toEqual({ kind: "view", projectKey: "CORP", view: "board" });
    expect(parsePath("/p/CORP/nonsense")).toEqual({ kind: "root" });
  });

  test("неизвестный/пустой путь → root, не ошибка (терпимость старого readIssueHash к чужому формату)", () => {
    expect(parsePath("/")).toEqual({ kind: "root" });
    expect(parsePath("/random")).toEqual({ kind: "root" });
    expect(parsePath("/p/CORP")).toEqual({ kind: "root" }); // без сегмента вида
  });

  test("сломанный %-escape в пути не бросает исключение — используется как есть", () => {
    expect(() => parsePath("/p/%/issue/%")).not.toThrow();
  });
});

describe("filtersFromSearch / searchFromFilters — ТЗ 3.2", () => {
  test("пустой search → все поля пустые (EMPTY_FILTERS)", () => {
    expect(filtersFromSearch("")).toEqual(EMPTY_FILTERS);
  });

  test("читает только известные ключи, игнорирует посторонние query-параметры", () => {
    const f = filtersFromSearch("?status=s1&priority=high&foo=bar");
    expect(f).toEqual({ ...EMPTY_FILTERS, status: "s1", priority: "high" });
  });

  test("searchFromFilters: непустые поля пишутся, пустые — убираются из URL", () => {
    const qs = searchFromFilters("", { ...EMPTY_FILTERS, status: "s1", label: "urgent" });
    const p = new URLSearchParams(qs);
    expect(p.get("status")).toBe("s1");
    expect(p.get("label")).toBe("urgent");
    expect(p.has("assignee")).toBe(false);
  });

  test("round-trip: filtersFromSearch(searchFromFilters(f)) === f", () => {
    const f = { status: "s1", assignee: "none", type: "bug", priority: "critical", label: "urgent", sprintId: "sp1", dueFrom: "2026-09-01", dueTo: "2026-09-30", cf: "f1", cfValue: "", cfFrom: "10", cfTo: "20", cfEmpty: "" };
    expect(filtersFromSearch(`?${searchFromFilters("", f)}`)).toEqual(f);
  });

  test("условие по своему полю: только при выбранном поле и заданном значении; «не задано» важнее значения", () => {
    expect(customFieldCondition({ ...EMPTY_FILTERS, cfValue: "x" })).toBeNull();
    expect(customFieldCondition({ ...EMPTY_FILTERS, cf: "f1" })).toBeNull();
    expect(customFieldCondition({ ...EMPTY_FILTERS, cf: "f1", cfValue: "Москва" })).toEqual({ cf: "f1", cfValue: "Москва" });
    expect(customFieldCondition({ ...EMPTY_FILTERS, cf: "f1", cfFrom: "5" })).toEqual({ cf: "f1", cfFrom: "5" });
    expect(customFieldCondition({ ...EMPTY_FILTERS, cf: "f1", cfValue: "x", cfEmpty: "1" })).toEqual({ cf: "f1", cfEmpty: "1" });
  });

  test("сохраняет посторонние query-параметры, уже присутствующие в current", () => {
    const qs = searchFromFilters("?sort=due&dir=desc", { ...EMPTY_FILTERS, status: "s1" });
    const p = new URLSearchParams(qs);
    expect(p.get("sort")).toBe("due");
    expect(p.get("dir")).toBe("desc");
    expect(p.get("status")).toBe("s1");
  });

  test("extra (overdue/done): непустое значение пишется, пустое — снимает параметр", () => {
    const qs = searchFromFilters("?overdue=1", EMPTY_FILTERS, { overdue: "", done: "1" });
    const p = new URLSearchParams(qs);
    expect(p.has("overdue")).toBe(false);
    expect(p.get("done")).toBe("1");
  });

  test("дашборды: /dashboards, /dashboards/:id и обзор проекта /p/KEY/overview (ADR-0022)", () => {
    expect(parsePath("/dashboards")).toEqual({ kind: "global", view: "dashboards" });
    expect(parsePath("/dashboards/abc-1")).toEqual({ kind: "global", view: "dashboards", section: "abc-1" });
    expect(pathForView("CORP", "dashboards", "abc-1")).toBe("/dashboards/abc-1");
    expect(pathForView("CORP", "dashboards")).toBe("/dashboards");
    expect(parsePath("/p/CORP/overview")).toEqual({ kind: "view", projectKey: "CORP", view: "overview" });
    expect(pathForView("CORP", "overview")).toBe("/p/CORP/overview");
  });
});
