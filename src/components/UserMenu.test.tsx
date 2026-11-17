import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n";

const { store } = vi.hoisted(() => {
  const user = { id: "u1", name: "Test User", role: "Engineer", username: "test", accessRole: "employee", globalRole: "member", avatarUpdatedAt: null };
  return { store: {
    data: { currentUserId: "u1", project: { name: "Project" } },
    me: user,
    idx: { users: new Map([["u1", user]]) },
    uploadAvatar: vi.fn(), removeAvatar: vi.fn(),
  } };
});
vi.mock("../store", () => ({ useStore: () => store }));
vi.mock("../ds/floating", async original => ({
  ...await original<typeof import("../ds/floating")>(),
  useAnchored: () => {},
}));
import { UserMenu } from "./UserMenu";

afterEach(cleanup);

test("user profile survives lazy opening and focuses its visible avatar action", async () => {
  const logout = vi.fn();
  render(<I18nProvider><UserMenu onLogout={logout} /></I18nProvider>);
  const stub = screen.getByRole("button", { name: "Меню пользователя" });
  stub.focus();
  fireEvent.click(stub);
  await waitFor(() => expect(screen.getByRole("button", { name: "Меню пользователя" }).getAttribute("aria-expanded")).toBe("true"));
  const button = screen.getByRole("button", { name: "Меню пользователя" });
  const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
  expect(panel).toBeTruthy();
  expect(panel.textContent).toContain("Test User");
  const upload = screen.getByRole("button", { name: "Загрузить фото", hidden: true });
  expect(document.activeElement).toBe(upload);
  expect(panel.querySelectorAll('[aria-haspopup="dialog"]')).toHaveLength(0);
  expect(logout).not.toHaveBeenCalled();

  fireEvent.keyDown(panel, { key: "Escape" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Загрузить фото", hidden: true }));
});
