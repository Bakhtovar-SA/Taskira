# DEPT_MIGRATION — департаменты + multi-project

Статус: решения раздела 3 приняты; Фазы 1–2 (схема БД + сервер) сделаны; Фаза 3 (клиент) — следующая, мёржится вместе с Фазой 2.
Контекст: пункт 1 «Порядка разработки» в [ARCHITECTURE.md](ARCHITECTURE.md) (часть Department),
иерархия доступа в [SCOPE.md](SCOPE.md). Предыдущая миграция — [ROLE_MIGRATION.md](ROLE_MIGRATION.md).

---

## 1. Зачем

[SCOPE.md](SCOPE.md): `Организация → Департамент → Проект(ы) → Задачи`. Сейчас —
один захардкоженный проект (`services/project.ts` `currentProject()`,
`ORDER BY created_at LIMIT 1`), департаментов нет. Нужно: сущность `Department`,
`projects.department_id` + `projects.is_shared`, роутинг
`/api/projects/:projectId/...`, список видимых проектов, CRUD департаментов и
проектов (только глобальный admin).

**Что уже готово от ролевой миграции:** `project_members`, `workflow_statuses`,
`workflow_transitions`, `sprints`, `issues`, `project_counters` несут `project_id`.
Ролевой слой multi-project-готов (кэш членства — ключ `user::project`;
`requireIssuePerm` резолвит роль по проекту задачи). Схема задач/ролей миграции
**не требует** — работа в резолве проекта и роутинге.

---

## 2. Что в коде сейчас

| Слой | Файл | Состояние |
|---|---|---|
| Резолв проекта | `services/project.ts` `currentProject()` | один проект, модульный кэш `cached`, `ORDER BY created_at LIMIT 1` |
| Точки вызова | ~25 в `routes/*` + `middleware.ts` | каждый handler: `const project = await currentProject()` |
| Роутинг | `app.ts` | `/api` → `/issues`, `/sprints`, `/workflow`, `/project` (bootstrap), `/users`, `/auth`. Без `:projectId` |
| Права | `middleware.ts` `requirePerm` | всегда `currentProject()` → членство → `resolveRole` |
| Права задачи | `requireIssuePerm` | **уже** грузит `issues.project_id`, резолвит членство для проекта задачи; с путём не сверяет (пути `:projectId` нет) |
| Сервисы | `getWorkflow(projectId)`, `assertTransition(projectId,…)`, `getStatuses(projectId)`, `nextIssueNum(projectId)` | **уже параметричны по проекту** |
| Нумерация | `project_counters(project_id, next_num)` | per-project ✅; `issues.key` и `projects.key` — `UNIQUE` глобально → `CORP-1`/`SEC-1` не конфликтуют |
| Каскады | FK `*.project_id … ON DELETE CASCADE` | удаление проекта уже снесёт issues/members/workflow/sprints |
| Клиент | `src/store.tsx` `Data.project` (один), `Data.members` (одного проекта) | `bootstrap()` = `me()` + `GET /api/project` + `issuesApi.list()` |
| Клиент API | `src/api/index.ts` | пути без `projectId` |
| Seed | `seedProject.ts` | один проект `CORP` + workflow + спринт; ранний выход, если проект есть |

Схема: нет `departments`, нет `projects.department_id`, нет `projects.is_shared`.

---

## 3. Ключевые решения (РЕШЕНО)

### 3.1. Существующий проект при бэкфилле (Q1)

Миграция создаёт департамент **«Общий отдел»** (имя из env `DEFAULT_DEPARTMENT`,
дефолт — «Общий отдел») и привязывает **все существующие** проекты к нему, плюс
ставит им **`is_shared = true`**.

Обоснование: у единственного pre-departments проекта состав кросс-департаментный,
точную принадлежность не угадываем — оставляем видимым всем (`is_shared`).
`department_id` при этом всё равно `NOT NULL` — «дом» есть у каждого проекта,
`is_shared` лишь снимает ограничение видимости.

- `projects.department_id` — `NOT NULL` (после бэкфилла).
- `projects.is_shared` — `boolean NOT NULL DEFAULT false`. Флаг «виден за
  пределами департамента», **не** `department_id IS NULL`.
