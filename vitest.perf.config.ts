import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * ТЗ 5.2 / ADR-0011 — тот же замер перерисовок, что идёт в `npm test`
 * (src/perf/rerenders.test.tsx), но с печатью таблиц (TASKIRA_PERF_REPORT) и
 * 7 повторами на сценарий. Запуск: npm run perf:rerenders. Переменная задаётся
 * здесь, а не в npm-скрипте, чтобы команда одинаково работала в Windows.
 * Отдельный конфиг, а не mergeConfig(vitest.config): mergeConfig склеивает
 * массивы include, и запускался бы весь набор тестов.
 */
export default defineConfig({
  plugins: [react({ jsxImportSource: "#secure-jsx" })],
  test: {
    include: ["src/perf/**/*.test.tsx"],
    environment: "jsdom",
    globals: false,
    restoreMocks: true,
    env: { TASKIRA_PERF_REPORT: "1" },
    silent: false,
    reporters: ["verbose"],
  },
});
