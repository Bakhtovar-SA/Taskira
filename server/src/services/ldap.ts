/** LDAP/AD-клиент: проверка учётки, чтение профиля и групп, диагностика.
 *  Вызывается только при AUTH_MODE=ldap (LDAP_MIGRATION.md D1/D6). */
import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";
import { Client, InvalidCredentialsError } from "ldapts";
import { loadConfig, type LdapConfig } from "../config.js";

export interface LdapPrincipal {
  /** DN пользователя в директории. */
  dn: string;
  /** Значение логин-атрибута (uid / sAMAccountName) — по нему матчим users.username. */
  login: string;
  name: string;
  email: string | null;
  /** DN всех групп пользователя (для маппинга на департаменты и admin-группу). */
  groupDns: string[];
}

/** LDAP-сервер недоступен / ошибка сервис-bind / таймаут — в отличие от честного
 *  отказа авторизации. По этой ошибке routes/auth.ts пускает break-glass вход. */
export class LdapUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "LdapUnavailableError";
  }
}

function ldapCfg(): LdapConfig {
  const c = loadConfig().ldap;
  if (!c) throw new Error("services/ldap вызван при AUTH_MODE != ldap");
  return c;
}

function tlsOptions(c: LdapConfig): ConnectionOptions {
  const o: ConnectionOptions = { rejectUnauthorized: c.tlsRejectUnauthorized };
  if (c.tlsCaFile) o.ca = readFileSync(c.tlsCaFile);
  return o;
}

function mkClient(c: LdapConfig): Client {
  // tlsOptions передаём только для ldaps:// или StartTLS — иначе ldapts пытается
  // TLS-хендшейк поверх обычного ldap:// и рвёт соединение.
  const withTls = c.url.toLowerCase().startsWith("ldaps://") || c.startTls;
  return new Client({
    url: c.url,
    timeout: c.timeoutMs,
    connectTimeout: c.timeoutMs,
    ...(withTls ? { tlsOptions: tlsOptions(c) } : {}),
  });
}

/** Первое значение атрибута строкой. */
function firstStr(v: unknown): string | null {
  if (Array.isArray(v)) return v.length ? String(v[0]) : null;
  return v == null ? null : String(v);
}

/** Экранирование значения в LDAP-фильтре (RFC 4515). */
function escFilter(s: string): string {
  return s.replace(/[\\*()\0]/g, (ch) => "\\" + ch.charCodeAt(0).toString(16).padStart(2, "0"));
}

/** Экранирование значения в компоненте DN (RFC 4514) — для прямого bind по
 *  userDnTemplate, куда {username} из тела запроса иначе попадает без проверки. */
