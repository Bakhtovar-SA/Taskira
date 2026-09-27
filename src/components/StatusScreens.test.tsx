/** Экраны состояний (ТЗ 5.12 a): BootErrorScreen (сбой загрузки / офлайн, авто-повтор при возврате сети)
 *  и NotFoundPage (прямая ссылка, которая никуда не ведёт). Прямое юнит-покрытие компонентов —
 *  App-уровневая интеграция (LoginForm не показан вместо BootErrorScreen, повтор дергает bootstrap())
 *  уже в src/App.routerSync.test.tsx; здесь — то, что не завязано на StoreProvider/bootstrap. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { BootErrorScreen, NotFoundPage } from "./StatusScreens";

const stubOnline = (value: boolean) => vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("BootErrorScreen", () => {
  test("сеть есть — заголовок «Не удалось загрузить Taskira»", () => {
    stubOnline(true);
    render(
      <I18nProvider>
        <BootErrorScreen onRetry={vi.fn()} onLogout={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Не удалось загрузить Taskira");
  });

  test("сети нет — заголовок «Нет подключения к сети»", () => {
    stubOnline(false);
    render(
      <I18nProvider>
        <BootErrorScreen onRetry={vi.fn()} onLogout={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Нет подключения к сети");
  });

  test("при монтировании (сеть уже есть) onRetry сам не вызывается", async () => {
    stubOnline(true);
    vi.useFakeTimers();
    const onRetry = vi.fn();
    render(
      <I18nProvider>
        <BootErrorScreen onRetry={onRetry} onLogout={vi.fn()} />
      </I18nProvider>,
    );
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(onRetry).not.toHaveBeenCalled();
  });

  test("сеть вернулась (offline → online, событие online) — один авто-повтор через 1500 мс, не раньше", async () => {
    const spy = stubOnline(false);
    vi.useFakeTimers();
    const onRetry = vi.fn();
    render(
      <I18nProvider>
        <BootErrorScreen onRetry={onRetry} onLogout={vi.fn()} />
      </I18nProvider>,
    );

    spy.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(onRetry).not.toHaveBeenCalled(); // ещё не прошло 1500мс

    await act(async () => {
      vi.advanceTimersByTime(1499);
    });
    expect(onRetry).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);

    // дальнейшее время (или повторные online-события без нового offline→online перехода) не повторяют вызов.
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("клик «Повторить» / «Выйти» вызывает переданные колбэки", () => {
    stubOnline(true);
    const onRetry = vi.fn();
    const onLogout = vi.fn();
    render(
      <I18nProvider>
        <BootErrorScreen onRetry={onRetry} onLogout={onLogout} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByText("Повторить"));
    fireEvent.click(screen.getByText("Выйти"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

describe("NotFoundPage", () => {
  test("показывает декодированный путь и вызывает onHome/onBack по клику", () => {
    const onHome = vi.fn();
    const onBack = vi.fn();
    render(
      <I18nProvider>
        <NotFoundPage path="/p/%D0%90%D0%90/board" onHome={onHome} onBack={onBack} />
      </I18nProvider>,
    );
    expect(screen.getByText("/p/АА/board")).toBeTruthy();
    fireEvent.click(screen.getByText("На главную"));
    fireEvent.click(screen.getByText("Назад"));
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
