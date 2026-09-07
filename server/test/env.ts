/**
 * Тестовое окружение. Импортируется в setupFiles (в воркерах) и в global-setup
 * (в главном процессе) — ДО первого loadConfig().
 *
 * По умолчанию тесты идут по СХЕМЕ `taskira_test` внутри dev-БД
 * (`options=-csearch_path=taskira_test,public`) — отдельная БД и права CREATEDB
 * не нужны, dev-схема `public` не затрагивается. Переопределяется
 * `DATABASE_URL_TEST` (напр. отдельная БД в CI).
 */
const DEFAULT_TEST_URL =
  "postgresql://taskira:taskira@localhost:5432/taskira?options=-csearch_path%3Dtaskira_test%2Cpublic";

export const TEST_DB_URL = process.env.DATABASE_URL_TEST || DEFAULT_TEST_URL;
export const TEST_JWT_SECRET = "test-jwt-secret-do-not-use-in-prod-0000000000";

if (!/taskira_test/.test(TEST_DB_URL)) {
  throw new Error(
    `DATABASE_URL_TEST должен указывать на taskira_test (схему или БД). Получено: ${TEST_DB_URL}. ` +
      "Это защита от случайного прогона тестов по dev/prod-базе.",
  );
}

process.env.DATABASE_URL = TEST_DB_URL;
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.NODE_ENV = "test";

// Вложения (миграция 010): драйвер local во временный каталог, чтобы прогон
// тестов не писал в server/var/. global-setup.ts чистит его перед прогоном.
import { tmpdir } from "node:os";
import { join } from "node:path";
export const TEST_STORAGE_DIR = process.env.STORAGE_DIR || join(tmpdir(), "taskira-test-attachments");
process.env.STORAGE_DIR = TEST_STORAGE_DIR;
// Маленькие лимиты — чтобы тесты «слишком большой файл» / «слишком много вложений»
// не гоняли мегабайты и десятки запросов.
process.env.ATTACH_MAX_BYTES = process.env.ATTACH_MAX_BYTES || "4096";
process.env.ATTACH_MAX_PER_ISSUE = process.env.ATTACH_MAX_PER_ISSUE || "5";
