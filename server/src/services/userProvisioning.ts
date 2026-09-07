/** JIT-provisioning пользователя из LDAP (LDAP_MIGRATION.md D4).
 *  Совпадение с локальной строкой — по username == principal.login.
 *  Break-glass admin (config.admin.username) не усыновляется никогда. */
import { one, q } from "../db.js";
import { loadConfig } from "../config.js";
import { ApiHttpError } from "../errors.js";
import { invalidateUserCache } from "../middleware.js";
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

export async function provisionFromLdap(principal: LdapPrincipal, _retry = false): Promise<UserRow> {
  const cfg = loadConfig();
  const login = principal.login;
  const globalRole = roleFromGroups(principal.groupDns);
  const params = [principal.dn, principal.email, principal.name, initialsOf(principal.name), globalRole] as const;

  const existing = await one<UserRow>(`SELECT * FROM users WHERE username = $1`, [login]);

  if (existing && existing.auth_source === "local") {
    if (cfg.admin && login === cfg.admin.username) {
      // защита break-glass: не трогаем его локальный пароль
      throw new ApiHttpError(409, "CONFLICT", "Это имя занято локальным администратором — войдите локально");
    }
    // усыновление: сохраняем id / project_members / авторство, флипаем на ldap.
    // is_active НЕ форсим — деактивация админом остаётся в силе (D4/Фаза 4).
    const row = (
      await q<UserRow>(
        `UPDATE users
            SET auth_source = 'ldap', password_hash = NULL,
                ldap_dn = $2, email = $3, name = $4, initials = $5,
                global_role = ${KEEP_LAST_ADMIN("$6", "$1")}
          WHERE id = $1
        RETURNING *`,
        [existing.id, ...params],
      )
    )[0];
    invalidateUserCache(row.id);
    return row;
  }

  if (existing) {
    // уже ldap — обновляем профиль + роль на каждом логине (D3); is_active не трогаем
    const row = (
      await q<UserRow>(
        `UPDATE users
            SET ldap_dn = $2, email = $3, name = $4, initials = $5,
                global_role = ${KEEP_LAST_ADMIN("$6", "$1")}
          WHERE id = $1
        RETURNING *`,
        [existing.id, ...params],
      )
    )[0];
    invalidateUserCache(row.id);
    return row;
  }

  // новая учётка. Гонка двух первых логинов одного username → 23505 на UNIQUE:
  // один раз перечитываем и уходим в ветку adopt/update выше.
  try {
    return (
      await q<UserRow>(
        `INSERT INTO users (username, name, initials, color, job_role, global_role, is_active, auth_source, ldap_dn, email)
         VALUES ($1, $4, $5, '#0B5FD9', '', $6, true, 'ldap', $2, $3)
       RETURNING *`,
        [login, ...params],
      )
    )[0];
  } catch (e) {
    if (!_retry && (e as { code?: string }).code === "23505") return provisionFromLdap(principal, true);
    throw e;
  }
}
