/**
 * ТЗ 4.3 (план v2, Трек 4): офлайн-лицензия инсталляции. Формат — подписанный JWT-подобный токен
 * (header.payload.signature, base64url(JSON) для header/payload, RS256), но подписывается ОТДЕЛЬНОЙ
 * от пользовательских сессий парой ключей (не JWT_SECRET из @fastify/jwt: тот — симметричный, общий
 * секрет процесса, не то, что можно безопасно превратить в "публичный ключ на стороне сервера" —
 * лицензия асимметрична: приватный ключ остаётся только у вас, публичный можно закоммитить). Подпись/
 * проверка реализованы через node:crypto напрямую, без нового npm-пакета: единственный алгоритм (RS256),
 * единственная форма токена — переиспользование общей JWT-библиотеки не экономит код, а добавляет
 * поверхность разбора чужого формата поверх untrusted-входа (сам license_key).
 *
 * Два пункта, которые план v2 прямо выделил как обязательные с первого дня, не как доработку потом:
 *
 *  1. `kid` в заголовке + реестр НЕСКОЛЬКИХ доверенных публичных ключей (licenseTrustedKeys.ts),
 *     не один захардкоженный ключ. Без kid ротация подписывающего ключа невозможна навсегда: старые
 *     выпущенные лицензии перестали бы проверяться в момент смены ключа, а утечка приватного ключа
 *     была бы сценарием без выхода (перевыпустить с новым ключом — значит сломать все уже проданные
 *     лицензии). С kid: новый ключ добавляется в реестр РЯДОМ со старым, старые лицензии продолжают
 *     проверяться по старому kid, пока не истекут (см. docs/LICENSE_KEYS.md).
 *  2. Подсчёт "активных мест" — НЕ count(*) от users. LDAP JIT-провижининг (routes/auth.ts
 *     provisionFromLdap, services/departmentSync.ts resyncAllLdapUsers) создаёт строки в users
 *     автоматически, без участия покупателя — при первом входе любого сотрудника И при фоновом
 *     ресинке AD-групп. Первый же клиент с деревом AD на несколько тысяч человек пробил бы лимit
 *     мест на старте автоматически, даже если реально Taskira пользуются 40 человек. Считаем
 *     активными тех, кто логинился за последние `activeWindowDays` дней — и это поле в САМОЙ
 *     лицензии (с дефолтом 30 при выпуске), не константа сервера: N — предмет переговоров с
 *     конкретным клиентом, и он должен быть зафиксирован в подписанном документе, а не в
 *     конфигурации, которую можно тихо подвинуть локально.
 */
import { createSign, createVerify } from "node:crypto";
import { one } from "../db.js";
import { audit } from "../audit.js";
import { LICENSE_TRUSTED_KEYS } from "../licenseTrustedKeys.js";

export interface LicenseClaims {
  plan: string;
  maxSeats: number;
  features: string[];
  /** См. п.2 файлового комментария выше — окно "активности" для подсчёта seats, из самой лицензии. */
  activeWindowDays: number;
  /** Информационное поле (название клиента/инсталляции на выпущенном документе) — не проверяется
   *  сервером ни против чего (нет organization_id, см. docs/adr/0009-database-per-tenant.md), только
   *  для человека, читающего docs/LICENSE_KEYS.md/аудит. */
  issuedTo?: string;
  iat: number; // unix-секунды
  exp: number; // unix-секунды
}

interface LicenseHeader {
  alg: "RS256";
  kid: string;
}

