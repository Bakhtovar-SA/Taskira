/** Конфигурация — только из env. Секретов в коде нет и не будет.
 *  При старте подгружаем server/.env в process.env (Node сам файл .env не читает).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { passwordPolicyError } from "./passwordPolicy.js";

/** Настройки LDAP/AD — заполнены только при authMode === "ldap".
 *  Подробности и примеры для реального AD — LDAP_SETUP.md (Фаза 6). */
export interface LdapConfig {
  url: string;
  /** Сервис-аккаунт для поиска. null ⇒ режим прямого bind по userDnTemplate. */
  bindDn: string | null;
  bindPassword: string | null;
  userBaseDn: string;
  /** Фильтр поиска пользователя; обязан содержать плейсхолдер {username}. */
  userFilter: string;
  /** Шаблон DN для прямого bind (когда bindDn не задан), напр. uid={username},ou=people,dc=… */
  userDnTemplate: string | null;
  /** Как получать группы: memberOf (операционный атрибут AD) | search (обратный поиск). */
  groupMembership: "memberOf" | "search";
  /** База поиска групп — обязательна при groupMembership === "search". */
  groupBaseDn: string | null;
  /** Членство в этой группе ⇒ global_role='admin'. */
  adminGroupDn: string | null;
  attrLogin: string;
  attrName: string;
  attrMail: string;
  /** Должность (AD: title) — синкается в users.job_role при каждом LDAP-логине. */
  attrTitle: string;
  /** Телефон (AD: telephoneNumber) — синкается в users.phone при каждом LDAP-логине. */
  attrPhone: string;
  startTls: boolean;
  tlsCaFile: string | null;
  tlsRejectUnauthorized: boolean;
  timeoutMs: number;
  /** Фоновый ресинк членства в департаментах из LDAP-групп (LDAP_MIGRATION.md D3).
   *  Требует bindDn (сервис-аккаунт) — как и ручной POST /api/ldap/resync;
   *  без него джоб молча не стартует (нечем искать группы без bind пользователя). */
  resyncEnabled: boolean;
  resyncIntervalMs: number;
}

/** Параметры S3-совместимого хранилища — заполнены только при driver === "s3".
 *  Подробности и примеры (MinIO / «большой» S3) — STORAGE_SETUP.md (Фаза 4). */
export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  /** true для MinIO (path-style вместо virtual-hosted). */
  forcePathStyle: boolean;
}

/** Хранилище вложений к задачам (FILES_MIGRATION.md D1/D3). */
export interface StorageConfig {
  driver: "local" | "s3";
  /** driver=local: абсолютный каталог для объектов (вне репозитория, git-ignored).
   *  Для s3 не используется, но всегда вычислен (дефолт). */
  dir: string;
  /** driver=s3: параметры S3; null при local. */
  s3: S3Config | null;
  /** Максимальный размер одного файла, байт (D3). */
  maxBytes: number;
  /** Потолок числа вложений на задачу (D3). */
  maxPerIssue: number;
  /** Максимальная длина имени файла после санитизации (D3). */
  maxFilename: number;
  /** Заблокированные расширения — нижний регистр, без ведущей точки (D3). */
  blockExt: string[];
  /** Максимальный размер аватарки пользователя, байт — отдельный, гораздо
   *  меньший потолок, чем у обычных вложений; тот же Storage-драйвер. */
  avatarMaxBytes: number;
}

/** Параметры SMTP — заполнены только при notify.emailEnabled.
 *  Примеры для реального корп. релея — NOTIFICATIONS_SETUP.md (Фаза 5). */
export interface SmtpConfig {
  host: string;
  port: number;
  /** null — анонимный релей в контуре. */
  user: string | null;
  pass: string | null;
  /** true — implicit TLS (порт 465); false — plain / STARTTLS. */
  secure: boolean;
  /** From: заголовок, напр. "Taskira <noreply@corp.example>". */
  from: string;
  /** false — не проверять сертификат TLS-сессии (самоподписанный сертификат
   *  на внутрикорпоративном relay — типичный случай в закрытом контуре, где
   *  доверенного CA нет и не будет). По умолчанию true — так безопаснее,
   *  выключать сознательно через SMTP_TLS_REJECT_UNAUTHORIZED=false. */
  tlsRejectUnauthorized: boolean;
}

