/**
 * SEC-PWD-01 (ADR-0034): консольное восстановление пароля ЛОКАЛЬНОЙ учётки — единственный путь для администратора
 * и break-glass учётки (`ADMIN_USERNAME`), которых маршрут сброса из интерфейса не трогает (409 PASSWORD_RESET_ADMIN).
 * Нужен доступ к серверу и БД — это и есть граница доверия, а не роль в приложении.
 *
 * Делает то же, что сброс из интерфейса: временный пароль (CSPRNG) с `must_change_password` и сроком
 * `PASSWORD_RESET_TTL_HOURS`, снятие блокировки, `session_version + 1`, отзыв API-токенов, запись в audit_log
 * (actor = NULL, `via: "cli"`). Работающий сервер — другой процесс: его кэш свежести сессий и токенов живёт ≤ 30 с,
 * после этого старые сессии получают 401.
 *
 * Запуск в установке:  docker compose run --rm --no-deps server node dist/resetPassword.js <логин>
 * Разработка:          cd server && npx tsx src/resetPassword.ts <логин>
 * Временный пароль печатается в stdout один раз; передайте его владельцу учётки лично.
 */
import { audit } from "./audit.js";
import type { UserRow } from "./auth.js";
import { initConfig } from "./config.js";
import { closePool, initPool, one } from "./db.js";
import { resetLocalPassword } from "./services/passwords.js";

const username = process.argv[2]?.trim();
if (!username) {
  console.error("Укажите логин: node dist/resetPassword.js <логин>");
  process.exit(2);
}

const cfg = initConfig();
initPool(cfg.databaseUrl, cfg.pgPoolMax, cfg.pgPoolIdleTimeoutMs);
let code = 0;
try {
  const row = await one<UserRow>(`SELECT * FROM users WHERE username = $1`, [username]);
  if (!row) {
    console.error(`Пользователь «${username}» не найден`);
    code = 1;
  } else if (row.auth_source !== "local") {
    console.error(`«${username}» — не локальная учётная запись (${row.auth_source}): пароль меняется в каталоге`);
    code = 1;
  } else {
    const outcome = await resetLocalPassword(row, null, { allowAdmin: true });
    if (!outcome) {
      console.error("Учётная запись изменилась во время сброса — запустите ещё раз");
      code = 1;
    } else {
      await audit(null, "user.password.reset", "user", row.id, {
        username: row.username,
        via: "cli",
        expiresAt: outcome.expiresAt,
        revokedTokens: outcome.revokedTokens,
      });
      console.log(`Временный пароль для «${row.username}»: ${outcome.temporaryPassword}`);
      console.log(`Действует до ${outcome.expiresAt}; при входе потребуется задать свой пароль.`);
      console.log(`Отозвано API-токенов: ${outcome.revokedTokens}. Прежние сессии перестанут работать в течение 30 секунд.`);
    }
  }
} finally {
  await closePool();
}
process.exit(code);
