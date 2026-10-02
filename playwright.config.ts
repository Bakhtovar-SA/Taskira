import { defineConfig, devices } from "@playwright/test";

/** Визуальная регрессия и axe для библиотеки компонентов (ТЗ 5.7 п. 6): снимает /dev/ui (есть только в dev-сборке)
 *  в обеих темах и сравнивает с эталонами в e2e/__screenshots__. Запуск: `npm run test:ui`, обновить эталоны —
 *  `npm run test:ui -- --update-snapshots`. В CI — только на PR, затрагивающих src/ds (минуты платные).
 *  Эталоны сняты в Linux Chromium; на другой ОС шрифт растеризуется иначе — сравнивать только в той же среде. */
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.pw.ts",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  fullyParallel: true,
  reporter: [["list"]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide" },
  },
  use: {
    baseURL: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || "3000"}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
  webServer: {
    command: `npm run dev -- --strictPort --port ${process.env.PLAYWRIGHT_PORT || "3000"}`,
    url: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || "3000"}`,
    // An explicit test port must start this checkout, rather than reuse another worktree's server.
    reuseExistingServer: !process.env.PLAYWRIGHT_PORT && !process.env.CI,
    timeout: 60_000,
  },
});
