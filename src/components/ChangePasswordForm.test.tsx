/** SEC-PWD-01: форма смены пароля (личные настройки). */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider, loadLang } from "../i18n";
import { ApiError, authApi } from "../api";
import { ChangePasswordForm } from "./ChangePasswordForm";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

const show = (onDone = vi.fn()) => {
  render(<I18nProvider><ChangePasswordForm onDone={onDone} /></I18nProvider>);
  return onDone;
};
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => act(async () => {
  fireEvent.click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
  await Promise.resolve();
});

describe("ChangePasswordForm", () => {
  test("sends current and new password, clears the fields and reports success", async () => {
    const change = vi.spyOn(authApi, "changePassword").mockResolvedValue({ token: "t", user: {} as never, mustChangePassword: false });
    const onDone = show();
    type("Текущий пароль", "old secret value");
    type("Новый пароль", "violet lantern quietly orbits");
    type("Повторите новый пароль", "violet lantern quietly orbits");
    await submit();
    expect(change).toHaveBeenCalledWith("old secret value", "violet lantern quietly orbits");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Новый пароль") as HTMLInputElement).value).toBe("");
  });

  test("short or mismatched passwords are flagged locally and not sent", async () => {
    const change = vi.spyOn(authApi, "changePassword");
    show();
    type("Текущий пароль", "old secret value");
    type("Новый пароль", "short-one");
    type("Повторите новый пароль", "short-two");
    expect(document.body.textContent).toContain("Не короче 14 символов");
    expect(document.body.textContent).toContain("Пароли не совпадают");
    await submit();
    expect(change).not.toHaveBeenCalled();
  });

  test("a server refusal is shown through errText in English, without the Russian reason", async () => {
    await loadLang("en");
    localStorage.setItem("taskira.lang", "en");
    vi.spyOn(authApi, "changePassword").mockRejectedValue(new ApiError(403, "CURRENT_PASSWORD_INVALID", "Текущий пароль указан неверно"));
    const onDone = show();
    type("Current password", "wrong");
    type("New password", "violet lantern quietly orbits");
    type("Repeat the new password", "violet lantern quietly orbits");
    await submit();
    expect(screen.getByRole("alert").textContent).toBe("The current password is incorrect");
    expect(onDone).not.toHaveBeenCalled();
  });
});