export interface LicenseVerifyResult {
  ok: boolean;
  reason?: "malformed" | "unknown_kid" | "bad_signature" | "expired";
  claims?: LicenseClaims;
  header?: LicenseHeader;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");
const b64urlJson = (obj: unknown): string => b64url(Buffer.from(JSON.stringify(obj), "utf8"));

/** Подписывает лицензию приватным ключом. Используется только scripts/generate-license.ts —
 *  сервер в рантайме приватного ключа никогда не видит и не хранит. */
export function signLicense(claims: Omit<LicenseClaims, "iat">, privateKeyPem: string, kid: string): string {
  const header: LicenseHeader = { alg: "RS256", kid };
  const payload: LicenseClaims = { ...claims, iat: Math.floor(Date.now() / 1000) };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${signingInput}.${b64url(signature)}`;
}

/**
 * Проверяет токен: структура → kid известен реестру → подпись → срок. Порядок важен для точности
 * `reason`: подпись проверяется ДО срока, иначе испорченный (не тот ключ) токен с прошедшим exp
 * ошибочно отчитался бы как "expired", а не "bad_signature" — ровно два разных, не взаимозаменяемых
 * состояния в проверке ТЗ 4.3 ("просроченную" и "подписанную чужим ключом" — разные тесты).
 * `reason: "expired"` — единственный неуспешный исход, который возвращает claims/header: подпись и
 * структура подтверждены, лицензия настоящая, просто просрочена — вызывающий код (getLicenseStatus)
 * использует это для grace period, а не для жёсткого отказа.
 */
export function verifyLicenseToken(token: string, trustedKeys: Record<string, string> = LICENSE_TRUSTED_KEYS): LicenseVerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [headerB64, payloadB64, sigB64] = parts;

  let header: LicenseHeader;
  let claims: LicenseClaims;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (header?.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) return { ok: false, reason: "malformed" };
  if (typeof claims?.exp !== "number" || typeof claims?.maxSeats !== "number" || !Array.isArray(claims?.features)) {
    return { ok: false, reason: "malformed" };
  }

  const publicKeyPem = trustedKeys[header.kid];
  if (!publicKeyPem) return { ok: false, reason: "unknown_kid" };

  const signingInput = `${headerB64}.${payloadB64}`;
  let signatureValid: boolean;
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signingInput);
    verifier.end();
    signatureValid = verifier.verify(publicKeyPem, Buffer.from(sigB64, "base64url"));
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (!signatureValid) return { ok: false, reason: "bad_signature" };

  if (Date.now() / 1000 > claims.exp) return { ok: false, reason: "expired", claims, header };
  return { ok: true, claims, header };
}

/** "Активных мест" — см. файловый комментарий, пункт 2. Деактивированные (`is_active=false`)
 *  не считаются занятым местом, даже если логинились в окне: место освобождено осознанным
 *  действием администратора, а не просто отсутствием недавнего входа. */
export async function countActiveSeats(windowDays: number): Promise<number> {
  const row = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM users
      WHERE is_active AND last_login_at >= now() - make_interval(days => $1::int)`,
    [windowDays],
  );
  return row?.n ?? 0;
}

export type LicenseStatus =
  | { state: "unset" }
  | { state: "invalid"; reason: Exclude<NonNullable<LicenseVerifyResult["reason"]>, "expired"> }
  | { state: "active"; claims: LicenseClaims; seatsUsed: number; seatsOverLimit: boolean; daysUntilExpiry: number }
  | { state: "expired"; claims: LicenseClaims; seatsUsed: number; seatsOverLimit: boolean; daysSinceExpiry: number };

/**
 * Читает `instance.license_key` НАПРЯМУЮ из БД через отдельный SELECT, а НЕ через
 * services/instance.ts `getInstance()`: тот кэширует строку в памяти процесса без TTL и
 * инвалидируется только явным вызовом из ЭТОГО же процесса (см. комментарий в instance.ts).
 * `scripts/install-license.ts` пишет `license_key` отдельным, короткоживущим процессом — у
 * работающего сервера нет способа узнать, что кэш `getInstance()` устарел. Проверка лицензии
 * идёт при старте и раз в сутки (не на каждый запрос) — лишний SELECT для этого бесплатен, и
 * читать его напрямую полностью снимает вопрос устаревшего кэша, а не оставляет его как риск.
 */
