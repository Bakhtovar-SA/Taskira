import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider, loadLang } from "../../i18n";
import { adminApi } from "../../api";
import { OrgSection } from "./OrgSettings";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("../../store", () => ({ useStore: () => ({ toast }) }));
vi.mock("../../api", async original => ({ ...await original<typeof import("../../api")>(),
  adminApi: { maintenance: vi.fn(), runMaintenance: vi.fn() },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(adminApi.maintenance).mockResolvedValue({ enabled: false, jobs: [], settings: {
    intervalMs: 3600000, startDelayMs: 300000, batchSize: 500, batchPauseMs: 0, maxPerRun: 1000,
    archiveAfterDays: 30, auditRetentionDays: 90,
  } });
  vi.mocked(adminApi.runMaintenance).mockImplementation(async dryRun => ({
    archived: 0, auditPurged: 0, opsRunsPurged: dryRun ? 1234 : 1000, capped: true, dryRun,
  }));
});
afterEach(() => { cleanup(); localStorage.clear(); });

test.each([
  ["ru", "Проверить", "Запустить сейчас", /отчётов операций: 1234/, /отчётов операций 1000/],
  ["en", "Check", "Run now", /operation reports: 1234/, /operation reports 1000/],
] as const)("%s maintenance explains an operation-report-only cleanup in preview and completion", async (lang, check, run, preview, done) => {
  await loadLang(lang); localStorage.setItem("taskira.lang", lang);
  render(<I18nProvider><OrgSection section="maintenance" /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: check }));
  const hint = await screen.findByText(preview);
  expect(hint.textContent).toContain(lang === "ru" ? "остальное доделают следующие" : "the next passes will finish it");
  expect(adminApi.runMaintenance).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: run }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: run }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("success", expect.stringMatching(done)));
  expect(adminApi.runMaintenance).toHaveBeenCalledWith(false);
  expect(screen.queryByText(preview)).toBeNull();
});
