/** SEC-PWD-01: «Сбросить пароль» — только у локальных участников; администраторов сервер не сбрасывает (409
 *  PASSWORD_RESET_ADMIN), себя — тоже, LDAP — тем более. Временный пароль показывается один раз. */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../../i18n";
import { usersApi, type SafeUser } from "../../api";
import { OrgSection } from "./OrgSettings";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("../../store", () => ({ useStore: () => ({ toast, authMode: "local", me: { id: "me" } }) }));
vi.mock("../../api", async (original) => ({
  ...(await original<typeof import("../../api")>()),
  usersApi: { list: vi.fn(), patch: vi.fn(), create: vi.fn(), resetPassword: vi.fn() },
}));

const user = (id: string, name: string, over: Partial<SafeUser> = {}): SafeUser => ({
  id, username: id, name, givenName: null, initials: "XX", color: "#334455", jobRole: "", phone: "",
  globalRole: "member", isActive: true, authSource: "local", avatarUpdatedAt: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.setItem("taskira.lang", "ru");
  vi.mocked(usersApi.list).mockResolvedValue([
    user("me", "Я Сам", { globalRole: "admin" }),
    user("a2", "Другой Админ", { globalRole: "admin" }),
    user("m1", "Мария Участник"),
    user("l1", "Лев Каталогов", { authSource: "ldap" }),
  ]);
  vi.mocked(usersApi.resetPassword).mockResolvedValue({ temporaryPassword: "Abcde-Fghjk-Mnpqr-Stuvw", expiresAt: "2026-10-08T12:00:00Z", revokedTokens: 2 });
});
afterEach(() => { cleanup(); localStorage.clear(); });

test("reset is offered only for local non-admin users other than me, and shows the password once", async () => {
  render(<I18nProvider><OrgSection section="users" /></I18nProvider>);
  await screen.findByText("Мария Участник");
  const buttons = screen.getAllByRole("button", { name: /^Сбросить пароль:/ });
  expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Сбросить пароль: Мария Участник"]);

  fireEvent.click(buttons[0]);
  expect(screen.getByText(/API-токены будут отозваны/)).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Сбросить" }));
  expect(((await screen.findByRole("textbox", { name: "Временный пароль" })) as HTMLInputElement).value).toBe("Abcde-Fghjk-Mnpqr-Stuvw");
  expect(usersApi.resetPassword).toHaveBeenCalledWith("m1");
});
