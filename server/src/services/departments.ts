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

const toDto = (r: DepartmentDbRow): DepartmentDto => ({
  id: r.id,
  name: r.name,
  ldapGroupDn: r.ldap_group_dn,
  projectCount: Number(r.project_count),
});

const SELECT = `
  SELECT d.id, d.name, d.ldap_group_dn,
         (SELECT count(*) FROM projects p WHERE p.department_id = d.id)::text AS project_count
    FROM departments d`;

export async function listDepartments(): Promise<DepartmentDto[]> {
  return (await q<DepartmentDbRow>(`${SELECT} ORDER BY d.name`)).map(toDto);
}

export async function getDepartment(id: string): Promise<DepartmentDto | null> {
  const row = await one<DepartmentDbRow>(`${SELECT} WHERE d.id = $1`, [id]);
  return row ? toDto(row) : null;
}
