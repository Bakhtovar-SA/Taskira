/** Демо-проект первичной настройки (ТЗ 5.11): правдоподобная служба поддержки из встроенного шаблона
 *  «Заявки и поддержка» с задачами, исполнителем, сроками, метками, чек-листом и комментариями.
 *
 *  Создаётся одной транзакцией напрямую, без маршрутов задач: не рассылает уведомлений и не пишет
 *  audit_log, чтобы удаление «без следов» было честным. Удаление снимает проект (каскад FK уносит
 *  статусы, переходы, задачи, комментарии, историю, участников, счётчик) и строки audit_log, которые
 *  успели появиться от работы с демо-задачами. Тест: server/test/onboarding.test.ts. */
import type pg from "pg";
import { one, withTransaction } from "../db.js";
import { ApiHttpError } from "../errors.js";
import { applyProjectTemplate, getProjectTemplate } from "./projectTemplates.js";
import { invalidateProjectCache } from "./project.js";
import { deleteStorageObjects, storageKeysForProject } from "./attachments.js";

type DemoIssue = {
  title: string;
  status: string;
  type: "task" | "bug" | "request";
  priority: "low" | "medium" | "high" | "critical";
  labels: string[];
  dueInDays?: number;
  doneDaysAgo?: number;
  description?: string;
  checklist?: [string, boolean][];
  comments?: string[];
};

const ISSUES: DemoIssue[] = [
  {
    title: "Нарушен SLA по заявке «Альфа-Строй»: нет доступа к порталу",
    status: "work", type: "request", priority: "critical", labels: ["sla-нарушен", "доступы"], dueInDays: -1,
    description: "Клиент второй день не может войти в личный кабинет. Ошибка 403 после смены пароля.",
    comments: ["Проверил журнал входа: учётка заблокирована после пяти неверных попыток. Разблокирую и позвоню клиенту."],
  },
  {
    title: "Не работает VPN из дома у отдела продаж",
    status: "work", type: "bug", priority: "high", labels: ["vpn", "доступы"], dueInDays: 1,
    description: "С понедельника у пяти менеджеров не поднимается туннель. В офисе всё работает.",
    comments: ["Похоже, истёк сертификат шлюза. Запросил новый у подрядчика."],
  },
  {
    title: "Подготовить ноутбук для нового сотрудника бухгалтерии",
    status: "work", type: "task", priority: "medium", labels: ["оборудование"], dueInDays: 3,
    checklist: [["Установить ОС и обновления", true], ["Ввести в домен", true], ["Установить 1С и клиент-банк", false], ["Выдать под подпись", false]],
  },
  { title: "Выдать доступ к 1С новому бухгалтеру", status: "triage", type: "request", priority: "medium", labels: ["1с", "доступы"], dueInDays: 2 },
  { title: "Не открывается общий диск \\\\fs01\\finance", status: "triage", type: "bug", priority: "high", labels: ["доступы"] },
  {
    title: "Почта не синхронизируется на телефоне",
    status: "waiting", type: "bug", priority: "medium", labels: ["почта"],
    comments: ["Попросил прислать скриншот настроек учётной записи. Ждём ответа."],
  },
  { title: "Заменить картридж в принтере на третьем этаже", status: "new", type: "request", priority: "low", labels: ["оборудование"] },
  { title: "Настроить переадресацию почты на время отпуска", status: "new", type: "request", priority: "low", labels: ["почта"], dueInDays: 5 },
  { title: "Установить видеосвязь в переговорной «Волга»", status: "resolved", type: "task", priority: "low", labels: ["оборудование"], doneDaysAgo: 2 },
  { title: "Сбросить пароль к корпоративному порталу", status: "resolved", type: "request", priority: "low", labels: ["доступы"], doneDaysAgo: 1 },
  { title: "Дубль: не работает VPN", status: "rejected", type: "request", priority: "low", labels: ["vpn"], doneDaysAgo: 3 },
];

const isoDay = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export async function demoProjectId(): Promise<string | null> {
  const row = await one<{ id: string }>(`SELECT id FROM projects WHERE is_demo LIMIT 1`);
  return row?.id ?? null;
}

