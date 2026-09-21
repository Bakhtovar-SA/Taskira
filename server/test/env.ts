/**
 * Тестовое окружение. Импортируется в setupFiles (в воркерах) и в global-setup
 * (в главном процессе) — ДО первого loadConfig().
 *
 * Тесты идут в ОТДЕЛЬНОЙ БД `taskira_test`, а не в схеме внутри рабочей БД (TEST-01). Причина: расширения
 * (`pg_trgm`, `pgcrypto`) принадлежат базе, а не схеме; сброс тестовой схемы через `DROP SCHEMA … CASCADE`
 * удалял расширение вместе с триграммными индексами всех остальных схем той же БД — молча, без ошибки.
 * Переопределяется `DATABASE_URL_TEST` (в CI — та же схема из docker-сервиса Postgres).
 */
const DEFAULT_TEST_URL = "postgresql://taskira:taskira@localhost:5432/taskira_test";

export const TEST_DB_URL = process.env.DATABASE_URL_TEST || DEFAULT_TEST_URL;
export const TEST_JWT_SECRET = "test-jwt-secret-do-not-use-in-prod-0000000000";

const testDbUrl = (() => {
  try {
    return new URL(TEST_DB_URL);
  } catch {
    throw new Error("DATABASE_URL_TEST — некорректный URL подключения");
  }
})();
export const TEST_DB_NAME = decodeURIComponent(testDbUrl.pathname.replace(/^\//, ""));

// Защита от прогона по dev/prod-базе: имя БД должно быть taskira_test…, а схемный режим (search_path в
// options) больше не поддерживается — он и был причиной TEST-01.
if (!/^taskira_test/.test(TEST_DB_NAME)) {
  throw new Error(
    `DATABASE_URL_TEST должен указывать на БД taskira_test. Получено БД «${TEST_DB_NAME}». ` +
      "Это защита от случайного прогона тестов по dev/prod-базе.",
  );
}
if (testDbUrl.searchParams.has("options")) {
  throw new Error(
    "DATABASE_URL_TEST: параметр options (search_path) не поддерживается — тесты идут в отдельной БД " +
      "taskira_test, а не в схеме рабочей БД (TEST-01). Уберите options из URL.",
  );
}

process.env.DATABASE_URL = TEST_DB_URL;
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.ADMIN_USERNAME = "test_admin";
process.env.ADMIN_PASSWORD = "Test-Secure-Admin-42!";
process.env.NODE_ENV = "test";
// Лимиты запросов выключаются ЯВНО (боевой код больше не смотрит на NODE_ENV сам).
process.env.RATE_LIMIT_ENABLED = "false";
// Кэш исполнителей фильтра выключен, чтобы тесты видели изменения сразу; сам кэш проверяет ttlCache.test.ts.
process.env.ASSIGNEES_CACHE_TTL_MS = "0";

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
