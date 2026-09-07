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

export async function provisionFromLdap(principal: LdapPrincipal): Promise<UserRow> {
  const cfg = loadConfig();
  const login = principal.login;
  const globalRole = roleFromGroups(principal.groupDns);

  const existing = await one<UserRow>(`SELECT * FROM users WHERE username = $1`, [login]);

  if (existing && existing.auth_source === "local") {
    if (cfg.admin && login === cfg.admin.username) {
      // защита break-glass: не трогаем его локальный пароль
      throw new ApiHttpError(409, "CONFLICT", "Это имя занято локальным администратором — войдите локально");
    }
    // усыновление: сохраняем id / project_members / авторство, флипаем на ldap
    const row = (
      await q<UserRow>(
        `UPDATE users
            SET auth_source = 'ldap', password_hash = NULL,
                ldap_dn = $2, email = $3, name = $4, initials = $5,
                global_role = $6, is_active = true
          WHERE id = $1
        RETURNING *`,
        [existing.id, principal.dn, principal.email, principal.name, initialsOf(principal.name), globalRole],
      )
    )[0];
    invalidateUserCache(row.id);
    return row;
  }

  if (existing) {
    // уже ldap — обновляем профиль + роль на каждом логине (D3)
    const row = (
      await q<UserRow>(
        `UPDATE users
            SET ldap_dn = $2, email = $3, name = $4, initials = $5, global_role = $6, is_active = true
          WHERE id = $1
        RETURNING *`,
        [existing.id, principal.dn, principal.email, principal.name, initialsOf(principal.name), globalRole],
      )
    )[0];
    invalidateUserCache(row.id);
    return row;
  }

  // новая учётка
  const row = (
    await q<UserRow>(
      `INSERT INTO users (username, name, initials, color, job_role, global_role, is_active, auth_source, ldap_dn, email)
       VALUES ($1, $2, $3, '#0B5FD9', '', $4, true, 'ldap', $5, $6)
     RETURNING *`,
      [login, principal.name, initialsOf(principal.name), globalRole, principal.dn, principal.email],
    )
  )[0];
  return row;
}
