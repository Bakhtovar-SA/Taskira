import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const port = process.env.PLAYWRIGHT_PORT || "3199";
export default defineConfig({
  ...base,
  testMatch: ["pr118-feedback.pw.ts", "uploads-help-brand.pw.ts", "navigation-reminders.pw.ts", "workspace-ux.pw.ts", "workspace-controls.pw.ts", "appearance-layout.pw.ts", "tokens.pw.ts", "recurring.pw.ts", "system-status.pw.ts"],
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { command: "node scripts/preview-production.mjs", url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
});
