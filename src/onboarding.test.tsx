/** Клиентский онбординг (ТЗ 5.11): `Hint`, `GettingStarted` и модуль `onboarding.ts` (внешнее хранилище,
 *  ADR-0011). Онбординг — необязательный слой: сеть мокается через `onboardingApi` (`./api`), стор — модульный
 *  синглтон, поэтому каждый тест сбрасывает его в `afterEach` через `resetOnboarding()`. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "./i18n";
import { onboardingApi } from "./api";
import { loadOnboarding, markThemeStep, refreshOnboardingSoon, resetOnboarding, STEPS } from "./onboarding";
import type { OnboardingDto } from "../server/src/contract";

vi.mock("./store", () => ({ useStore: () => ({ setView: vi.fn() }) }));

import { Hint } from "./components/Hint";
import { GettingStarted } from "./components/GettingStarted";

const dto = (over: Partial<OnboardingDto> = {}): OnboardingDto => ({ done: [], hidden: false, hints: [], ...over });

/** Прогоняет промис `onboardingApi.get()`/`markTheme()` внутри `act`, чтобы дождаться реакции на обновление
 *  внешнего хранилища у уже смонтированных компонентов. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderHint(id = "savedViews") {
  return render(
    <I18nProvider>
      <Hint id={id}>Тестовая подсказка</Hint>
    </I18nProvider>,
  );
}

function renderGS() {
  return render(
    <I18nProvider>
      <GettingStarted />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  resetOnboarding();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Hint", () => {
  test("ничего не рендерит, пока онбординг не загружен", () => {
    const { container } = renderHint();
    expect(container.textContent).toBe("");
  });

  test("после loadOnboarding() показывает текст подсказки", async () => {
    vi.spyOn(onboardingApi, "get").mockResolvedValue(dto());
    renderHint();
    loadOnboarding();
    await flush();
    expect(screen.getByRole("note").textContent).toContain("Тестовая подсказка");
  });

  test("клик по крестику сразу скрывает подсказку и вызывает onboardingApi.dismissHint(id)", async () => {
    vi.spyOn(onboardingApi, "get").mockResolvedValue(dto());
    const dismiss = vi.spyOn(onboardingApi, "dismissHint").mockResolvedValue(undefined);
    renderHint("savedViews");
    loadOnboarding();
    await flush();
    expect(screen.queryByRole("note")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Понятно, больше не показывать" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(dismiss).toHaveBeenCalledWith("savedViews");
  });

  test("подсказка, чей id уже в hints с сервера, никогда не показывается", async () => {
    vi.spyOn(onboardingApi, "get").mockResolvedValue(dto({ hints: ["savedViews"] }));
    const { container } = renderHint("savedViews");
    loadOnboarding();
    await flush();
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("GettingStarted", () => {
  test("done: [open_issue, comment] — прогресс «2 из 5», 5 шагов, выполненные помечены data-done", async () => {
    vi.spyOn(onboardingApi, "get").mockResolvedValue(dto({ done: ["open_issue", "comment"] }));
    renderGS();
    loadOnboarding();
    await flush();
    expect(screen.getByText("2 из 5")).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
    const done = items.filter((li) => li.getAttribute("data-done") !== null);
    expect(done).toHaveLength(2);
    const notDone = items.filter((li) => li.getAttribute("data-done") === null);
    expect(notDone).toHaveLength(3);
  });

  test("«Скрыть навсегда» убирает карточку и вызывает onboardingApi.hide", async () => {
    vi.spyOn(onboardingApi, "get").mockResolvedValue(dto());
    const hide = vi.spyOn(onboardingApi, "hide").mockResolvedValue(undefined);
    const { container } = renderGS();
    loadOnboarding();
    await flush();
    expect(screen.queryByRole("heading", { name: "Начало работы" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Скрыть навсегда" }));
    expect(screen.queryByRole("heading", { name: "Начало работы" })).toBeNull();
    expect(container.textContent).toBe("");
    expect(hide).toHaveBeenCalled();
  });

  test("hidden: true с сервера — карточка не рендерится", async () => {
    vi.spyOn(onboardingApi, "get").mockResolvedValue(dto({ hidden: true }));
    const { container } = renderGS();
    loadOnboarding();
    await flush();
    expect(container.textContent).toBe("");
  });

  test("все 5 шагов выполнены — заголовок «Всё готово», списка шагов нет", async () => {
    vi.spyOn(onboardingApi, "get").mockResolvedValue(dto({ done: [...STEPS] }));
    renderGS();
    loadOnboarding();
    await flush();
    expect(screen.getByText("Всё готово")).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("refreshOnboardingSoon()", () => {
  test("не запрашивает заново, когда все шаги пройдены", async () => {
    const get = vi.spyOn(onboardingApi, "get").mockResolvedValue(dto({ done: [...STEPS] }));
    loadOnboarding();
    await flush();
    expect(get).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    refreshOnboardingSoon();
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  test("не запрашивает заново, когда карточка скрыта", async () => {
    const get = vi.spyOn(onboardingApi, "get").mockResolvedValue(dto({ hidden: true }));
    loadOnboarding();
    await flush();
    expect(get).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    refreshOnboardingSoon();
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("markThemeStep()", () => {
  test("вызывает onboardingApi.markTheme только пока шаг theme не пройден", async () => {
    vi.spyOn(onboardingApi, "get").mockResolvedValue(dto({ done: [] }));
    loadOnboarding();
    await flush();
    const markTheme = vi.spyOn(onboardingApi, "markTheme").mockResolvedValue(dto({ done: ["theme"] }));

    markThemeStep();
    await flush();
    expect(markTheme).toHaveBeenCalledTimes(1);

    markThemeStep();
    await flush();
    expect(markTheme).toHaveBeenCalledTimes(1);
  });
});
