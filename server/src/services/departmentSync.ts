/** Синхронизация членства пользователя в департаментах из его LDAP-групп
 *  (LDAP_MIGRATION.md D3/D5). Маппинг — по departments.ldap_group_dn.
 *  source='ldap' пересобирается целиком; source='manual' не трогаем. */
import { q } from "../db.js";
import { audit } from "../audit.js";
import { invalidateDeptMembership } from "../middleware.js";
import { ldapUserGroups } from "./ldap.js";

/** actorId по умолчанию — сам пользователь (JIT-синк при его собственном
 *  логине, routes/auth.ts). Явно передаётся из resyncAllLdapUsers(), чтобы
 *  строки audit_log от ФОНОВОГО или ручного admin-ресинка не выглядели так,
 *  будто их вызвал логин затронутого пользователя — до этого фикса так и
 *  было, и лог вводил в заблуждение (проверка «кто вызвал 3am-синк» указывала
 *  на самого пользователя, хотя тот не логинился). */
export async function syncDepartmentMembership(
  userId: string,
  groupDns: string[],
  actorId: string | null = userId,
): Promise<void> {
  const lower = groupDns.map((g) => g.toLowerCase());

  // все департаменты с маппингом — чтобы сбросить кэш и по добавленным, и по убранным
  const mapped = await q<{ id: string }>(`SELECT id FROM departments WHERE ldap_group_dn IS NOT NULL`);
  const wanted = await q<{ id: string }>(
    `SELECT id FROM departments
      WHERE ldap_group_dn IS NOT NULL AND lower(ldap_group_dn) = ANY($1::text[])`,
    [lower],
  );
  const wantedIds = wanted.map((d) => d.id);

  // убрать ldap-членства, которых больше нет в группах
  await q(
    `DELETE FROM department_members
      WHERE user_id = $1 AND source = 'ldap' AND NOT (department_id = ANY($2::uuid[]))`,
    [userId, wantedIds],
  );

  // добавить недостающие; на конфликте с manual-строкой — ничего не делаем
  for (const depId of wantedIds) {
    await q(
      `INSERT INTO department_members (department_id, user_id, source, synced_at)
       VALUES ($1, $2, 'ldap', now())
       ON CONFLICT (department_id, user_id)
         DO UPDATE SET synced_at = now() WHERE department_members.source = 'ldap'`,
      [depId, userId],
    );
  }

  for (const d of mapped) invalidateDeptMembership(userId, d.id);

  await audit(actorId, "ldap.dept.sync", "user", userId, {
    groups: groupDns.length,
    departments: wantedIds.length,
  });
}

export interface LdapResyncResult {
  total: number;
  synced: number;
  notFound: string[];
  errors: string[];
}

/** Пересобрать department_members для ВСЕХ ldap-пользователей из их текущих
 *  групп. Общая реализация для ручного POST /api/ldap/resync (routes/ldap.ts,
 *  actorId — вызвавший admin) и фонового джоба (services/maintenance.ts
 *  startJob("ldap-resync", ...), actorId — null, «система»). Требует
 *  сервис-аккаунт (LDAP_BIND_DN) — вызывающий
 *  сам проверяет это до вызова, чтобы отличать «не настроено» от «пусто прошло». */
/** Сколько пользователей ресинкать параллельно. LDAP-справочники обычно
 *  терпимее к нескольким одновременным поисковым bind'ам, чем к сотням
 *  последовательных round-trip'ов один за другим (особенно теперь, когда
 *  этот проход не только по клику admin'а, а ещё и по расписанию — maintenance.ts). */
const RESYNC_CONCURRENCY = 8;

export async function resyncAllLdapUsers(actorId: string | null): Promise<LdapResyncResult> {
  const users = await q<{ id: string; username: string }>(
    `SELECT id, username FROM users WHERE auth_source = 'ldap' ORDER BY username`,
  );
  let synced = 0;
  const notFound: string[] = [];
  const errors: string[] = [];

  const resyncOne = async (u: { id: string; username: string }): Promise<void> => {
    try {
      const groups = await ldapUserGroups(u.username);
      if (groups === null) {
        notFound.push(u.username);
        return;
      }
      await syncDepartmentMembership(u.id, groups, actorId);
      synced += 1;
    } catch (e) {
      errors.push(`${u.username}: ${(e as Error).message}`);
    }
  };

  for (let i = 0; i < users.length; i += RESYNC_CONCURRENCY) {
    await Promise.all(users.slice(i, i + RESYNC_CONCURRENCY).map(resyncOne));
  }

  await audit(actorId, "ldap.resync", "ldap", null, {
    total: users.length,
    synced,
    notFound: notFound.length,
    errors: errors.length,
  });
  return { total: users.length, synced, notFound, errors };
}
