import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  testMatch: "workspace-modules.pw.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || 28182}`,
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : undefined,
  },
  webServer: [
    {
      command:
        "node server/node_modules/tsx/dist/cli.mjs server/test/workspace.e2e-server.ts",
      url: "http://127.0.0.1:28181/health",
      timeout: 60000,
      reuseExistingServer: false,
    },
    {
      command: "node scripts/workspace-preview.mjs",
      url: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || 28182}`,
      reuseExistingServer: false,
    },
  ],
});
