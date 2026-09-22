#!/usr/bin/env -S npx tsx
/**
 * ТЗ 4.3: устанавливает выпущенный токен в instance.license_key — "заполняемый вручную" механизм
 * из плана: не UI покупки/апгрейда (явно исключён из ТЗ), а операционный скрипт, ровно как
 * scripts/generate-license.ts рядом. Проверяет токен ЛОКАЛЬНО (тем же verifyLicenseToken(), что
 * использует работающий сервер) перед записью — оператор узнаёт о неизвестном kid/битой подписи
 * сразу, а не через сутки на следующей фоновой проверке.
 *
 * Не идёт через services/instance.ts getInstance()/invalidateInstanceCache() — этот скрипт другой
 * процесс, тот кэш живёт только в памяти работающего сервера и здесь недостижим; это ожидаемо, не
 * упущение (см. комментарий в services/license.ts getLicenseStatus() — она читает license_key
 * отдельным SELECT именно поэтому).
 *
 * Запуск: DATABASE_URL=... npx tsx scripts/install-license.ts <token>
 *     или: DATABASE_URL=... npx tsx scripts/install-license.ts < token.txt
 */
import { initPool, one, closePool } from "../src/db.js";
import { verifyLicenseToken } from "../src/services/license.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL не задан");
  process.exit(2);
}

const token = process.argv[2] ?? (await readStdin());
if (!token) {
  console.error("Нужен токен лицензии: аргументом или через stdin");
  process.exit(2);
}

const result = verifyLicenseToken(token);
if (!result.ok && result.reason !== "expired") {
  console.error(`Токен не прошёл проверку: ${result.reason}. Ничего не записано.`);
  process.exit(1);
}
if (result.reason === "expired") {
  console.error("ВНИМАНИЕ: этот токен уже просрочен — устанавливается всё равно (grace period), но перевыпустите новый.");
}
const claims = result.claims!;

initPool(databaseUrl);
try {
  const row = await one<{ id: number }>(
    `UPDATE instance SET license_key = $1, license_expires_at = to_timestamp($2) WHERE id = 1 RETURNING id`,
    [token, claims.exp],
  );
  if (!row) {
    console.error("Строка instance не найдена — сервер ещё ни разу не стартовал (нет seedInstance())?");
    process.exit(1);
  }
  console.log(
    `Лицензия установлена: план=${claims.plan}, maxSeats=${claims.maxSeats}, ` +
      `истекает=${new Date(claims.exp * 1000).toISOString()}. Изменение подхватится проверкой лицензии ` +
      "работающего сервера в течение суток (или сразу при следующем его старте) — services/license.ts " +
      "читает instance.license_key напрямую, без кэша.",
  );
} finally {
  await closePool();
}
