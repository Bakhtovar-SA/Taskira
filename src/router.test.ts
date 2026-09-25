import { describe, expect, test } from "vitest";
import { EMPTY_FILTERS, filtersFromSearch, parsePath, pathForIssue, pathForView, samePlace, searchFromFilters } from "./router";

describe("pathForView / pathForIssue", () => {
  test("ADR-0013 §5: разделы без проекта — свои пути, представления и настройки — под /p/:projectKey", () => {
    expect(pathForView("CORP", "reports")).toBe("/reports");
    expect(pathForView("CORP", "admin")).toBe("/admin/departments");
    expect(pathForView("CORP", "docs")).toBe("/help");
    expect(pathForView("CORP", "inbox")).toBe("/inbox");
    expect(pathForView("CORP", "my")).toBe("/my-issues");
    expect(pathForView("CORP", "collaborating")).toBe("/shared");
    expect(pathForView("CORP", "board")).toBe("/p/CORP/board");
    expect(pathForView("CORP", "backlog")).toBe("/p/CORP/list");
    expect(pathForView("CORP", "workflow")).toBe("/p/CORP/settings/workflow");
    expect(pathForView("CORP", "access")).toBe("/p/CORP/settings/access");
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
    expect(parsePath("/admin/departments")).toEqual({ kind: "global", view: "admin" });
    expect(parsePath("/help")).toEqual({ kind: "global", view: "docs" });
    expect(parsePath("/shared/")).toEqual({ kind: "global", view: "collaborating" });
    expect(parsePath("/inbox")).toEqual({ kind: "global", view: "inbox" });
    expect(parsePath("/my-issues")).toEqual({ kind: "global", view: "my" });
  });

  test("старые адреса (до ADR-0013) разбираются в тот же вид, что новые", () => {
    expect(parsePath("/p/CORP/backlog")).toEqual({ kind: "view", projectKey: "CORP", view: "backlog" });
    expect(parsePath("/p/CORP/list")).toEqual({ kind: "view", projectKey: "CORP", view: "backlog" });
    expect(parsePath("/p/CORP/workflow")).toEqual({ kind: "view", projectKey: "CORP", view: "workflow" });
    expect(parsePath("/p/CORP/settings/workflow")).toEqual({ kind: "view", projectKey: "CORP", view: "workflow" });
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
    const f = { status: "s1", assignee: "none", type: "bug", priority: "critical", label: "urgent" };
    expect(filtersFromSearch(`?${searchFromFilters("", f)}`)).toEqual(f);
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
});
