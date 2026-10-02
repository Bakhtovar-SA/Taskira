import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { User } from "../types";
import AssigneePicker, { projectAssignees } from "./AssigneePicker";

const user = (id: string, name: string, username: string): User => ({ id, name, username, initials: "Т", color: "", role: "Разработчик", phone: "", globalRole: "member", accessRole: "employee", avatarUpdatedAt: null });
const data = { users: [user("a", "Анна Иванова", "anna"), user("b", "Бахтовар Сафарлизод", "bakhtovar"), user("outside", "Анна другая", "other")], members: { a: "employee" as const, b: "viewer" as const } };
afterEach(cleanup);

test("search uses project membership, name and login; former assignees remain removable", () => {
  expect(projectAssignees(data, [], "АННА").map(user => user.id)).toEqual(["a"]);
  expect(projectAssignees(data, [], " bakhtovar ").map(user => user.id)).toEqual(["b"]);
  expect(projectAssignees(data, ["outside"], "other").map(user => user.id)).toEqual(["outside"]);
  expect(projectAssignees(data, [], "other")).toEqual([]);
});

test("filtering does not lose selected members and toggles the selected result", () => {
  let selection = ["a"];
  const ui = render(<I18nProvider><AssigneePicker data={data} selected={selection} onChange={ids => { selection = ids; }} /></I18nProvider>);
  const search = screen.getByRole("searchbox");
  fireEvent.change(search, { target: { value: "bakhtovar" } });
  fireEvent.click(screen.getByRole("button", { name: /Бахтовар Сафарлизод/ }));
  expect(selection).toEqual(["a", "b"]);
  ui.rerender(<I18nProvider><AssigneePicker data={data} selected={selection} onChange={ids => { selection = ids; }} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Бахтовар Сафарлизод/ }));
  expect(selection).toEqual(["a"]);
  fireEvent.change(search, { target: { value: "нет такого сотрудника" } });
  expect(screen.getByText("Сотрудники не найдены")).toBeTruthy();
});
