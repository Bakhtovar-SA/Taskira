import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { departmentsApi, usersApi } from "../api";
import { I18nProvider } from "../i18n";

vi.mock("../store", () => ({ useStore: () => ({
  data: { projects: [], departments: [{ id: "d1", name: "Product", ldapGroupDn: null }] },
  can: () => true, authMode: "local", createDepartment: vi.fn(), renameDepartment: vi.fn(),
  deleteDepartment: vi.fn(), switchProject: vi.fn(), setView: vi.fn(),
}) }));
import AdminView from "./AdminView";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

test("поиск участника не добавляет ранее выбранного человека после изменения запроса", async () => {
  vi.spyOn(departmentsApi, "listMembers").mockResolvedValue([]);
  vi.spyOn(usersApi, "pickable").mockResolvedValue([{ id: "u2", name: "Sam Member", jobRole: "Engineer", initials: "SM", color: "#0B5FD9" }]);
  const add = vi.spyOn(departmentsApi, "addMember");
  render(<I18nProvider><AdminView /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Состав" }));
  const search = await screen.findByRole("combobox");
  fireEvent.focus(search);
  fireEvent.input(search, { target: { value: "Sam" } });
  await screen.findByText("Sam Member");
  fireEvent.keyDown(search, { key: "Enter" });
  const submit = screen.getByRole("button", { name: "Добавить" });
  expect(submit.getAttribute("aria-disabled")).toBeNull();
  fireEvent.input(search, { target: { value: "Alex" } });
  expect(submit.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(submit);
  expect(add).not.toHaveBeenCalled();
});