/** Уведомления (NOTIFICATIONS_MIGRATION.md). In-app работает всегда, независимо
 *  от этих настроек; они управляют только email-каналом и фоновым воркером. */
export interface NotifyConfig {
  /** true — воркер шлёт email; false — только in-app (SMTP не трогается). */
  emailEnabled: boolean;
  /** true (деф.) — стартовать фоновый луп в ЭТОМ процессе (D4; под будущее
   *  вынесение в отдельный `npm run worker` + лидер-лок). */
  workerEnabled: boolean;
  workerIntervalMs: number;
  emailMaxTries: number;
  /** Окно группировки в дайджест (notify_prefs.email='daily'), мс. */
  digestWindowMs: number;
  /** База для ссылок в письмах, напр. "https://taskira.corp". Обязателен при
   *  emailEnabled — письмо без ссылки бессмысленно (D7/D9). */
  appBaseUrl: string | null;
  smtp: SmtpConfig | null;
}

/** Фоновое обслуживание: автоархив закрытых задач и уборка audit_log
 *  (аудит LIFE-03 / PERF-05). Работает независимо от email-воркера. */
export interface MaintenanceConfig {
  /** true (деф.) — стартовать луп обслуживания в ЭТОМ процессе. При нескольких
   *  инстансах включать ровно на одном, как и notify.workerEnabled. */
  enabled: boolean;
  intervalMs: number;
  /** Задержка первого прохода после старта процесса (MAINTENANCE_START_DELAY_MS, по умолчанию 5 мин): рестарт
   *  или деплой в час пик не должен сразу запускать архивацию. Джобы sweep/LDAP идут после неё со своим сдвигом. */
  startDelayMs: number;
  /** Размер одной пачки архивации/уборки аудита: каждая пачка — отдельный оператор без долгой транзакции,
   *  так что блокировка строк держится только на время пачки. */
  batchSize: number;
  /** Пауза между пачками, мс — чтобы не занимать БД непрерывно. */
  batchPauseMs: number;
  /** Потолок строк каждого вида работы за один проход; остаток дообрабатывается следующими проходами. */
  maxPerRun: number;
  /** Закрытая задача уходит в архив через столько дней после done_at. */
  archiveAfterDays: number;
  /** Строки audit_log старше стольких дней удаляются. 0 — не удалять никогда. */
  auditRetentionDays: number;
  /** Сборщик осиротевших объектов Storage (ARCHITECTURE.md follow-up). Реже,
   *  чем сам тик обслуживания — полный листинг S3-бакета/каталога дороже
   *  архивного UPDATE, гонять его каждый час незачем. */
  storageSweepEnabled: boolean;
  storageSweepIntervalMs: number;
  /** Объект моложе этого возраста сборщик не трогает — защита от гонки с
   *  загрузкой (storage.put() пишет объект раньше INSERT INTO attachments). */
  storageSweepGraceMs: number;
}

export interface Config {
  version: string;
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  sessionTtlSeconds: number;
  sessionRotateAfterSeconds: number;
  sessionCookieSecure: boolean;
  /** Значение опции Fastify `trustProxy`. За reverse-proxy (nginx) без него
   *  `req.ip` = адрес прокси — ломает rate-limit логина по IP и IP в audit-логе. */
  trustProxy: boolean | string;
  corsOrigin: string[] | "*";
  admin: { username: string; password: string; name: string } | null;
  /** local — только пароль (как раньше); ldap — LDAP + break-glass локальный admin. */
  authMode: "local" | "ldap";
  ldap: LdapConfig | null;
  storage: StorageConfig;
  notify: NotifyConfig;
  maintenance: MaintenanceConfig;
  /** Размер пула соединений к Postgres (аудит PERF-07: было зашито в код). */
  pgPoolMax: number;
  /** Через сколько мс закрывать простаивающее соединение; 0 — не закрывать (умолчание). */
  pgPoolIdleTimeoutMs: number;
  /** Время жизни кэша списка исполнителей фильтра доски, мс (на процесс); 0 — выключить. */
  assigneesCacheTtlMs: number;
  /** Глобальный лимит запросов на пользователя/IP (аудит SEC-03). */
  rateLimit: {
    enabled: boolean;
    max: number;
    windowMs: number;
    loginMax: number;
    loginWindowMs: number;
    accountMaxFailures: number;
    accountLockSeconds: number;
  };
}