- **Фреш-инсталл** (`seedProject`): новый проект вешается на «Общий отдел»,
  `is_shared` остаётся `false` (дефолт) — у чистого проекта нет истории смешанного
  состава. Расхождение с бэкфиллом осознанное (ср. `ROLE_MIGRATION.md §3.3`).

### 3.2. Порядок клиент/сервер (Q2)

Вариант **(a2)**: пути переносятся на `/api/projects/:projectId/...`, клиент
правится **в том же заходе** механически (`data.currentProjectId` + префикс во
всех вызовах `src/api/`), **без UI-переключателя** и **без параллельных плоских
роутов**. Переключатель проектов — отдельная фаза (Фаза 5).

Плоские `/api/issues` и т.п. **удаляются** — двойная API-поверхность не тащится
(тот же запах, что параллельный прогон `access_role`). Клиент и сервер деплоятся
вместе. При одном проекте переключать нечего — свитчер откладывается без потерь.

### 3.3. CRUD департаментов/проектов — только глобальный admin (Q3)

`SCOPE.md`: «Администратор — Всё: настройка проектов, отделов, статусов, прав».
Согласуется с `ROLE_MIGRATION.md §3.2`.

- Создание департамента/проекта **не имеет проектного контекста**, а
  `requirePerm('manageAccess')` резолвит право через `project_members`. Нужен
  **project-less guard** — новый `requireGlobalAdmin` (проверяет
  `req.user.globalRole === 'admin'` напрямую).
- Пер-проектные операции (состав, workflow) остаются на `requirePerm`.
- `manager` проекта проекты **не** создаёт.

### 3.4. `ldap_group_dn` (Q4)

Добавляется **сейчас**: `departments.ldap_group_dn text NULL`, без ограничений,
ничем не читается. Заполняется на этапе LDAP-синхронизации, тогда же — `UNIQUE`
(правило маппинга «по OU / по группе безопасности» ещё не решено, `SCOPE.md`).

Обоснование: одна nullable-колонка — нулевая цена/риск; документирует точку
интеграции; матчит целевую модель `Department { id, name, ldapGroupDn }` из
`ARCHITECTURE.md`; экономит тривиальную `ALTER TABLE` + ревью + деплой позже.

### 3.5. Видимость проекта без LDAP (Q5) — временное решение

`GET /api/projects` (и доступ к `/api/projects/:projectId/...`) отдаёт проект,
если: **пользователь есть в `project_members` этого проекта, ИЛИ проект
`is_shared`, ИЛИ пользователь — глобальный `admin`**.

Видимость «потому что ты в департаменте проекта» ([SCOPE.md](SCOPE.md): «Проект по
умолчанию виден только участникам своего департамента») — **отложена до
LDAP-этапа**: без LDAP нет источника членства в департаменте. Тот этап добавит
`department_members` (синхронизация из групп) и это правило.

**Следствие (задокументировать для админов):** участник департамента без строки
`project_members` не видит проект своего отдела, пока админ не добавит его явно
(или пока не приедет LDAP-синхронизация).

### 3.6. Исполнитель — только участник проекта (Q6)

`assigneeId` при создании/правке задачи должен быть в `project_members` этого
проекта (сейчас — любой активный пользователь). Проверка меняется с
`SELECT 1 FROM users WHERE id = $A AND is_active`
на
`SELECT 1 FROM project_members WHERE project_id = $P AND user_id = $A`
(+ активность). Небольшое ужесточение поведения, входит в Фазу 2.

---

## 4. План по фазам

Порядок: 1 → 2 → 3 → 6 даёт рабочий multi-project без переключателя. Фазы 4–5
аддитивны. Клиент (Фаза 3) мёржится **вместе** с серверной Фазой 2.

### Фаза 1 — Схема БД  *(в работе)*

**Готово:**
- `server/migrations/007_departments.sql` — таблица `departments`
  (`id`, `name UNIQUE`, `ldap_group_dn NULL`, `created_at`); `projects.department_id`
  (`uuid REFERENCES departments`, после бэкфилла `NOT NULL`), `projects.is_shared`
  (`boolean NOT NULL DEFAULT false`); бэкфилл: «Общий отдел» + все проекты на него
  с `is_shared = true`; индекс `idx_projects_department`.
