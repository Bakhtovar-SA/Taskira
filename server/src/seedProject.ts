/**
 * Сид проекта + дефолтного workflow (идемпотентно).
 *
 * Запускается при старте сервера и через `npm run seed`:
 *  - если нет ни одного проекта — создаёт CORP «Корпоративные задачи» (или PROJECT_KEY/PROJECT_NAME из env),
 *    4 статуса (todo / inprogress / review / done), дефолтный граф из 8 переходов
 *    и один будущий спринт (модуль спринтов опционален, но пусть будет);
 *  - повторный запуск ничего не дублирует — вся ветка пропускается, если проект есть.
 */
import { one, q } from "./db.js";
import { DEFAULT_STATUSES, DEFAULT_TRANSITIONS } from "./services/workflow.js";

export async function seedProject(): Promise<void> {
  const existing = await one<{ id: string }>(`SELECT id FROM projects LIMIT 1`);
  if (existing) {
    console.log("[seed] проект уже существует — пропускаем сид проекта и workflow");
    return;
  }

  const projectKey = (process.env.PROJECT_KEY ?? "CORP").toUpperCase();
  const projectName = process.env.PROJECT_NAME?.trim() || "Корпоративные задачи";

  const project = await one<{ id: string }>(
    `INSERT INTO projects (key, name, description)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [projectKey, projectName, "Внутренний трекер задач компании"],
  );
  if (!project) throw new Error("Не удалось создать проект");

  // Статусы (категории: todo | inprogress | inprogress | done)
  const sidToId = new Map<string, string>();
  for (const s of DEFAULT_STATUSES) {
    const row = await one<{ id: string }>(
      `INSERT INTO workflow_statuses (project_id, sid, name, category, position)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [project.id, s.sid, s.name, s.category, s.position],
    );
    if (!row) throw new Error(`Не удалось создать статус ${s.sid}`);
    sidToId.set(s.sid, row.id);
  }

  // Переходы дефолтного графа
  for (const [fromSid, toSid] of DEFAULT_TRANSITIONS) {
    await q(
      `INSERT INTO workflow_transitions (project_id, from_status_id, to_status_id)
       VALUES ($1, $2, $3)`,
      [project.id, sidToId.get(fromSid)!, sidToId.get(toSid)!],
    );
  }

  // Один будущий спринт (опциональный модуль, но API сразу рабочее)
  await q(
    `INSERT INTO sprints (project_id, name, goal, status, start_date, end_date)
     VALUES ($1, 'Спринт 1', '', 'future', CURRENT_DATE + 1, CURRENT_DATE + 14)`,
    [project.id],
  );

  console.log(`[seed] создан проект ${projectKey} «${projectName}»: 4 статуса, ${DEFAULT_TRANSITIONS.length} переходов, будущий спринт`);
}