function fail(msg: string): never {
  console.error(`[config] ${msg}`);
  process.exit(1);
}

/** "1"/"true"/"yes"/"on" → true; "0"/"false"/"no"/"off"/пусто → false; иначе — дефолт. */
function envBool(raw: string | undefined, def: boolean): boolean {
  const v = raw?.trim().toLowerCase();
  if (v === undefined || v === "") return def;
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return def;
}

/** TRUST_PROXY → значение опции Fastify `trustProxy`:
 *   пусто / false / off  → false  (прямой доступ, X-Forwarded-* игнорируются);
 *   true / yes / on / 1   → true   (единственный доверенный прокси в приватной сети);
 *   иначе                 → строка «как есть»: один IP, CIDR или список через запятую
 *                           (напр. `127.0.0.1,10.0.0.0/8`) — доверять только этим адресам.
 *  Число хопов Fastify принимает лишь как `number`, а тип опции его не допускает,
 *  поэтому здесь не поддерживаем — используйте CIDR. */
export function parseTrustProxy(raw: string | undefined): boolean | string {
  const v = raw?.trim();
  if (!v) return false;
  const low = v.toLowerCase();
  if (["1", "true", "yes", "on"].includes(low)) return true;
  if (["0", "false", "no", "off"].includes(low)) return false;
  return v;
}

/** Собирает LdapConfig из env; fail-fast на каждом отсутствующем обязательном ключе.
 *  Вызывается только при AUTH_MODE=ldap. */
function buildLdapConfig(): LdapConfig {
  const req = (k: string): string => {
    const v = process.env[k]?.trim();
    if (!v) fail(`AUTH_MODE=ldap: не задан ${k} (см. LDAP_SETUP.md)`);
    return v;
  };

  const userFilter = req("LDAP_USER_FILTER");
  if (!userFilter.includes("{username}")) fail("LDAP_USER_FILTER должен содержать плейсхолдер {username}");

  const bindDn = process.env.LDAP_BIND_DN?.trim() || null;
  const userDnTemplate = process.env.LDAP_USER_DN_TEMPLATE?.trim() || null;
  if (!bindDn && !userDnTemplate)
    fail("AUTH_MODE=ldap: задайте LDAP_BIND_DN (+ LDAP_BIND_PASSWORD) либо LDAP_USER_DN_TEMPLATE для прямого bind");
  if (bindDn && !process.env.LDAP_BIND_PASSWORD)
    fail("AUTH_MODE=ldap: LDAP_BIND_DN задан без LDAP_BIND_PASSWORD");
  if (userDnTemplate && !userDnTemplate.includes("{username}"))
    fail("LDAP_USER_DN_TEMPLATE должен содержать плейсхолдер {username}");

  const gm = (process.env.LDAP_GROUP_MEMBERSHIP ?? "memberOf").trim();
  if (gm !== "memberOf" && gm !== "search") fail("LDAP_GROUP_MEMBERSHIP: 'memberOf' или 'search'");
  const groupBaseDn = process.env.LDAP_GROUP_BASE_DN?.trim() || null;
  if (gm === "search" && !groupBaseDn) fail("LDAP_GROUP_MEMBERSHIP=search требует LDAP_GROUP_BASE_DN");

  const timeoutMs = Number(process.env.LDAP_TIMEOUT_MS ?? 5000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail("LDAP_TIMEOUT_MS должен быть положительным числом");

  return {
    url: req("LDAP_URL"),
    bindDn,
    bindPassword: process.env.LDAP_BIND_PASSWORD ?? null,
    userBaseDn: req("LDAP_USER_BASE_DN"),
    userFilter,
    userDnTemplate,
    groupMembership: gm,
    groupBaseDn,
    adminGroupDn: process.env.LDAP_ADMIN_GROUP_DN?.trim() || null,
    attrLogin: process.env.LDAP_ATTR_LOGIN?.trim() || "sAMAccountName",
    attrName: process.env.LDAP_ATTR_NAME?.trim() || "displayName",
    attrMail: process.env.LDAP_ATTR_MAIL?.trim() || "mail",
    attrTitle: process.env.LDAP_ATTR_TITLE?.trim() || "title",
    attrPhone: process.env.LDAP_ATTR_PHONE?.trim() || "telephoneNumber",
    startTls: envBool(process.env.LDAP_STARTTLS, false),
    tlsCaFile: process.env.LDAP_TLS_CA_FILE?.trim() || null,
    tlsRejectUnauthorized: envBool(process.env.LDAP_TLS_REJECT_UNAUTHORIZED, true),
    timeoutMs,
    resyncEnabled: envBool(process.env.LDAP_RESYNC_ENABLED, true),
    resyncIntervalMs: envPosInt("LDAP_RESYNC_INTERVAL_MS", 6 * 60 * 60_000), // раз в 6 часов
  };
}

/** Положительное целое из env, иначе дефолт; мусор (не число) — fail-fast. */
function envNonNegInt(key: string, def: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) fail(`${key} должен быть неотрицательным целым числом`);
  return n;
}

