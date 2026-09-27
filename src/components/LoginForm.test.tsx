/** Характеризация экрана входа (ТЗ 5.12 a, шаг 1 — снята ДО переписывания): что должно пережить новый вид. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { ApiError, authApi } from "../api";
import LoginForm from "./LoginForm";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

const renderForm = (onSuccess = vi.fn()) => {
  render(
    <I18nProvider>
      <LoginForm onSuccess={onSuccess} />
    </I18nProvider>,
  );
  return onSuccess;
};
const fill = (u: string, p: string) => {
  fireEvent.change(screen.getByLabelText("Логин"), { target: { value: u } });
  fireEvent.change(screen.getByLabelText("Пароль", { selector: "input" }), { target: { value: p } });
};
const submitBtn = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const submit = () => act(async () => {
  fireEvent.click(submitBtn());
  await Promise.resolve();
});

describe("вход", () => {
  test("логин обрезается по краям, пароль — нет; после успеха — onSuccess", async () => {
    const login = vi.spyOn(authApi, "login").mockResolvedValue({ token: "t", user: {} as never });
    const onSuccess = renderForm();
    fill("  admin ", " pass word ");
    await submit();
    expect(login).toHaveBeenCalledWith("admin", " pass word ");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  test("отказ сервера — его причина в сообщении (русская локаль), onSuccess не вызывается", async () => {
    vi.spyOn(authApi, "login").mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Неверный логин или пароль"));
    const onSuccess = renderForm();
    fill("admin", "x");
    await submit();
    expect(screen.getByRole("alert").textContent).toContain("Неверный логин или пароль");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test("пока идёт запрос — повторно не отправляется", async () => {
    let resolve!: () => void;
    const login = vi.spyOn(authApi, "login").mockImplementation(() => new Promise((r) => (resolve = () => r({ token: "t", user: {} as never }))));
    renderForm();
    fill("admin", "x");
    await submit();
    await submit();
    expect(login).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
  });
});
