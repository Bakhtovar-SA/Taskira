import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { OpsRunDto, SystemCheck, SystemStatusDto } from "../../../server/src/contract";
import { I18nProvider, loadLang } from "../../i18n";
import { adminApi } from "../../api";
vi.mock("../../api", async original => ({ ...await original<typeof import("../../api")>(),
  adminApi: { status: vi.fn(), opsRuns: vi.fn() },
}));
import SystemStatus from "./SystemStatus";

const checkedAt = "2026-10-06T12:00:00Z";
const fixture = (): SystemStatusDto => ({ version: "1.2.3", checkedAt, checks: [
  { id: "database", state: "fail", facts: { latencyMs: 2, pendingMigrations: ["fixture-migration.sql"] } },
  { id: "storage", state: "ok", facts: { driver: "local", freeBytes: 4 * 1024 ** 3, totalBytes: 20 * 1024 ** 3 } },
  { id: "mail", state: "warn", facts: { enabled: true, pending: 2, oldestPendingSec: 2400, failed24h: 1 } },
  { id: "ldap", state: "off", facts: { mode: "local", lastSuccessAt: null, lastError: null } },
  { id: "jobs", state: "ok", facts: { jobs: [{ name: "maintenance", lastSuccessAt: checkedAt, lastResult: "success", intervalMs: 3600_000 }] } },
  { id: "license", state: "ok", facts: { status: "active", expiresAt: "2027-10-06T12:00:00Z", seatsUsed: 10, seatsLimit: 50 } },
  { id: "search", state: "ok", facts: { missingIndexes: [] } },
  { id: "backup", state: "ok", facts: { lastSuccessAt: "2026-10-06T11:00:00Z", lastRunAt: "2026-10-06T11:00:00Z", lastResult: "success", archive: "backup.tar.gz" } },
  { id: "restoreDrill", state: "unknown", facts: { lastSuccessAt: null, lastRunAt: null, lastResult: null, archive: null } },
  { id: "webhooks", state: "off", facts: { enabled: false, active: 0, disabled: 0, pending: 0, oldestPendingSec: null, failed24h: 0 } },
  { id: "recurring", state: "warn", facts: { active: 2, paused: 1, ownerLostAccess: 1, failed24h: 0 } },
] });
const run: OpsRunDto = { id: "run-1", kind: "backup", startedAt: checkedAt, finishedAt: checkedAt, result: "success",
  host: "fixture", archive: "history-backup.tar.gz", appVersion: "1.2.3", details: {}, error: null };
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.mocked(adminApi.status).mockResolvedValue(fixture()); vi.mocked(adminApi.opsRuns).mockResolvedValue([run]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });
const show = () => render(<I18nProvider><SystemStatus /></I18nProvider>);
function card(name: string) { return within(screen.getByRole("heading", { name }).closest("li")!); }
function update(id: SystemCheck["id"], fn: (check: SystemCheck) => SystemCheck) {
  const data = fixture(); data.checks = data.checks.map(check => check.id === id ? fn(check) : check); vi.mocked(adminApi.status).mockResolvedValue(data);
}