function envPosInt(key: string, def: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) fail(`${key} должен быть положительным целым числом`);
  return n;
}

/** Расширения по умолчанию под запрет — исполняемое и скриптовое (FILES_MIGRATION.md D3).
 *  Проверка идёт и по расширению, и по magic-байтам (services/fileGuard, Фаза 2). */
const DEFAULT_BLOCK_EXT =
  "exe dll scr com pif bat cmd ps1 psm1 vbs vbe js jse wsf wsh hta msi msp cpl reg lnk " +
  "sh bash zsh ksh run bin jar apk app dmg pkg deb rpm elf so dylib gadget inf";

/** Корень пакета server/ (config.ts лежит в server/src/). */
const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Собирает StorageConfig из env. Для driver=s3 — fail-fast на обязательных
 *  ключах (как buildLdapConfig). Для driver=local каталог не проверяется здесь
 *  (его создаёт/валидирует makeStorage в Фазе 2) — иначе тесты без STORAGE_DIR
 *  падали бы на старте. */
function buildStorageConfig(): StorageConfig {
  const driver = (process.env.STORAGE_DRIVER ?? "local").trim();
  if (driver !== "local" && driver !== "s3") fail("STORAGE_DRIVER должен быть 'local' или 's3'");

  const dir = process.env.STORAGE_DIR?.trim() || join(SERVER_ROOT, "var", "attachments");

  let s3: S3Config | null = null;
  if (driver === "s3") {
    const req = (k: string): string => {
      const v = process.env[k]?.trim();
      if (!v) fail(`STORAGE_DRIVER=s3: не задан ${k} (см. STORAGE_SETUP.md)`);
      return v;
    };
    s3 = {
      endpoint: req("STORAGE_S3_ENDPOINT"),
      bucket: req("STORAGE_S3_BUCKET"),
      region: process.env.STORAGE_S3_REGION?.trim() || "us-east-1",
      accessKey: req("STORAGE_S3_ACCESS_KEY"),
      secretKey: req("STORAGE_S3_SECRET_KEY"),
      forcePathStyle: envBool(process.env.STORAGE_S3_FORCE_PATH_STYLE, true),
    };
  }

  const blockExt = (process.env.ATTACH_BLOCK_EXT?.trim() || DEFAULT_BLOCK_EXT)
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);

  return {
    driver,
    dir,
    s3,
    maxBytes: envPosInt("ATTACH_MAX_BYTES", 25 * 1024 * 1024),
    maxPerIssue: envPosInt("ATTACH_MAX_PER_ISSUE", 50),
    maxFilename: envPosInt("ATTACH_MAX_FILENAME", 200),
    blockExt,
    avatarMaxBytes: envPosInt("AVATAR_MAX_BYTES", 3 * 1024 * 1024),
  };
}

