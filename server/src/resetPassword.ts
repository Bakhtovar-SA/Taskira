/**
 * SEC-PWD-01 (ADR-0034): консольное восстановление пароля ЛОКАЛЬНОЙ учётки — единственный путь для администратора
 * и break-glass учётки (`ADMIN_USERNAME`), которых маршрут сброса из интерфейса не трогает (409 PASSWORD_RESET_ADMIN).
 * Нужен доступ к серверу и БД — это и есть граница доверия, а не роль в приложении.
 *
 * Делает то же, что сброс из интерфейса: временный пароль (CSPRNG) с `must_change_password` и сроком
 * `PASSWORD_RESET_TTL_HOURS`, снятие блокировки, `session_version + 1`, отзыв API-токенов. Запись `user.password.reset`
 * (actor = NULL, `via: "cli"`) идёт в той же транзакции: не записался аудит — сброса нет, пароль не напечатан.
 *
 * Работающий сервер — другой процесс. Его кэш свежести сессий и токенов живёт ≤ 30 с: после этого каждый HTTP-запрос
 * со старой сессией или токеном получает 401. Открытые WebSocket-соединения этот процесс закрыть не может
 * (closeUserSockets работает только внутри сервера): сокет живёт до разрыва/переподключения, а повторный хендшейк
 * получает отказ. По сокету идут только сигналы «перечитай уведомления», само перечитывание — HTTP и получит 401.
 *
 * Запуск в установке:  docker compose run --rm --no-deps server node dist/resetPassword.js <логин>
 * Разработка:          cd server && npx tsx src/resetPassword.ts <логин>
 * Временный пароль печатается в stdout один раз; передайте его владельцу учётки лично.
 */
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
  } else if (row.auth_source === "service") {
    console.error(`«${username}» — сервисная запись: у неё нет пароля и входа, доступ — только по API-токенам (ADR-0029)`);
    code = 1;
  } else if (row.auth_source !== "local") {
    console.error(`«${username}» — учётная запись LDAP: пароль меняется в корпоративном каталоге, не в Taskira`);
    code = 1;
  } else {
    // Аудит — в транзакции сброса: сбой записи откатывает сброс целиком (ни неучтённого сброса, ни потерянного пароля).
    const outcome = await resetLocalPassword(row, null, { allowAdmin: true, auditInTx: { username: row.username, via: "cli" } });
    if (!outcome) {
      console.error("Учётная запись изменилась во время сброса — запустите ещё раз");
      code = 1;
    } else {
      console.log(`Временный пароль для «${row.username}»: ${outcome.temporaryPassword}`);
      console.log(`Действует до ${outcome.expiresAt}; при входе потребуется задать свой пароль.`);
      console.log(
        `Отозвано API-токенов: ${outcome.revokedTokens}. Старые сессии и токены получат 401 не позже чем через 30 секунд; ` +
          "открытые WebSocket-вкладки закроются при переподключении (по ним идут только сигналы уведомлений).",
      );
    }
  }
} catch (e) {
  console.error("Сброс не выполнен, изменения откатены:", e instanceof Error ? e.message : e);
  code = 1;
} finally {
  await closePool();
}
process.exit(code);