test("приоритет: fail, warn, unknown, ok, off; миграции и возраст почты видны", async () => {
  show(); await screen.findByText("Сбоев: 1 · Требует внимания: 2");
  const list = screen.getByRole("list", { name: "Проверки системы" });
  const names = within(list).getAllByRole("heading", { level: 2 }).map(node => node.textContent);
  expect(names.slice(0, 4)).toEqual(["База данных", "Почта", "Повторяющиеся задачи", "Репетиция восстановления"]);
  expect(names.slice(-2)).toEqual(["LDAP", "Вебхуки"]);
  expect(card("База данных").getByText(/fixture-migration.sql/)).toBeTruthy();
  expect(card("Почта").getByText(/40 минут назад/)).toBeTruthy();
  expect(card("Хранилище вложений").getByText("Свободно 4 ГиБ из 20 ГиБ")).toBeTruthy();
});
test.each(["ru", "en"] as const)("сводки и состояния на языке %s", async lang => {
  await loadLang(lang); localStorage.setItem("taskira.lang", lang);
  show(); await screen.findByText(lang === "ru" ? "Сбоев: 1 · Требует внимания: 2" : "Failures: 1 · Needs attention: 2");
  cleanup(); const data = fixture(); data.checks = data.checks.map(check => ({ ...check, state: "ok" }));
  vi.mocked(adminApi.status).mockResolvedValue(data); show();
  await screen.findByText(lang === "ru" ? "Всё в порядке" : "Everything is healthy");
});
test("прерванный бэкап, unknown и ссылки на источники", async () => {
  update("backup", check => check.id === "backup" ? { ...check, state: "fail", facts: { ...check.facts, lastResult: "interrupted" } } : check);
  show(); await screen.findByText(/Последний запуск: прервано/);
  expect(card("Репетиция восстановления").getByText("Не удалось проверить")).toBeTruthy();
  expect(card("Фоновые задания").getByRole("link", { name: "Обслуживание" }).getAttribute("href")).toBe("/admin/maintenance");
  expect(card("Вебхуки").getByRole("link").getAttribute("href")).toBe("/help");
});
test("предупреждение поиска сохраняет имена отсутствующих индексов и последствия", async () => {
  update("search", check => check.id === "search" ? { ...check, state: "warn", facts: { missingIndexes: ["idx_issues_active_title_trgm"] } } : check);
  show(); await screen.findByText(/idx_issues_active_title_trgm/);
  expect(card("Поиск").getByText(/Поиск может замедлиться/)).toBeTruthy();
});
test("история загружается один раз при первом раскрытии каждого вида", async () => {
  vi.mocked(adminApi.opsRuns).mockResolvedValue([{ ...run, result: "failure", error: "operation_failed" }]);
  show();
  await screen.findByRole("heading", { name: "Резервные копии" }); expect(adminApi.opsRuns).not.toHaveBeenCalled();
  const backup = card("Резервные копии").getByText("Последние 5 запусков");
  fireEvent.click(backup); await screen.findByText("history-backup.tar.gz");
  expect(document.body.textContent).not.toContain("operation_failed");
  expect(adminApi.opsRuns).toHaveBeenCalledExactlyOnceWith("backup");
  fireEvent.click(backup); fireEvent.click(backup); await waitFor(() => expect(adminApi.opsRuns).toHaveBeenCalledTimes(1));
  fireEvent.click(card("Репетиция восстановления").getByText("Последние 5 запусков"));
  await waitFor(() => expect(adminApi.opsRuns).toHaveBeenCalledWith("restore_drill"));
});
test("ошибка истории повторяется отдельно; ошибка всего статуса имеет повтор", async () => {
  vi.mocked(adminApi.status).mockRejectedValueOnce(new Error("Fixture outage")); show();
  await screen.findByRole("alert"); fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  await screen.findByText("Сбоев: 1 · Требует внимания: 2");
  vi.mocked(adminApi.opsRuns).mockRejectedValueOnce(new Error("History unavailable"));
  fireEvent.click(card("Резервные копии").getByText("Последние 5 запусков"));
  await waitFor(() => expect(card("Резервные копии").getByRole("alert")).toBeTruthy());
  fireEvent.click(card("Резервные копии").getByRole("button", { name: "Повторить" }));
  await screen.findByText("history-backup.tar.gz"); expect(adminApi.status).toHaveBeenCalledTimes(2); expect(adminApi.opsRuns).toHaveBeenCalledTimes(2);
});
test("четыре skeleton-карточки во время загрузки", () => {
  vi.mocked(adminApi.status).mockImplementation(() => new Promise(() => undefined)); show();
  const loading = screen.getByRole("status", { name: /Загруз/ }); expect(loading.children).toHaveLength(4); expect(loading.getAttribute("aria-busy")).toBe("true");
});
test("без опроса; явное обновление меняет снимок и сбрасывает историю", async () => {
  show(); await screen.findByText("Сбоев: 1 · Требует внимания: 2");
  vi.useFakeTimers(); await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); expect(adminApi.status).toHaveBeenCalledTimes(1); vi.useRealTimers();
  fireEvent.click(card("Резервные копии").getByText("Последние 5 запусков")); await screen.findByText("history-backup.tar.gz");
  const data = fixture(); data.checkedAt = "2026-10-06T12:01:00Z"; data.checks = data.checks.map(check => ({ ...check, state: "ok" })); vi.mocked(adminApi.status).mockResolvedValue(data);
  fireEvent.click(screen.getByRole("button", { name: "Обновить" })); await screen.findByText("Всё в порядке");
  expect(card("Резервные копии").queryByText("history-backup.tar.gz")).toBeNull();
  fireEvent.click(card("Резервные копии").getByText("Последние 5 запусков")); await screen.findByText("history-backup.tar.gz"); expect(adminApi.opsRuns).toHaveBeenCalledTimes(2);
});