/** Собирает NotifyConfig из env. При NOTIFY_EMAIL_ENABLED=true — fail-fast на
 *  обязательных SMTP-ключах и APP_BASE_URL (D7: письмо без ссылки не имеет смысла). */
function buildNotifyConfig(): NotifyConfig {
  const emailEnabled = envBool(process.env.NOTIFY_EMAIL_ENABLED, false);
  const appBaseUrl = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "") || null;

  let smtp: SmtpConfig | null = null;
  if (emailEnabled) {
    const req = (k: string): string => {
      const v = process.env[k]?.trim();
      if (!v) fail(`NOTIFY_EMAIL_ENABLED=true: не задан ${k} (см. NOTIFICATIONS_SETUP.md)`);
      return v;
    };
    if (!appBaseUrl) fail("NOTIFY_EMAIL_ENABLED=true: не задан APP_BASE_URL — ссылка в письме обязательна");
    const port = Number(req("SMTP_PORT"));
    if (!Number.isInteger(port) || port <= 0) fail("SMTP_PORT должен быть положительным целым");
    smtp = {
      host: req("SMTP_HOST"),
      port,
      user: process.env.SMTP_USER?.trim() || null,
      pass: process.env.SMTP_PASS ?? null,
      secure: envBool(process.env.SMTP_SECURE, false),
      from: req("SMTP_FROM"),
      tlsRejectUnauthorized: envBool(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true),
    };
  }

  return {
    emailEnabled,
    workerEnabled: envBool(process.env.NOTIFY_WORKER_ENABLED, true),
    workerIntervalMs: envPosInt("NOTIFY_WORKER_INTERVAL_MS", 15_000),
    emailMaxTries: envPosInt("NOTIFY_EMAIL_MAX_TRIES", 4),
    digestWindowMs: envPosInt("NOTIFY_DIGEST_WINDOW_MS", 60 * 60_000),
    appBaseUrl,
    smtp,
  };
}

