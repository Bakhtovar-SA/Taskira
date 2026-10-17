import { expect, test } from "vitest";
import { boardMoveRows } from "./boardMoves";
import type { Issue } from "./types";

const issue = (id: string, rank: number, rest: Partial<Issue> = {}) => ({ id, rank, statusId: "s1", dueDate: "2026-09-28", doneAt: null, archivedAt: null, ...rest }) as Issue;
const options = { overdueOnly: true, doneStatus: false, today: "2026-09-30" };

test("same-column move under overdue filtering only repositions the moved card", () => {
  const rows = [issue("a", 30), issue("moved", 40), issue("b", 10), issue("c", 20)];
  const updated = issue("moved", 15);
  const result = boardMoveRows(rows, new Map([[updated.id, updated]]), "s1", new Map([[updated.id, "s1"]]), options);
  expect(result.map(i => i.id)).toEqual(["moved", "a", "b", "c"]);
  expect(result.filter(i => i.id !== "moved")).toEqual([rows[0], rows[2], rows[3]]);
  expect(result[0]).toBe(updated);
});

test("overdue projection excludes missing, today's and future deadlines, archived rows and done statuses", () => {
  const rows = [issue("past", 1), issue("none", 2, { dueDate: null }), issue("today", 3, { dueDate: options.today }), issue("future", 4, { dueDate: "2026-10-01" }), issue("archived", 5, { archivedAt: 1 })];
  const cached = new Map(rows.map(i => [i.id, i]));
  const moves = new Map(rows.map(i => [i.id, "s1"]));
  expect(boardMoveRows([], cached, "s1", moves, options).map(i => i.id)).toEqual(["past"]);
  expect(boardMoveRows([], cached, "s1", moves, { ...options, doneStatus: true })).toEqual([]);
});

test("failed/unconfirmed transitions cannot introduce a card into the destination", () => {
  const row = issue("moved", 1);
  expect(boardMoveRows([], new Map([[row.id, row]]), "s2", new Map([[row.id, "s2"]]), options)).toEqual([]);
});

test("пакетная смена статуса: серверная строка новее устаревшей копии в сторе — карточка остаётся в новой колонке", () => {
  const stale = issue("bulk", 1, { statusId: "s1", updatedAt: 100 });
  const server = issue("bulk", 1, { statusId: "s2", updatedAt: 200 });
  const result = boardMoveRows([server], new Map([[stale.id, stale]]), "s2", new Map(), { overdueOnly: false, doneStatus: false });
  expect(result.map(i => i.id)).toEqual(["bulk"]);
  expect(result[0].statusId).toBe("s2");
});

test("правка из стора, которая новее серверной строки, по-прежнему побеждает (оптимистичное обновление)", () => {
  const server = issue("a", 1, { statusId: "s1", updatedAt: 100 });
  const local = issue("a", 1, { statusId: "s1", updatedAt: 300, title: "правка" } as Partial<Issue>);
  const result = boardMoveRows([server], new Map([[local.id, local]]), "s1", new Map(), { overdueOnly: false, doneStatus: false });
  expect(result[0]).toBe(local);
});

test("an old same-column rank move belongs to exactly one of recent/older pages",()=>{
  const now=Date.parse("2026-10-04T12:00:00Z"),old=issue("old",10,{doneAt:Date.parse("2026-09-01T12:00:00Z"),updatedAt:now});
  const cache=new Map([[old.id,old]]),moves=new Map([[old.id,"s1"]]),opts={overdueOnly:false,doneStatus:true,closedDays:14,now};
  expect(boardMoveRows([],cache,"s1",moves,{...opts,closed:"recent"})).toEqual([]);
  expect(boardMoveRows([old],cache,"s1",moves,{...opts,closed:"older"}).map(i=>i.id)).toEqual(["old"]);
});
test("a newly completed or migrated task enters recent but not the old tail",()=>{
  const now=Date.parse("2026-10-04T12:00:00Z"),rows=[issue("new",1,{doneAt:now}),issue("migrated",2,{doneAt:null})];
  const cache=new Map(rows.map(i=>[i.id,i])),moves=new Map(rows.map(i=>[i.id,"s1"])),opts={overdueOnly:false,doneStatus:true,closedDays:14,now};
  expect(boardMoveRows([],cache,"s1",moves,{...opts,closed:"recent"}).map(i=>i.id)).toEqual(["new","migrated"]);
  expect(boardMoveRows([],cache,"s1",moves,{...opts,closed:"older"})).toEqual([]);
});
test("server window membership stays authoritative despite a skewed local clock",()=>{
  const row=issue("server",1,{doneAt:1});
  expect(boardMoveRows([row],new Map(),"s1",new Map(),{overdueOnly:false,doneStatus:true,closed:"recent",now:Date.parse("2030-01-01T00:00:00Z")})).toEqual([row]);
});
