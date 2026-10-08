import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { SystemStatusDto } from "../server/src/contract";
const checkedAt = "2026-10-06T12:00:00Z";
const status: SystemStatusDto = { version: "1.2.3", checkedAt, checks: [
  { id: "database", state: "fail", facts: { latencyMs: 3.5, pendingMigrations: ["fixture-migration.sql"] } },
  { id: "storage", state: "ok", facts: { driver: "local", freeBytes: 8 * 1024 ** 3, totalBytes: 50 * 1024 ** 3 } },
  { id: "mail", state: "warn", facts: { enabled: true, pending: 12, oldestPendingSec: 2400, failed24h: 1 } },
  { id: "ldap", state: "off", facts: { mode: "local", lastSuccessAt: null, lastError: null } },
  { id: "jobs", state: "ok", facts: { jobs: [{ name: "maintenance", lastSuccessAt: checkedAt, lastResult: "success", intervalMs: 3600_000 }] } },
  { id: "license", state: "ok", facts: { status: "active", expiresAt: "2027-10-06T12:00:00Z", seatsUsed: 15, seatsLimit: 100 } },
  { id: "search", state: "warn", facts: { missingIndexes: ["idx_issues_active_title_trgm"] } },
  { id: "backup", state: "ok", facts: { lastSuccessAt: "2026-10-06T11:00:00Z", lastRunAt: "2026-10-06T11:00:00Z", lastResult: "success", archive: "taskira-backup.tar.gz" } },
  { id: "restoreDrill", state: "unknown", facts: { lastSuccessAt: null, lastRunAt: null, lastResult: null, archive: null } },
  { id: "webhooks", state: "off", facts: { enabled: false, active: 0, disabled: 0, pending: 0, oldestPendingSec: null, failed24h: 0 } },
  { id: "recurring", state: "ok", facts: { active: 3, paused: 1, ownerLostAccess: 0, failed24h: 0 } },
] };
for (const theme of ["light", "dark"] as const) test(`system status and host history · ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1450 });
  await page.clock.setFixedTime(new Date(checkedAt)); await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript(value => localStorage.setItem("taskira.theme", value), theme);
  const user = { id: "u1", username: "admin", name: "Anna Admin", initials: "AA", color: "", jobRole: "", globalRole: "admin", isActive: true,
    authSource: "local", favoriteProjectIds: [], notifyPrefs: {}, onboarding: { hidden: true } };
  const pageErrors: string[] = []; page.on("pageerror", error => pageErrors.push(error.message));
  let histories = 0, requests = 0;
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()); if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname.slice(4); let body: unknown = [];
    if (path === "/auth/me") body = user;
    else if (path === "/auth/config") body = { authMode: "local" };
    else if (path === "/users") body = [user];
    else if (path === "/projects") body = [];
    else if (path === "/issues/assigned-to-me") body = { items: [], truncated: false, limit: 100 };
    else if (path === "/instance/brand") body = { name: null, hue: null, logoUpdatedAt: null, transparencyDefault: "auto" };
    else if (path === "/me/onboarding") body = { done: [], hints: [], hidden: true };
    else if (path === "/admin/setup") body = { completed: true };
    else if (path === "/notifications") body = { items: [], nextCursor: null };
    else if (path === "/notifications/unread-count") body = { count: 0 };
    else if (path === "/admin/status") { requests++; body = status; }
    else if (path === "/admin/ops-runs") {
      histories++; expect(url.searchParams.get("kind")).toBe("backup"); expect(url.searchParams.get("limit")).toBe("5");
      body = [{ id: "run-1", kind: "backup", startedAt: checkedAt, finishedAt: checkedAt, result: "interrupted",
        host: "fixture", archive: "interrupted-backup.tar.gz", appVersion: "1.2.3", details: {}, error: "" }];
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/admin/health");
  await expect(page.getByRole("heading", { name: "Состояние системы", exact: true })).toBeVisible();
  await expect(page.getByText("Сбоев: 1 · Требует внимания: 2", { exact: true })).toBeVisible();
  const checks = page.getByRole("list", { name: "Проверки системы" });
  await expect(checks.getByRole("heading").first()).toHaveText("База данных");
  await expect(page.getByText(/fixture-migration.sql/)).toBeVisible(); await expect(page.getByText(/idx_issues_active_title_trgm/)).toBeVisible();
  expect(histories).toBe(0); expect(requests).toBe(1);
  await page.screenshot({ path: test.info().outputPath(`system-status-${theme}.png`), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations.map(value => value.id)).toEqual([]);
  const backup = checks.locator("li").filter({ has: page.getByRole("heading", { name: "Резервные копии", exact: true }) }).first();
  const summary = backup.locator("summary"); await summary.click();
  await expect(backup.getByText("interrupted-backup.tar.gz")).toBeVisible(); await expect(backup.getByText("прервано", { exact: true })).toBeVisible();
  await summary.click(); await summary.click(); expect(histories).toBe(1);
  await page.screenshot({ path: test.info().outputPath(`system-status-history-${theme}.png`), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations.map(value => value.id)).toEqual([]); expect(pageErrors).toEqual([]);
});
