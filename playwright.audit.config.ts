import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const production = process.env.AUDIT_PRODUCTION === "1";
const port = process.env.PLAYWRIGHT_PORT || "3111";
export default defineConfig({
  ...base,
  testMatch: production ? ["design-audit.pw.ts"] : ["design-audit.pw.ts", "combobox-async.pw.ts"],
  timeout: 60_000,
  expect: { ...base.expect, timeout: 10_000 },
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}`, reducedMotion: "reduce" },
  projects: ["chromium", "firefox", "webkit"].map(browserName => ({ name: browserName, use: { browserName: browserName as "chromium" | "firefox" | "webkit" } })),
  webServer: { command: production ? "node scripts/preview-production.mjs" : `npm run dev -- --strictPort --port ${port}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 60_000 },
});
