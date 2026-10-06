import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { usersApi } from "../api";
import PermissionsView from "./PermissionsView";
const { setMemberRole,state } = vi.hoisted(() => ({ setMemberRole: vi.fn(),state: { admin: true } }));
vi.mock("../store",() => ({ useStore: () => ({
  me: { id: "admin",name: "Admin",role: "",globalRole: state.admin ? "admin" : "member",accessRole: state.admin ? "admin" : "manager" },
  data: { currentProjectId: "p1",project: { key: "TEST",name: "Project" },members: { existing: "employee" },
    users: [{ id: "admin",name: "Admin",globalRole: "admin" },{ id: "existing",name: "Existing Robot",globalRole: "member",authSource: "service" }] },
  can: () => true,setMemberRole,removeMember: vi.fn(),
}) }));
vi.mock("../api",async original => ({ ...await original<typeof import("../api")>(),usersApi: { pickable: vi.fn(),list: vi.fn() } }));
vi.mock("./settings/parts",() => ({ PersonAvatar: () => null,RoleTag: () => null,ROLE_TONE: { admin: "red",manager: "indigo",employee: "blue",viewer: "gray" } }));
beforeEach(() => { vi.resetAllMocks(); state.admin=true; localStorage.setItem("taskira.lang","ru");
  vi.mocked(usersApi.pickable).mockResolvedValue([
    { id: "service",name: "Sync Robot",initials: "SR",color: "",jobRole: "Integration",authSource: "service" },
    { id: "existing",name: "Existing Robot",initials: "ER",color: "",jobRole: "",authSource: "service" },
    { id: "admin",name: "Admin",initials: "A",color: "",jobRole: "",authSource: "local" },
  ]);
});
afterEach(() => { cleanup(); localStorage.clear(); });
test("admin searches service accounts without loading the directory and can add the selected account",async () => {
  render(<I18nProvider><PermissionsView /></I18nProvider>);
  const field=screen.getByRole("combobox",{ name: "Добавить участника" }); fireEvent.focus(field); fireEvent.change(field,{ target: { value: "s" } });
  await new Promise(done => setTimeout(done,250)); expect(usersApi.pickable).not.toHaveBeenCalled();
  fireEvent.change(field,{ target: { value: "sy" } });
  await waitFor(() => expect(usersApi.pickable).toHaveBeenCalledWith("sy",true));
  const option=await screen.findByRole("option",{ name: /Sync Robot/,hidden: true });
  expect(screen.queryByRole("option",{ name: /Existing Robot/,hidden: true })).toBeNull(); expect(screen.queryByRole("option",{ name: /^Admin$/,hidden: true })).toBeNull(); expect(option.textContent).toContain("сервис");
  fireEvent.mouseDown(option); fireEvent.click(screen.getByRole("button",{ name: "Создать" }));
  expect(setMemberRole).toHaveBeenCalledWith("service","employee"); expect((screen.getByRole("combobox",{ name: "Добавить участника" }) as HTMLInputElement).value).toBe("");
  expect(usersApi.list).not.toHaveBeenCalled(); expect(screen.getAllByText("сервис").length).toBeGreaterThan(0);
});
test("project managers search ordinary accounts and editing the query clears the old selection",async () => {
  state.admin=false; render(<I18nProvider><PermissionsView /></I18nProvider>);
  const field=screen.getByRole("combobox",{ name: "Добавить участника" }); fireEvent.focus(field); fireEvent.change(field,{ target: { value: "sy" } });
  await waitFor(() => expect(usersApi.pickable).toHaveBeenCalledWith("sy",false));
  fireEvent.mouseDown(await screen.findByRole("option",{ name: /Sync Robot/,hidden: true }));
  fireEvent.input(field,{ target: { value: "another" } });
  expect(screen.getByRole("button",{ name: "Создать" }).getAttribute("aria-disabled")).toBe("true");
});