- `server/src/seedProject.ts` — find-or-create «Общий отдел» (env
  `DEFAULT_DEPARTMENT`), проект вешается на него; `is_shared` не задаётся (дефолт
  `false` для фреш-инсталла, §3.1).
- `server/.env.example` — строка `DEFAULT_DEPARTMENT=Общий отдел`.

Итоговый SQL миграции 007:

```sql
CREATE TABLE departments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  ldap_group_dn text,                       -- заполняется на этапе LDAP; UNIQUE добавит тот этап
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_shared     boolean NOT NULL DEFAULT false;

-- Дефолтный департамент + привязка всех существующих проектов к нему.
-- is_shared = true: у pre-departments проекта состав кросс-департаментный,
-- принадлежность не угадываем — оставляем видимым всем (DEPT_MIGRATION.md §3.1).
WITH d AS (
  INSERT INTO departments (name) VALUES ('Общий отдел')
  ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
)
UPDATE projects
   SET department_id = (SELECT id FROM d),
       is_shared     = true
 WHERE department_id IS NULL;

ALTER TABLE projects ALTER COLUMN department_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_department ON projects (department_id);
```

На чистой БД `migrate()` идёт до сида: `projects` пуст → `UPDATE` не трогает строк,
создаётся только «Общий отдел»; далее `seedProject()` переиспользует его.

### Фаза 2 — Сервер: резолв проекта + роутинг  *(сделано)*

**`services/project.ts`** — `currentProject()` удалён; `projectById(id)` (Map-кэш),
`firstProject()` / `requireFirstProject()` для seed/служебных мест,
`invalidateProjectCache(id?)`. `ProjectRow` получил `departmentId`, `isShared`.

**`services/departments.ts`** *(новый)* — `listDepartments()` (с `projectCount`),
`getDepartment(id)`.

**`services/projects.ts`** *(новый)* — `listVisibleProjects(userId, isGlobalAdmin)`
(§3.5: `project_members` ∪ `is_shared` ∪ глоб. admin), `projectRowToDto`.

**`services/workflow.ts`** — `seedProjectWorkflow(projectId)` вынесен из `seedProject`
(4 статуса + 8 переходов); зовётся из seed и из `POST /api/projects`.

**`middleware.ts`:**
- `requirePerm` / `requireIssuePerm` берут `projectId` из `req.params.projectId`,
  грузят проект (`projectById`) в `req.project`, резолвят членство. `paramProjectId`
  сам валидирует формат uuid → `404` (на вложенных ресурсах его нет в zod-схеме).
- `requireIssuePerm`: `issues.project_id === :projectId`, иначе `404`
  (защита от `/api/projects/A/issues/<из B>`).
- Новый `requireGlobalAdmin` — project-less (CRUD департаментов/проектов, `/users`).
- `zparams` теперь **мержит** разобранное поверх `req.params` (не заменяет) — иначе
  вложенный `:projectId` терялся при валидации `:userId`/`:id`.

**`app.ts`** — дерево регистрации:
```
/api/auth/*                      authRoutes
/api/users, /api/admin/users     userRoutes            (requireGlobalAdmin)
/api/departments[/:id]           departmentRoutes      (GET — любой; CUD — global admin)
/api/projects                    projectsRoutes        GET (видимые) / POST (admin)
/api/projects/:projectId         projectsRoutes        GET bootstrap / PATCH / DELETE (admin)
/api/projects/:projectId/members/:userId               memberRoutes  (manageAccess)
/api/projects/:projectId/{issues,sprints,workflow}     ресурсы проекта
```
`routes/project.ts` удалён (bootstrap → `projectsRoutes`, состав → `memberRoutes`).

**`routes/issues.ts`** — `assigneeId` проверяется через `project_members` проекта
(либо `global_role='admin'`) — §3.6.

**`routes/users.ts`** — `requirePerm('manageAccess')` → `requireGlobalAdmin`.

**`contract.ts`** — `ProjectParams`, `DepartmentParams`, `DepartmentBody`,
`ProjectCreateBody` (ключ 2–10, `^[A-Z][A-Z0-9]+$`), `ProjectPatchBody`.

