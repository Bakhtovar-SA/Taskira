/** Спринты: строка БД → DTO. */

export interface SprintRow {
  id: string;
  project_id: string;
  name: string;
  goal: string;
  status: "future" | "active" | "completed";
  start_date: string | null;
  end_date: string | null;
  created_at: Date;
}

export interface SprintDto {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  status: SprintRow["status"];
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

export function mapSprint(row: SprintRow): SprintDto {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    goal: row.goal,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