export async function getLicenseStatus(trustedKeys: Record<string, string> = LICENSE_TRUSTED_KEYS): Promise<LicenseStatus> {
  const row = await one<{ license_key: string | null }>(`SELECT license_key FROM instance WHERE id = 1`);
  const token = row?.license_key;
  if (!token) return { state: "unset" };

  const result = verifyLicenseToken(token, trustedKeys);
  if (!result.ok && result.reason !== "expired") {
    return { state: "invalid", reason: result.reason! };
  }

  const claims = result.claims!;
  const seatsUsed = await countActiveSeats(claims.activeWindowDays);
  const seatsOverLimit = seatsUsed > claims.maxSeats;
  const nowSec = Date.now() / 1000;

  if (result.reason === "expired") {
    return { state: "expired", claims, seatsUsed, seatsOverLimit, daysSinceExpiry: Math.floor((nowSec - claims.exp) / 86400) };
  }
  return { state: "active", claims, seatsUsed, seatsOverLimit, daysUntilExpiry: Math.ceil((claims.exp - nowSec) / 86400) };
}

/**
 * Решение requiresPlan() (middleware.ts), вынесено в чистую функцию отдельно от Fastify-обвязки —
 * тестируется напрямую по всем состояниям лицензии, без поднятия HTTP-запроса с реальным JWT.
 * Просроченная лицензия (grace period) по-прежнему даёт доступ к фиче, если та в списке — ТЗ 4.3
 * прямо просит "без отказа в работе" при истечении, а не только "без отказа в основной функциональности".
 */
export function licenseHasFeature(status: LicenseStatus, feature: string): boolean {
  const claims = status.state === "active" || status.state === "expired" ? status.claims : null;
  return claims?.features.includes(feature) ?? false;
}

/**
 * "Проверка при старте + раз в сутки; при истечении — предупреждение администратору в UI и
 * запись в audit log, без отказа в работе" (ТЗ 4.3). Пишет в audit_log при истечении/
 * неисправной лицензии/превышении мест — это и есть текущая форма "предупреждения": маршрут,
 * который показывал бы это в UI администратора, в это ТЗ намеренно не входит (как requiresPlan()
 * ниже — инфраструктура готова, подключение к интерфейсу/фичам отдельным PR). `state: "unset"`
 * НЕ пишет в аудит: нет лицензии — обычное состояние существующих инсталляций до этого ТЗ
 * (Мегафон), поднимать по этому поводу тревогу каждый день было бы чистым шумом.
 */
export async function checkLicenseAndWarn(): Promise<LicenseStatus> {
  const status = await getLicenseStatus();
  if (status.state === "invalid") {
    await audit(null, "license.invalid", "instance", null, { reason: status.reason });
  } else if (status.state === "expired") {
    await audit(null, "license.expired", "instance", null, {
      daysSinceExpiry: status.daysSinceExpiry,
      seatsUsed: status.seatsUsed,
      maxSeats: status.claims.maxSeats,
    });
  } else if (status.state === "active" && status.seatsOverLimit) {
    await audit(null, "license.seats_over_limit", "instance", null, { seatsUsed: status.seatsUsed, maxSeats: status.claims.maxSeats });
  }
  return status;
}

const LICENSE_CHECK_INTERVAL_MS = 24 * 60 * 60_000;
let timer: NodeJS.Timeout | null = null;

/**
 * Раз в сутки + сразу при старте (в отличие от maintenance.ts, которое намеренно откладывает
 * первый проход — лицензия дешёвая и важно поймать просрочку сразу после деплоя, не через 5
 * минут). Без pg_try_advisory_lock, в отличие от джобов maintenance.ts: там лок защищает от
 * гонки за мутацию данных (двойной архив, двойной sweep), здесь при нескольких процессах на
 * кластер каждый просто напишет свою запись в audit_log раз в сутки — лишний шум в аудите, не
 * гонка данных, и не стоит цены отдельного лока ради этого.
 */
export function startLicenseCheck(): { stop(): void } {
  if (timer) return { stop: stopLicenseCheck };
  const tick = (): void => {
    void checkLicenseAndWarn().catch((e) => console.error("[license] проверка не удалась", e));
  };
  tick();
  timer = setInterval(tick, LICENSE_CHECK_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: stopLicenseCheck };
}

export function stopLicenseCheck(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
