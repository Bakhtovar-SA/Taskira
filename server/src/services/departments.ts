/** Департаменты: список и одна запись. CRUD — в routes/departments.ts. */
import { q, one } from "../db.js";
import type { DepartmentDto, DepartmentMemberDto } from "../contract.js";
export type { DepartmentDto, DepartmentMemberDto };

interface DepartmentDbRow {
  id: string;
  name: string;
  ldap_group_dn: string | null;
  project_count: string;
}

/** ldapGroupDn — это DN корпоративной AD-группы: показываем только глобальному
 *  admin (для остальных — null), как SafeUser не отдаёт ldap_dn/email. */
const toDto = (r: DepartmentDbRow, withLdapGroup: boolean): DepartmentDto => ({
  id: r.id,
  name: r.name,
  ldapGroupDn: withLdapGroup ? r.ldap_group_dn : null,
  projectCount: Number(r.project_count),
});

const SELECT = `
  SELECT d.id, d.name, d.ldap_group_dn,
         (SELECT count(*) FROM projects p WHERE p.department_id = d.id)::text AS project_count
    FROM departments d`;

export async function listDepartments(withLdapGroup: boolean): Promise<DepartmentDto[]> {
  return (await q<DepartmentDbRow>(`${SELECT} ORDER BY d.name`)).map((r) => toDto(r, withLdapGroup));
}

/** Оба вызова — из admin-only роутов (POST/PATCH), поэтому DN отдаётся. */
export async function getDepartment(id: string): Promise<DepartmentDto | null> {
  const row = await one<DepartmentDbRow>(`${SELECT} WHERE d.id = $1`, [id]);
  return row ? toDto(row, true) : null;
}

interface MemberRow {
  user_id: string;
  source: string;
  name: string;
  initials: string;
  color: string;
  job_role: string;
}

const mapMember = (r: MemberRow): DepartmentMemberDto => ({
  userId: r.user_id,
  name: r.name,
  initials: r.initials,
  color: r.color,
  jobRole: r.job_role,
  source: r.source as "ldap" | "manual",
});

const MEMBER_SELECT = `
  SELECT dm.user_id, dm.source, u.name, u.initials, u.color, u.job_role
    FROM department_members dm
    JOIN users u ON u.id = dm.user_id`;

export async function listDepartmentMembers(departmentId: string): Promise<DepartmentMemberDto[]> {
  const rows = await q<MemberRow>(`${MEMBER_SELECT} WHERE dm.department_id = $1 ORDER BY u.name`, [departmentId]);
  return rows.map(mapMember);
}

/** Добавить вручную (идемпотентно). Если строка уже есть с source='ldap',
 *  не трогаем её — иначе UI показывал бы 'manual' до следующего ресинка,
 *  который всё равно откатит источник обратно. */
export async function addDepartmentMember(departmentId: string, userId: string): Promise<DepartmentMemberDto> {
  await q(
    `INSERT INTO department_members (department_id, user_id, source, synced_at)
       VALUES ($1, $2, 'manual', now())
     ON CONFLICT (department_id, user_id) DO NOTHING`,
    [departmentId, userId],
  );
  const row = await one<MemberRow>(`${MEMBER_SELECT} WHERE dm.department_id = $1 AND dm.user_id = $2`, [departmentId, userId]);
  if (!row) throw new Error("department member insert did not persist");
  return mapMember(row);
}

/** Убрать. Строку source='ldap' не удаляем — её тут же пересоздаст следующий
 *  вход пользователя или фоновый ресинк, а до тех пор UI лгал бы, что доступ
 *  отозван. Чтобы правда убрать LDAP-члена — из самой группы в директории. */
export async function removeDepartmentMember(
  departmentId: string,
  userId: string,
): Promise<"removed" | "not_found" | "ldap"> {
  const row = await one<{ source: string }>(
    `SELECT source FROM department_members WHERE department_id = $1 AND user_id = $2`,
    [departmentId, userId],
  );
  if (!row) return "not_found";
  if (row.source === "ldap") return "ldap";
  await q(`DELETE FROM department_members WHERE department_id = $1 AND user_id = $2`, [departmentId, userId]);
  return "removed";
}
