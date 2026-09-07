/** Синхронизация членства пользователя в департаментах из его LDAP-групп
 *  (LDAP_MIGRATION.md D3/D5). Маппинг — по departments.ldap_group_dn.
 *  source='ldap' пересобирается целиком; source='manual' не трогаем. */
import { q } from "../db.js";
import { audit } from "../audit.js";

export async function syncDepartmentMembership(userId: string, groupDns: string[]): Promise<void> {
  const lower = groupDns.map((g) => g.toLowerCase());

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

  await audit(userId, "ldap.dept.sync", "user", userId, {
    groups: groupDns.length,
    departments: wantedIds.length,
  });
}