**Проверено вживую** (`:8091`, БД восстановлена — 1 департамент, CORP `is_shared`,
4 юзера/3 членства): `GET /api/departments`, `GET /api/projects` (admin — все,
`t.viewer` — только CORP), bootstrap `GET /api/projects/:id`, `POST` департамента
и проекта (+ авто-workflow), удаление проекта (каскад) и департамента (409 с
проектами / 204 пустого), path-confusion `/projects/SEC/issues/<из CORP>` → 404,
assignee не из проекта → 400, `requireGlobalAdmin` (не-admin → 403), member-роуты
под `:projectId` (admin 200 / manager 403). `typecheck` — 0.

**Клиент после этой фазы сломан** (все пути API изменились) — чинится Фазой 3,
мёржатся вместе.

### Фаза 3 — Клиент (минимальный, без свитчера)

`src/api/index.ts`: резурс-вызовы принимают `projectId`; `projectsApi.list/get/
create/patch/remove`; `departmentsApi`.

`src/store.tsx`: `Data` + `currentProjectId`, `projects: ProjectSummary[]`.
`bootstrap()` = `me()` → `projectsApi.list()` → выбрать
(`localStorage['taskira.project']` или первый) → `projectsApi.get(id)` +
`issuesApi.list(id)`. Все экшены прокидывают `data.currentProjectId`.

`localStorage` — запоминать последний выбранный проект (`taskira.project`).

### Фаза 4 — UI администрирования

`PermissionsView` / новый `AdminView`: департаменты (создать / переименовать /
удалить), проекты в департаменте (создать, тумблер `is_shared`). `ViewId` +=
`admin` (или в `access`).

### Фаза 5 — Переключатель проектов

Дропдаун в `Topbar`; выбор → перезапуск per-project bootstrap + запись в
`localStorage`.

### Фаза 6 — Верификация

`npm run typecheck` (оба), ручной чек-лист в `server/README.md`:
- глоб. admin видит все проекты; `member` — только свои `project_members` + `is_shared`;
- `GET /api/projects/:A/issues/<issue-из-B>` → `404`;
- создание задачи в проекте P пользователем без членства в P → `403`;
- `assigneeId` не из `project_members` проекта → `400`;
- `DELETE` департамента с проектами → `409`; пустого — `204`;
- `DELETE` проекта → каскад issues/members/workflow/sprints;
- нумерация: `CORP-1` и `SEC-1` независимы;
- переключение проекта применяет роль/состав нового проекта.

### Фаза 7 — Follow-ups (не в этой миграции)

- **LDAP:** `department_members` (синхронизация из групп), `ldap_group_dn`
  заполняется + `UNIQUE`, правило видимости «по департаменту» (снимает §3.5 как
  временное).
- Возможные многодепартаментные проекты — уже покрыты `is_shared`.

---

## 5. Риски

- **`currentProject()` в ~25 местах** — механически, но трогается каждый роут.
- **Смена путей ломает все клиентские вызовы разом** — клиент + сервер деплоить
  одним PR (§3.2 — плоских роутов-дублей нет).
- **Path-confusion / IDOR:** `requireIssuePerm` обязан сверять `issue.project_id`
  с `:projectId`.
- **Видимость департамента отложена (§3.5)** — участник отдела без
  `project_members` не видит проект до ручного добавления / LDAP.
- **Удаление департамента с проектами** — `409` (не каскад). Удаление проекта —
  каскад по FK; спрятать за подтверждением в UI.
- **Кэши:** `projectById` Map-кэш + инвалидация при `PATCH`/`DELETE` проекта;
  `membershipCache` (`user::project`) уже корректен.
- **`bootstrap` = 2 round-trip** (list + get) вместо одного. Минор.
- **`projects.key` коллизии** — уже `UNIQUE`; на create — понятная ошибка.
- **Гонка бэкфилла с параллельным seed** — `ON CONFLICT (name)` спасает.

---

## 6. Оценка объёма

| Фаза | Область | Размер |
|---|---|---|
| 1 | миграция 007 + seed | S |
| 2 | резолв проекта + роутинг + новые роуты (сервер) | **L** |
| 3 | клиент: api + store (без свитчера) | M |
| 4 | UI администрирования департаментов/проектов | M |
| 5 | переключатель проектов | S–M |
| 6 | верификация + чек-лист | S |
| 7 | LDAP / прочее — отдельно | — |

Критический путь: 1 → 2 → 3 → 6.
