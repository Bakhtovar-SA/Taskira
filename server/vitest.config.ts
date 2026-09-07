import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // env.ts задаёт DATABASE_URL_TEST / JWT_SECRET ДО первого loadConfig()
    setupFiles: ["./test/env.ts"],
    // global-setup.ts пересоздаёт схему taskira_test и гоняет миграции один раз
    globalSetup: ["./test/global-setup.ts"],
    // Все файлы делят одну тестовую БД — параллелить нельзя
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
