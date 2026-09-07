/** Департаменты: список и одна запись. CRUD — в routes/departments.ts. */
import { q, one } from "../db.js";

export interface DepartmentDto {
  id: string;
  name: string;
  /** DN группы LDAP/AD — заполняется на этапе LDAP-синхронизации. */
  ldapGroupDn: string | null;
  projectCount: number;
}

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
