import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n";
import { PersonalSection } from "./PersonalSettings";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
test("appearance choice persists and updates the html attribute", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  localStorage.setItem("taskira.transparency", "off");
  render(<I18nProvider><PersonalSection section="appearance" /></I18nProvider>);
  const options = within(screen.getByRole("radiogroup", { name: "Прозрачность" }));
  expect((options.getByLabelText("Выключена") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(options.getByLabelText("Включена"));
  expect(localStorage.getItem("taskira.transparency")).toBe("on");
  expect(document.documentElement.dataset.transparency).toBe("on");
  expect(screen.getByText("Включён повышенный контраст — стекло может снижать читаемость")).toBeTruthy();
  fireEvent.click(options.getByLabelText("Как в системе"));
  expect(document.documentElement.dataset.transparency).toBe("off");
  expect(screen.getByText("Система просит меньше прозрачности — стекло выключено")).toBeTruthy();
});
