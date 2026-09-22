#!/usr/bin/env -S npx tsx
/**
 * ТЗ 4.3: выпуск офлайн-лицензии. Приватный ключ читается только из файла на диске, переданного
 * явно — никогда не хардкожен и не подразумевается по умолчанию (см. docs/LICENSE_KEYS.md, где
 * этот ключ должен физически храниться). Публичная половина той же пары — под тем же `--kid` —
 * должна быть добавлена в server/src/licenseTrustedKeys.ts и задеплоена клиенту ДО того, как
 * выпущенная этим вызовом лицензия до него доедет, иначе сервер клиента ответит unknown_kid.
 *
 * Запуск: npx tsx scripts/generate-license.ts \
 *   --private-key ~/.taskira-license/2026-09.pem --kid 2026-09 \
 *   --plan pro --max-seats 500 --expires-in-days 365 [--active-window-days 30] \
 *   [--features sso,sprints] [--issued-to "ООО Клиент"]
 */
import { readFileSync } from "node:fs";
import { signLicense, type LicenseClaims } from "../src/services/license.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function requireArg(name: string): string {
  const v = arg(name);
  if (!v) {
    console.error(`Отсутствует обязательный аргумент --${name}`);
    process.exit(2);
  }
  return v;
}

const privateKeyPath = requireArg("private-key");
const kid = requireArg("kid");
const plan = requireArg("plan");
const maxSeats = Number(requireArg("max-seats"));
if (!Number.isInteger(maxSeats) || maxSeats < 1) {
  console.error("--max-seats должен быть положительным целым числом");
  process.exit(2);
}

const expiresInDaysArg = arg("expires-in-days");
const expiresAtArg = arg("expires-at"); // ISO-дата, альтернатива --expires-in-days
if (!expiresInDaysArg && !expiresAtArg) {
  console.error("Нужен --expires-in-days <N> или --expires-at <ISO-дата>");
  process.exit(2);
}
const exp = expiresAtArg
  ? Math.floor(new Date(expiresAtArg).getTime() / 1000)
  : Math.floor(Date.now() / 1000) + Number(expiresInDaysArg) * 86400;
if (!Number.isFinite(exp)) {
  console.error("Некорректная дата истечения");
  process.exit(2);
}

// Дефолт 30 — см. services/license.ts (файловый комментарий, п.2): N дней "активности" для
// подсчёта seats — часть подписанного документа, не константа сервера, зафиксировать это в
// переговорах с клиентом и в docs (docs/LICENSE_KEYS.md), а не оставлять неявным здесь.
const activeWindowDays = Number(arg("active-window-days") ?? 30);
const features = (arg("features") ?? "")
  .split(",")
  .map((f) => f.trim())
  .filter(Boolean);
const issuedTo = arg("issued-to");

let privateKeyPem: string;
try {
  privateKeyPem = readFileSync(privateKeyPath, "utf8");
} catch (e) {
  console.error(`Не удалось прочитать приватный ключ ${privateKeyPath}:`, (e as Error).message);
  process.exit(1);
}

const claims: Omit<LicenseClaims, "iat"> = { plan, maxSeats, features, activeWindowDays, exp, ...(issuedTo ? { issuedTo } : {}) };
const token = signLicense(claims, privateKeyPem, kid);

console.log(token);
console.error(
  `\n[generate-license] kid=${kid} plan=${plan} maxSeats=${maxSeats} activeWindowDays=${activeWindowDays} ` +
    `expires=${new Date(exp * 1000).toISOString()} features=[${features.join(", ")}]`,
);
