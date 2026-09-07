/** Конфигурация — только из env. Секретов в коде нет и не будет.
 *  При старте подгружаем server/.env в process.env (Node сам файл .env не читает).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  startTls: boolean;
  tlsCaFile: string | null;
  tlsRejectUnauthorized: boolean;
  timeoutMs: number;
}

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpires: string;
  corsOrigin: string[] | "*";
  admin: { username: string; password: string; name: string } | null;
  /** local — только пароль (как раньше); ldap — LDAP + break-glass локальный admin. */
  authMode: "local" | "ldap";
  ldap: LdapConfig | null;
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
    startTls: envBool(process.env.LDAP_STARTTLS, false),
    tlsCaFile: process.env.LDAP_TLS_CA_FILE?.trim() || null,
    tlsRejectUnauthorized: envBool(process.env.LDAP_TLS_REJECT_UNAUTHORIZED, true),
    timeoutMs: Number(process.env.LDAP_TIMEOUT_MS ?? 5000),
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

  const corsRaw = (process.env.CORS_ORIGIN ?? "http://localhost:5173").trim();

  const adminUser = process.env.ADMIN_USERNAME?.trim();
  const adminPass = process.env.ADMIN_PASSWORD;

  const authMode = (process.env.AUTH_MODE ?? "local").trim();
  if (authMode !== "local" && authMode !== "ldap") fail("AUTH_MODE должен быть 'local' или 'ldap'");

  return {
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? "0.0.0.0",
    databaseUrl,
    jwtSecret,
    jwtExpires: process.env.JWT_EXPIRES ?? "12h",
    corsOrigin: corsRaw === "*" ? "*" : corsRaw.split(",").map((s) => s.trim()).filter(Boolean),
    admin:
      adminUser && adminPass
        ? {
            username: adminUser,
            password: adminPass,
            name: process.env.ADMIN_NAME?.trim() || "Администратор",
          }
        : null,
    authMode,
    ldap: authMode === "ldap" ? buildLdapConfig() : null,
  };
}
