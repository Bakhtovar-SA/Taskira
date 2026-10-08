/** JIT-provisioning пользователя из LDAP (LDAP_MIGRATION.md D4).
 *  Совпадение с локальной строкой — по username == principal.login.
 *  Break-glass admin (config.admin.username) не усыновляется никогда. */
import { one, q, withTransaction } from "../db.js";
import { loadConfig } from "../config.js";
import { ApiHttpError } from "../errors.js";
import { invalidateUserCache, revokeUserSessions } from "../middleware.js";
import type { UserRow } from "../auth.js";
import type { LdapPrincipal } from "./ldap.js";

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "??"
  );
}

/** Есть ли пользователь в admin-группе LDAP → global_role. */
function roleFromGroups(groupDns: string[]): "admin" | "member" {
  const adminDn = loadConfig().ldap?.adminGroupDn;
  if (!adminDn) return "member";
  const want = adminDn.toLowerCase();
  return groupDns.some((g) => g.toLowerCase() === want) ? "admin" : "member";
}

/** SQL-выражение нового global_role, которое НЕ снимает статус последнего
 *  активного админа (тот же инвариант, что WHERE-гард в PATCH /users/:id).
 *  Если JIT-синк хочет понизить единственного активного админа — роль остаётся
 *  'admin', вход не падает; поправить членство в LDAP_ADMIN_GROUP_DN придётся руками.
 *  $N — желаемая роль, id строки подставляется как users.id в вызывающем UPDATE. */
const KEEP_LAST_ADMIN = (roleParam: string, idParam: string) => `
  CASE
    WHEN ${roleParam} <> 'admin'
     AND users.global_role = 'admin' AND users.is_active
     AND NOT EXISTS (
           SELECT 1 FROM users a
            WHERE a.global_role = 'admin' AND a.is_active AND a.id <> ${idParam}
         )
    THEN 'admin'
    ELSE ${roleParam}
  END`;

async function updateLdapUser(sql: string, params: unknown[]) {
  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('taskira:active-admins'))`);
    const previous = (await client.query<Pick<UserRow, "global_role">>(
      `SELECT global_role FROM users WHERE id = $1 FOR UPDATE`, [params[0]],
    )).rows[0];
    if (!previous) throw new ApiHttpError(409, "CONFLICT", "Пользователь удалён во время синхронизации");
    const row = (await client.query<UserRow>(sql, params)).rows[0];
    return { previous, row };
  });
}

function refreshSession(previous: Pick<UserRow, "global_role">, row: UserRow): void {
  if (previous.global_role !== row.global_role) revokeUserSessions(row.id, "LDAP role changed");
  else invalidateUserCache(row.id);
}

export async function provisionFromLdap(principal: LdapPrincipal, _retry = false): Promise<UserRow> {
  const cfg = loadConfig();
  const login = principal.login;
  const globalRole = roleFromGroups(principal.groupDns);
  // job_role/phone — AD title/telephoneNumber. Синкаются на КАЖДОМ логине, как
  // и name/email ниже — это сознательно отменяет для job_role решение
  // LDAP_MIGRATION.md D4 "job_role переживает LDAP-adopt без изменений"
  // (026_ad_profile_attrs.sql): AD теперь единственный источник должности для
  // LDAP-пользователей. Локальных пользователей эта функция не трогает.
  const params = [
    principal.dn,
    principal.email,
    principal.name,
    initialsOf(principal.name),
    globalRole,
    principal.title ?? "",
    principal.phone ?? "",
    principal.givenName?.trim() || null,
  ] as const;

  const existing = await one<UserRow>(`SELECT * FROM users WHERE username = $1`, [login]);

  if (existing?.auth_source === "service")
    throw new ApiHttpError(409,"CONFLICT","Сервисная учётная запись не может входить через LDAP");

  if (existing && existing.auth_source === "local") {
    if (cfg.admin && login === cfg.admin.username) {
      // защита break-glass: не трогаем его локальный пароль
      throw new ApiHttpError(409, "CONFLICT", "Это имя занято локальным администратором — войдите локально");
    }
    // усыновление: сохраняем id / project_members / авторство, флипаем на ldap.
    // is_active НЕ форсим — деактивация админом остаётся в силе (D4/Фаза 4).
    const { previous, row } = await updateLdapUser(
        `UPDATE users
            SET auth_source = 'ldap', password_hash = NULL,
                must_change_password = false, password_expires_at = NULL,
                ldap_dn = $2, email = $3, name = $4, initials = $5,
                job_role = $7, phone = $8, given_name = $9,
                global_role = ${KEEP_LAST_ADMIN("$6", "$1")},
                session_version = session_version + CASE WHEN global_role IS DISTINCT FROM (${KEEP_LAST_ADMIN("$6", "$1")}) THEN 1 ELSE 0 END
          WHERE id = $1
        RETURNING *`,
        [existing.id, ...params],
      );
    refreshSession(previous, row);
    return row;
  }

  if (existing) {
    // уже ldap — обновляем профиль + роль на каждом логине (D3); is_active не трогаем
    const { previous, row } = await updateLdapUser(
        `UPDATE users
            SET ldap_dn = $2, email = $3, name = $4, initials = $5,
                job_role = $7, phone = $8, given_name = $9,
                global_role = ${KEEP_LAST_ADMIN("$6", "$1")},
                session_version = session_version + CASE WHEN global_role IS DISTINCT FROM (${KEEP_LAST_ADMIN("$6", "$1")}) THEN 1 ELSE 0 END
          WHERE id = $1
        RETURNING *`,
        [existing.id, ...params],
      );
    refreshSession(previous, row);
    return row;
  }

  // новая учётка. Гонка двух первых логинов одного username → 23505 на UNIQUE:
  // один раз перечитываем и уходим в ветку adopt/update выше.
  try {
    return (
      await q<UserRow>(
        `INSERT INTO users (username, name, initials, color, job_role, phone, global_role, is_active, auth_source, ldap_dn, email, given_name)
         VALUES ($1, $4, $5, '#0B5FD9', $7, $8, $6, true, 'ldap', $2, $3, $9)
       RETURNING *`,
        [login, ...params],
      )
    )[0];
  } catch (e) {
    if (!_retry && (e as { code?: string }).code === "23505") return provisionFromLdap(principal, true);
    throw e;
  }
}
