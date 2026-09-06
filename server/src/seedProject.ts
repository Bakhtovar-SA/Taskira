/**
 * Сид департамента + проекта + дефолтного workflow (идемпотентно).
 *
 * Запускается при старте сервера и через `npm run seed`:
 *  - находит/создаёт департамент «Общий отдел» (или DEFAULT_DEPARTMENT из env);
 *  - если нет ни одного проекта — создаёт CORP «Корпоративные задачи»
 *    (или PROJECT_KEY/PROJECT_NAME из env) в этом департаменте, 4 статуса
 *    (todo / inprogress / review / done), дефолтный граф из 8 переходов и один
 *    будущий спринт;
 *  - повторный запуск ничего не дублирует — ветка проекта/workflow пропускается,
 *    если проект уже есть. is_shared у фреш-проекта не выставляется — дефолт
 *    false (см. DEPT_MIGRATION.md §3.1; бэкфилл миграции 007 ставит true только
 *    существовавшему до департаментов проекту).
 */
import { one, q } from "./db.js";
import { seedProjectWorkflow } from "./services/workflow.js";

export async function seedProject(): Promise<void> {
  const deptName = process.env.DEFAULT_DEPARTMENT?.trim() || "Общий отдел";
  const dept = await one<{ id: string }>(
    `INSERT INTO departments (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [deptName],
  );
  if (!dept) throw new Error("Не удалось создать/найти департамент по умолчанию");

  const existing = await one<{ id: string }>(`SELECT id FROM projects LIMIT 1`);
  if (existing) {
    console.log("[seed] проект уже существует — пропускаем сид проекта и workflow");
    return;
  }

  const projectKey = (process.env.PROJECT_KEY ?? "CORP").toUpperCase();
  const projectName = process.env.PROJECT_NAME?.trim() || "Корпоративные задачи";

  const project = await one<{ id: string }>(
    `INSERT INTO projects (key, name, description, department_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [projectKey, projectName, "Внутренний трекер задач компании", dept.id],
  );
  if (!project) throw new Error("Не удалось создать проект");

  await seedProjectWorkflow(project.id); // 4 статуса + 8 переходов

  // Один будущий спринт (опциональный модуль, но API сразу рабочее)
  await q(
    `INSERT INTO sprints (project_id, name, goal, status, start_date, end_date)
     VALUES ($1, 'Спринт 1', '', 'future', CURRENT_DATE + 1, CURRENT_DATE + 14)`,
    [project.id],
  );

  console.log(
    `[seed] департамент «${deptName}»; создан проект ${projectKey} «${projectName}»: 4 статуса, 8 переходов, будущий спринт`,
  );
}