function escDn(s: string): string {
  return s
    .replace(/([\\,+"<>;=])/g, "\\$1")
    .replace(/^#/, "\\#")
    .replace(/^ | $/g, "\\ ");
}

/**
 * Проверяет логин/пароль в LDAP и возвращает профиль + DN групп.
 *   null                  — неверный логин или пароль (или пользователь не найден);
 *   LdapPrincipal         — успех;
 *   throws LdapUnavailableError — сервер недоступен / внутренняя ошибка LDAP.
 */
export async function ldapAuthenticate(username: string, password: string): Promise<LdapPrincipal | null> {
  const c = ldapCfg();
  if (!password) return null; // пустой пароль → anonymous bind, не пускаем

  const client = mkClient(c);
  const attrs = [c.attrLogin, c.attrName, c.attrMail, "memberOf"];
  try {
    if (c.startTls) await client.startTLS(tlsOptions(c));

    /* 1) DN пользователя (+ атрибуты, если ищем сервис-аккаунтом) */
    let userDn: string;
    let entry: Record<string, unknown> | undefined;

    if (c.bindDn) {
      try {
        await client.bind(c.bindDn, c.bindPassword ?? "");
      } catch (e) {
        throw new LdapUnavailableError("bind сервис-аккаунтом не удался", e);
      }
      // replaceAll: фильтр может ссылаться на {username} несколько раз
      // (AD: (|(sAMAccountName={username})(userPrincipalName={username})), см. LDAP_SETUP.md)
      const filter = c.userFilter.replaceAll("{username}", escFilter(username));
      const { searchEntries } = await client.search(c.userBaseDn, { scope: "sub", filter, attributes: attrs });
      if (searchEntries.length !== 1) return null; // не найден или неоднозначно
      entry = searchEntries[0] as unknown as Record<string, unknown>;
      userDn = String(entry.dn);
    } else {
      userDn = c.userDnTemplate!.replaceAll("{username}", escDn(username));
    }

    /* 2) проверка пароля пользователя (re-bind) */
    try {
      await client.bind(userDn, password);
    } catch (e) {
      if (e instanceof InvalidCredentialsError) return null;
      throw new LdapUnavailableError("bind пользователя не удался", e);
    }

    /* 3) при прямом bind атрибуты ещё не читали */
    if (!entry) {
      const { searchEntries } = await client.search(userDn, {
        scope: "base",
        filter: "(objectClass=*)",
        attributes: attrs,
      });
      entry = (searchEntries[0] ?? {}) as unknown as Record<string, unknown>;
    }

    /* 4) группы */
    let groupDns: string[];
    if (c.groupMembership === "memberOf") {
      const mo = entry.memberOf;
      groupDns = Array.isArray(mo) ? mo.map(String) : mo ? [String(mo)] : [];
    } else {
      // Соединение сейчас забиндено пользователем, а директория обычному
      // пользователю часто запрещает поиск по member= (дефолтный ACL OpenLDAP
      // это делает — отдаёт noSuchObject). Группы читаем сервис-аккаунтом.
      if (c.bindDn) await client.bind(c.bindDn, c.bindPassword ?? "");
      const filter = `(&(objectClass=groupOfNames)(member=${escFilter(userDn)}))`;
      const { searchEntries } = await client.search(c.groupBaseDn!, { scope: "sub", filter, attributes: ["dn"] });
      groupDns = searchEntries.map((g) => String(g.dn));
    }

    return {
      dn: userDn,
      login: firstStr(entry[c.attrLogin]) ?? username,
      name: firstStr(entry[c.attrName]) ?? username,
      email: firstStr(entry[c.attrMail]),
      groupDns,
    };
  } catch (e) {
    if (e instanceof LdapUnavailableError) throw e;
    throw new LdapUnavailableError(`LDAP: ${(e as Error).message}`, e);
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

/** DN групп пользователя по логину — БЕЗ проверки пароля (для ресинка, D3).
 *  Требует сервис-аккаунт (LDAP_BIND_DN). null — пользователь не найден в LDAP.
 *  Бросает LdapUnavailableError при проблемах связи. */
export async function ldapUserGroups(login: string): Promise<string[] | null> {
  const c = ldapCfg();
  if (!c.bindDn) throw new LdapUnavailableError("ресинк требует LDAP_BIND_DN (сервис-аккаунт)");

  const client = mkClient(c);
  try {
    if (c.startTls) await client.startTLS(tlsOptions(c));
    await client.bind(c.bindDn, c.bindPassword ?? "");

    const filter = c.userFilter.replaceAll("{username}", escFilter(login));
    const { searchEntries } = await client.search(c.userBaseDn, {
      scope: "sub",
      filter,
      attributes: [c.attrLogin, "memberOf"],
    });
    if (searchEntries.length !== 1) return null;
    const entry = searchEntries[0] as unknown as Record<string, unknown>;
    const userDn = String(entry.dn);

    if (c.groupMembership === "memberOf") {
      const mo = entry.memberOf;
      return Array.isArray(mo) ? mo.map(String) : mo ? [String(mo)] : [];
    }
    const gfilter = `(&(objectClass=groupOfNames)(member=${escFilter(userDn)}))`;
    const groups = await client.search(c.groupBaseDn!, { scope: "sub", filter: gfilter, attributes: ["dn"] });
    return groups.searchEntries.map((g) => String(g.dn));
  } catch (e) {
    if (e instanceof LdapUnavailableError) throw e;
    throw new LdapUnavailableError(`LDAP: ${(e as Error).message}`, e);
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

/** Диагностика подключения: (сервис-)bind + base-search. Не бросает. */
export async function ldapPing(): Promise<{ ok: true; baseDn: string } | { ok: false; error: string }> {
  const c = ldapCfg();
  const client = mkClient(c);
  try {
    if (c.startTls) await client.startTLS(tlsOptions(c));
    if (c.bindDn) await client.bind(c.bindDn, c.bindPassword ?? "");
    await client.search(c.userBaseDn, { scope: "base", filter: "(objectClass=*)", attributes: ["dn"] });
    return { ok: true, baseDn: c.userBaseDn };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    await client.unbind().catch(() => undefined);
  }
}