/** Создать демо-проект от имени администратора. 409 — демо уже есть или нет ни одного отдела. */
export async function createDemoProject(adminId: string): Promise<string> {
  if (await demoProjectId()) throw new ApiHttpError(409, "CONFLICT", "Демо-проект уже создан");
  const dept = await one<{ id: string }>(`SELECT id FROM departments ORDER BY created_at, name LIMIT 1`);
  if (!dept) throw new ApiHttpError(409, "CONFLICT", "Сначала создайте хотя бы один отдел");
  const tpl = await getProjectTemplate("builtin:support");
  if (!tpl) throw new Error("builtin:support не найден");

  return withTransaction(async (client: pg.PoolClient) => {
    const taken = new Set((await client.query<{ key: string }>(`SELECT key FROM projects WHERE key LIKE 'DEMO%'`)).rows.map((r) => r.key));
    let key = "DEMO";
    for (let i = 2; taken.has(key); i++) key = `DEMO${i}`;
    const projectId = (
      await client.query<{ id: string }>(
        `INSERT INTO projects (key, name, description, department_id, is_demo, icon, color, default_view, suggested_labels)
         VALUES ($1, 'Демо: служба поддержки', 'Пример проекта с правдоподобными данными. Удаляется одной кнопкой в «Начальной настройке».',
                 $2, true, 'headset', 'teal', 'board', '{}') RETURNING id`,
        [key, dept.id],
      )
    ).rows[0].id;
    await applyProjectTemplate(client, projectId, tpl.spec);
    // Демо открывается на доске — так виднее, как движутся заявки (шаблон предлагает список).
    await client.query(`UPDATE projects SET default_view = 'board' WHERE id = $1`, [projectId]);
    await client.query(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'manager')`, [projectId, adminId]);

    const statuses = new Map(
      (await client.query<{ id: string; sid: string }>(`SELECT id, sid FROM workflow_statuses WHERE project_id = $1`, [projectId])).rows.map((r) => [r.sid, r.id]),
    );
    const rankIn = new Map<string, number>();
    for (const [i, it] of ISSUES.entries()) {
      const statusId = statuses.get(it.status)!;
      const rank = (rankIn.get(statusId) ?? 0) + 1000;
      rankIn.set(statusId, rank);
      const num = i + 1;
      const issueId = (
        await client.query<{ id: string }>(
          `INSERT INTO issues (project_id, num, key, title, description, type_id, status_id, priority_id, reporter_id,
                               labels, due_date, rank, done_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   CASE WHEN $13::int IS NULL THEN NULL ELSE now() - make_interval(days => $13::int) END,
                   now() - make_interval(days => $14::int), now() - make_interval(days => $15::int))
           RETURNING id`,
          [
            projectId, num, `${key}-${num}`, it.title, it.description ?? "", it.type, statusId, it.priority, adminId,
            it.labels, it.dueInDays === undefined ? null : isoDay(it.dueInDays), rank,
            it.doneDaysAgo ?? null, 7 - Math.min(6, i % 7), it.doneDaysAgo ?? 0,
          ],
        )
      ).rows[0].id;
      if (it.status !== "new") await client.query(`INSERT INTO issue_assignees (issue_id, user_id, added_by) VALUES ($1, $2, $2)`, [issueId, adminId]);
      await client.query(`INSERT INTO activity (issue_id, actor_id, text) VALUES ($1, $2, 'создал(а) задачу')`, [issueId, adminId]);
      for (const [pos, [text, done]] of (it.checklist ?? []).entries())
        await client.query(`INSERT INTO checklist_items (issue_id, text, done, position) VALUES ($1, $2, $3, $4)`, [issueId, text, done, pos]);
      for (const body of it.comments ?? []) await client.query(`INSERT INTO comments (issue_id, author_id, body) VALUES ($1, $2, $3)`, [issueId, adminId, body]);
    }
    await client.query(`INSERT INTO project_counters (project_id, next_num) VALUES ($1, $2)`, [projectId, ISSUES.length + 1]);
    return projectId;
  });
}

/** Удалить демо-проект вместе со всем, что от него осталось. Возвращает false, если демо нет. */
export async function deleteDemoProject(): Promise<boolean> {
  const id = await demoProjectId();
  if (!id) return false;
  const attachKeys = await storageKeysForProject(id); // файлы вложений каскад не удалит — как в DELETE /projects/:id
  await withTransaction(async (client) => {
    const issueIds = (await client.query<{ id: string }>(`SELECT id FROM issues WHERE project_id = $1`, [id])).rows.map((r) => r.id);
    await client.query(`DELETE FROM audit_log WHERE entity_id = ANY($1::uuid[])`, [[id, ...issueIds]]);
    await client.query(`DELETE FROM projects WHERE id = $1 AND is_demo`, [id]);
  });
  await deleteStorageObjects(attachKeys);
  invalidateProjectCache(id);
  return true;
}