/** Простой парсер KEY=VALUE (без внешних зависимостей). Не перезаписывает уже заданные env. */
function loadDotEnv(): void {
  const candidates = [
    join(process.cwd(), ".env"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env"), // server/src → server/.env
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
    console.log(`[config] загружен ${path}`);
    return;
  }
  console.warn("[config] файл .env не найден — используются только системные переменные окружения");
}

let cached: Config | null = null;

/** Загружает конфиг ЕДИНОЖДЫ при старте процесса (index.ts) и кэширует. */
export function initConfig(): Config {
  loadDotEnv();
  cached = buildConfig();
  return cached;
}

/** Возвращает кэшированный конфиг; при отсутствии кэша (тесты, seed) — собирает. */
export function loadConfig(): Config {
  if (!cached) {
    loadDotEnv();
    cached = buildConfig();
  }
  return cached;
}

function buildConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("Не задан DATABASE_URL (например postgresql://user:pass@db:5432/taskira)");

  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (jwtSecret.length < 32) fail("JWT_SECRET должен быть не короче 32 символов — см. .env.example");

  const corsRaw = (process.env.CORS_ORIGIN ?? "http://localhost:3000").trim();

  const adminUser = process.env.ADMIN_USERNAME?.trim();
  const adminPass = process.env.ADMIN_PASSWORD;

  const authMode = (process.env.AUTH_MODE ?? "local").trim();
  if (authMode !== "local" && authMode !== "ldap") fail("AUTH_MODE должен быть 'local' или 'ldap'");

  if (!adminUser || !adminPass)
    fail("ADMIN_USERNAME и ADMIN_PASSWORD обязательны для первого администратора / break-glass входа");
  const adminPasswordError = passwordPolicyError(adminPass, adminUser);
  if (adminPasswordError) fail(`ADMIN_PASSWORD: ${adminPasswordError}`);

  const sessionTtlSeconds = envPosInt("SESSION_TTL_SECONDS", 8 * 60 * 60);
  const sessionRotateAfterSeconds = envPosInt("SESSION_ROTATE_AFTER_SECONDS", 60 * 60);
  if (sessionRotateAfterSeconds >= sessionTtlSeconds)
    fail("SESSION_ROTATE_AFTER_SECONDS должен быть меньше SESSION_TTL_SECONDS");

  return {
    version: process.env.TASKIRA_VERSION?.trim() || "dev",
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? "0.0.0.0",
    databaseUrl,
    jwtSecret,
    sessionTtlSeconds,
    sessionRotateAfterSeconds,
    sessionCookieSecure: envBool(process.env.SESSION_COOKIE_SECURE, process.env.NODE_ENV === "production"),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    corsOrigin: corsRaw === "*" ? "*" : corsRaw.split(",").map((s) => s.trim()).filter(Boolean),
    admin: {
      username: adminUser,
      password: adminPass,
      name: process.env.ADMIN_NAME?.trim() || "Администратор",
    },
    authMode,
    ldap: authMode === "ldap" ? buildLdapConfig() : null,
    storage: buildStorageConfig(),
    notify: buildNotifyConfig(),
    maintenance: {
      enabled: envBool(process.env.MAINTENANCE_ENABLED, true),
      intervalMs: envPosInt("MAINTENANCE_INTERVAL_MS", 60 * 60_000), // раз в час
      startDelayMs: envNonNegInt("MAINTENANCE_START_DELAY_MS", 5 * 60_000), // не сразу при старте
      batchSize: envPosInt("MAINTENANCE_BATCH_SIZE", 1000),
      batchPauseMs: envNonNegInt("MAINTENANCE_BATCH_PAUSE_MS", 50),
      maxPerRun: envPosInt("MAINTENANCE_MAX_PER_RUN", 50_000),
      archiveAfterDays: envPosInt("ARCHIVE_AFTER_DAYS", 30),
      auditRetentionDays: Number(process.env.AUDIT_RETENTION_DAYS ?? 365),
      storageSweepEnabled: envBool(process.env.STORAGE_SWEEP_ENABLED, true),
      storageSweepIntervalMs: envPosInt("STORAGE_SWEEP_INTERVAL_MS", 24 * 60 * 60_000), // раз в сутки
      storageSweepGraceMs: envPosInt("STORAGE_SWEEP_GRACE_MS", 24 * 60 * 60_000), // 24 часа
    },
    pgPoolMax: envPosInt("PG_POOL_MAX", 10),
    pgPoolIdleTimeoutMs: envNonNegInt("PG_POOL_IDLE_TIMEOUT_MS", 0),
    assigneesCacheTtlMs: envNonNegInt("ASSIGNEES_CACHE_TTL_MS", 45_000),
    rateLimit: {
      // Выключать только осознанно (тесты выставляют явно) — прод-код больше не
      // смотрит на NODE_ENV сам (аудит DEBT-03).
      enabled: envBool(process.env.RATE_LIMIT_ENABLED, true),
      max: envPosInt("RATE_LIMIT_MAX", 600),
      windowMs: envPosInt("RATE_LIMIT_WINDOW_MS", 60_000),
      loginMax: envPosInt("RATE_LIMIT_LOGIN_MAX", 10),
      loginWindowMs: envPosInt("RATE_LIMIT_LOGIN_WINDOW_MS", 5 * 60_000),
      accountMaxFailures: envPosInt("ACCOUNT_LOCK_MAX_FAILURES", 5),
      accountLockSeconds: envPosInt("ACCOUNT_LOCK_SECONDS", 15 * 60),
    },
  };
}
