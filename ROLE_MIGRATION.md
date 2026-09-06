# ROLE_MIGRATION — переход ролевой модели с глобальной на привязанную к проекту

Статус: план, к реализации не приступали.
Контекст: пункт 2 «Порядка разработки» в [ARCHITECTURE.md](ARCHITECTURE.md); ролевой раздел [SCOPE.md](SCOPE.md).
Связанные документы: [server/README.md](server/README.md) — актуальный контракт API и модель данных.

---

## 1. Зачем

Сейчас роль доступа — одна глобальная колонка `users.access_role`. Один и тот же
человек не может быть менеджером в своём проекте и наблюдателем в чужом. Целевая
модель ([SCOPE.md](SCOPE.md), раздел «Роли и права»): роль назначается **в рамках
конкретного проекта**.

Матрица прав (`MATRIX` в `src/permissions.ts` и `server/src/permissions.ts`),
набор ролей (`admin | manager | employee | viewer`) и функции
`can()` / `canEditIssue()` / `denialReason()` **не меняются**. Меняется только
источник роли: вместо `user.accessRole` — роль пользователя в контексте проекта.

---

## 2. Что в коде сейчас

| Слой | Файл | Как устроено |
|---|---|---|
| Схема | `server/migrations/001_init.sql`, `002_corporate.sql` | `users.access_role text CHECK (... 'admin','manager','employee','viewer')`, глобально |
| JWT | `server/src/auth.ts` `signToken` | payload `{ sub, role, name }` — роль вшита в токен |
| Аутентификация | `server/src/middleware.ts` `requireAuth` | верифицирует JWT, но `access_role`/`is_active` перечитывает из БД (кэш `freshUsers`, TTL 30 с), перезаписывает `req.user.role` |
| Enforcement | `server/src/middleware.ts` `requirePerm` / `requireIssuePerm` | читают `req.user.role`, контекста проекта нет |
| Инлайн-проверка | `server/src/routes/issues.ts` `PATCH /issues/:id` | смена `sprintId` требует `manageSprints` — проверка по `user.role` |
| Проект | `server/src/services/project.ts` `currentProject()` | один проект, `ORDER BY created_at LIMIT 1`, кэш |
| Bootstrap | `server/src/routes/project.ts` `GET /api/project` | отдаёт **всех активных** пользователей — членства нет, доступ к единственному проекту неявный |
| Управление | `server/src/routes/users.ts` | `GET /users`, `POST /admin/users`, `PATCH /users/:id` (меняет `access_role` + `is_active`), гард «последний активный admin» |
| Контракт | `server/src/contract.ts` | `ACCESS_ROLES`, `CreateUserBody.accessRole`, `ChangeRoleBody.accessRole` |
| Клиент — права | `src/permissions.ts` | копия серверной матрицы; `can(user, perm, issue?)` по `user.accessRole` |
| Клиент — store | `src/store.tsx` | `me` выводится из `data.users` + `data.currentUserId`; `requirePerm()` гейтит каждую мутацию |
| Клиент — API | `src/api/index.ts` | `SafeUser.accessRole`, `ProjectBootstrap.users` |
| Клиент — UI | `PermissionsView.tsx`, `DocsView.tsx`, `Sidebar.tsx`, `Topbar.tsx` | матрица 4 ролей, список `data.users` по `u.accessRole`, бейдж роли |
| Мёртвые данные | `src/seed.ts` | демо-юзеры с `accessRole` (есть устаревшее `"developer"`), используется только `DEFAULT_WORKFLOW` |

---

## 3. Ключевые проектные решения (принять до кода)

### 3.1. `admin` не помещается в проектную модель — нужна двухуровневость

По [SCOPE.md](SCOPE.md) администратор управляет **отделами и проектами** — это
уровень над проектом. Значит:

- **Глобальная роль**: `users.global_role IN ('admin', 'member')`.
  `admin` — платформенный администратор: департаменты, проекты, пользователи,
  кросс-проектные операции. Неявно имеет полные права в любом проекте.
- **Проектная роль**: `project_members.role IN ('manager', 'employee', 'viewer')`.
  `manager` — администратор *своего* проекта: состав участников, схема workflow,
  удаление задач, спринты.

Эффективная роль для матрицы прав:

```
resolveRole(user, membership) =
  user.globalRole === 'admin'  ? 'admin'
  : membership?.role ?? null            // null — нет доступа к проекту → 403
```

Матрица `MATRIX` остаётся на четырёх ключах. `manager` в ней уже покрывает
`editWorkflow`? — **нет** (`editWorkflow: ['admin']`). См. 3.2.

### 3.2. Распределение проектных полномочий

| Разрешение | Сейчас | Предложение (проектная модель) |
|---|---|---|
| `browse`, `create`, `transition`, `comment` | по роли | без изменений, по проектной роли |
| `edit` (+ сужение «только свои» для `employee`) | по роли | без изменений |
| `delete` | `admin`, `manager` | `admin` (глоб.), `manager` (проекта) |
| `manageSprints` | `admin`, `manager` | `admin` (глоб.), `manager` (проекта) |
| `manageAccess` — **состав проекта** | `admin` | `admin` (глоб.) **+ `manager` проекта** (SCOPE: «управление составом» — менеджер) |
| `editWorkflow` — статусы/переходы | `admin` | **решить**: только `admin` (глоб.) — по букве SCOPE — или тоже `manager` проекта |

Если `manager` получает `manageAccess`/`editWorkflow` в своём проекте, это уже не
чистая матрица «роль → права», а «роль → права в контексте проекта». Тогда
`MATRIX` для `manager` расширяется этими двумя правами, а глобальный `admin`
остаётся superset. Рекомендация senior: **дать `manager` `manageAccess`
(состав — его работа), `editWorkflow` оставить за глоб. `admin`** — схема
статусов влияет на отчётность и должна быть единообразной между проектами
отдела. Зафиксировать в этом разделе перед Фазой 2.

### 3.3. Бэкфилл существующих данных

Сейчас доступ к единственному проекту есть у всех активных пользователей.
Миграция должна:

- `global_role = 'admin'` для тех, у кого `access_role = 'admin'`, иначе `'member'`.
- Создать `project_members` для **всех активных** пользователей в текущем
  единственном проекте с ролью по маппингу:

  | `access_role` | `project_members.role` |
  |---|---|
  | `admin` | `manager` *(плюс `global_role='admin'` даёт полный доступ)* |
  | `manager` | `manager` |
  | `employee` | `employee` |
  | `viewer` | `viewer` |

- Деактивированные (`is_active = false`) — членство **не** создаём (при
  реактивации админ добавит явно).

### 3.4. Откладываем

- Кросс-департаментные «общие» проекты (открытый вопрос [SCOPE.md](SCOPE.md)).
- Несколько проектов на департамент, переключатель проектов в UI, роут
  `/api/projects/:projectId/...` — **отдельный follow-up**. Этот план сажает
  membership на текущий единственный проект; multi-project становится аддитивным
  (см. Фазу 7).

### 3.5. Совместимость токенов

Смена payload JWT (`role` → `globalRole`) инвалидирует смысл выданных токенов.
Вариант senior: **переходный релиз читает оба поля** (`req.user.globalRole ??
(req.user.role === 'admin' ? 'admin' : 'member')`), через один цикл выпуска —
убрать чтение `role`. Форс-релогин всех — запасной вариант, если переходный код
не оправдан на внутренней системе.

---

## 4. План по фазам

Порядок: Фазы 1–6 доводятся и мёржатся **на текущем единственном проекте**,
без работы по Департаментам. Каждая фаза оставляет систему рабочей.

### Фаза 1 — Схема БД

Новая миграция `server/migrations/004_project_roles.sql` (одна транзакция, как
все остальные):

```sql
-- 1) Глобальная роль (тонкая): admin | member
ALTER TABLE users ADD COLUMN global_role text NOT NULL DEFAULT 'member'
  CHECK (global_role IN ('admin', 'member'));
UPDATE users SET global_role = 'admin' WHERE access_role = 'admin';

-- 2) Членство в проекте + проектная роль
CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('manager', 'employee', 'viewer')),
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_project_members_user ON project_members (user_id);

-- 3) Бэкфилл: активные пользователи → участники текущего единственного проекта
INSERT INTO project_members (project_id, user_id, role)
SELECT p.id, u.id,
       CASE u.access_role
         WHEN 'admin'   THEN 'manager'
         WHEN 'manager' THEN 'manager'
         WHEN 'viewer'  THEN 'viewer'
         ELSE 'employee'
       END
FROM users u
CROSS JOIN (SELECT id FROM projects ORDER BY created_at LIMIT 1) p
WHERE u.is_active;

-- users.access_role НЕ удаляем — параллельный прогон, дроп в 006.
```

`server/src/seedProject.ts` / `seed.ts` — при создании админ-пользователя и
проекта на чистой БД сразу писать `global_role='admin'` и строку
`project_members(role='manager')`.

### Фаза 2 — Ядро прав (сервер)

`server/src/permissions.ts`:
- `ServerUser` → `{ id, globalRole: 'admin' | 'member' }`.
- Новый тип `Membership = { projectId: string; role: ProjectRole } | null`.
- `resolveRole(user, membership): AccessRole | null` (см. 3.1).
- `can(user, membership, perm, issue?)`, `denialReason(user, membership, perm, issue?)` —
  сигнатуры получают `membership`; внутри `resolveRole`, дальше прежняя логика.
  `null` → `false` / «Нет доступа к проекту».
- `MATRIX`: если по 3.2 `manager` получает `manageAccess` — добавить его в этот
  ключ (и синхронно в клиентскую копию).

`server/src/middleware.ts`:
- `requireAuth` — без изменений по сути; `freshUsers` кэширует
  `{ is_active, globalRole }`. Payload читаем совместимо (3.5).
- Новый preHandler `loadProjectContext`:
  - определяет проект: пока `currentProject()`; в Фазе 7 — из `:projectId`.
  - грузит `project_members` для `req.user.sub` в этом проекте → `req.membership`.
  - кэш `membershipCache: Map<`user:project`, { role, at }>`, TTL 30 с,
    `invalidateMembership(userId, projectId)`.
- `requirePerm(perm)` → `loadProjectContext` в цепочке, проверка
  `can(serverUser(req), req.membership, perm)`; 403 если `resolveRole` вернул
  `null`. Аудит `access.denied` с `projectId` в details.
- `requireIssuePerm(perm)` → в `SELECT` добавить `project_id`; membership
  резолвится для проекта **задачи**, не для «текущего».

### Фаза 3 — Роуты (сервер)

- `routes/project.ts` `GET /api/project`: `users` → участники проекта
  (`JOIN project_members`), в DTO каждого добавить `projectRole`. Либо отдельное
  поле `members: [{ userId, role }]` — предпочтительно, чтобы не смешивать
  «профиль» и «роль в проекте».
- `routes/users.ts`:
  - `GET /users` (глоб. `admin`) — все пользователи, в DTO `globalRole`.
  - `PATCH /users/:id` — только `globalRole` + `is_active`. Гард «последний
    активный глобальный admin» (перенести с `access_role` на `global_role`).
  - Новые:
    - `PUT /api/project/members/:userId` `{ role }` — добавить/сменить роль
      участника. Право: глоб. `admin` или `manager` проекта (`manageAccess`).
    - `DELETE /api/project/members/:userId` — убрать из проекта. Гард «последний
      `manager` проекта».
    - оба зовут `invalidateMembership`.
  - `POST /admin/users` (`CreateUserBody`): `accessRole` → `globalRole`; членство
    назначается отдельным вызовом.
- `routes/issues.ts`: инлайн-проверка `manageSprints` в `PATCH /issues/:id` —
  с `user.role` на `req.membership` через `can(...)`.
- `routes/workflow.ts`, `sprints.ts`, `comments.ts` — прозрачно, `req.membership`
  выставлен в preHandler.
- `audit.ts` — `projectId` в details для событий доступа.

`server/src/contract.ts`:
- `GLOBAL_ROLES = ['admin', 'member'] as const`, `PROJECT_ROLES = ['manager',
  'employee', 'viewer'] as const`.
- `SetMemberBody = z.object({ role: z.enum(PROJECT_ROLES) })`.
- `CreateUserBody.accessRole` → `globalRole: z.enum(GLOBAL_ROLES)`.
- `ChangeRoleBody` → `{ globalRole: z.enum(GLOBAL_ROLES), isActive: z.boolean().optional() }`.
- Обновить шапку-док файла (breaking, как для миграции 002).

### Фаза 4 — Клиент: права и store

`src/permissions.ts` (держать в лок-степе с сервером — правило CLAUDE.md):
- `can()` / `denialReason()` — та же логика; ввести хелпер эффективной роли,
  все вызовы идут через него. Клиент по-прежнему только UX.

`src/types.ts`:
- `User` → `globalRole: GlobalRole`, `accessRole` убрать. **Не путать с `role`**
  (это должность, `/** Должность / job role */`).
- `Data` → `members: Record<string /* userId */, AccessRole>` для текущего
  проекта; `Data.myRole: AccessRole` (эффективная, посчитанная сервером в
  bootstrap — или считать на клиенте из `globalRole` + `members[me.id]`).

`src/store.tsx`:
- `mapUser` — читает `globalRole`.
- `me` — эффективная роль: `me.globalRole === 'admin' ? 'admin' :
  data.members[me.id] ?? 'viewer'`.
- `canFn` / `requirePerm` — сигнатуры те же, внутри эффективная роль.
- Новые экшены `setMemberRole(userId, role)` / `removeMember(userId)` —
  вызовы новых эндпоинтов, оптимистичный патч `data.members`, тост причины при
  403.

`src/api/index.ts`:
- `SafeUser.accessRole` → `globalRole`.
- `ProjectBootstrap` → `members: { userId: string; role: AccessRole }[]`.
- `membersApi.set(userId, role)`, `membersApi.remove(userId)`.

### Фаза 5 — Клиент: UI

- `PermissionsView.tsx`:
  - «Команда проекта» → участники проекта с **проектной** ролью; для глоб.
    `admin` и `manager` — дропдаун смены роли + «добавить участника» / «убрать».
  - Счётчики ролей — по проектной роли (из `data.members`).
  - Матрица разрешений — **без изменений** (те же 4 роли).
  - Убрать/переработать неработающие «Войти как…» (`switchUser` — отключённая
    заглушка по CLAUDE.md).
- `DocsView.tsx` — текст модели данных: `User` без `accessRole`, роль в
  `ProjectMember`; строку `["User", "id, name, role (должность), accessRole
  (права)", ...]` поправить.
- `Sidebar.tsx` (`me?.role` — должность, ок; бейдж `me.accessRole` → `me` эфф.
  роль), `Topbar.tsx` (аналогично, строки 145/158/162).
- `src/seed.ts` — мёртвые данные; заодно убрать устаревшее
  `accessRole: "developer"`, привести к `globalRole` или удалить поле.

### Фаза 6 — Верификация

Тест-раннера нет (CLAUDE.md) — `npm run typecheck` в обоих пакетах + ручной
чек-лист (добавить в `server/README.md`):

- [ ] глобальный `admin` видит и меняет всё, даже без строки в `project_members`;
- [ ] пользователь без членства → `403` на задачах проекта, отсутствует в списке
      участников и в bootstrap;
- [ ] один пользователь `manager` в P1 и `viewer` в P2 (эмулировать двумя
      проектами в БД до Фазы 7) → создаёт задачу в P1, получает `403` в P2;
- [ ] `employee` редактирует только свои задачи (правило уровня задачи не
      сломалось);
- [ ] гард «последний `manager` проекта» при `DELETE` членства;
- [ ] гард «последний активный глобальный `admin`» при `PATCH /users/:id`;
- [ ] смена проектной роли применяется в пределах TTL кэша (30 с) без релогина;
- [ ] удаление из проекта отзывает доступ в пределах TTL;
- [ ] старый токen (payload с `role`) продолжает работать переходный релиз (3.5);
- [ ] `audit_log` содержит `projectId` в `access.denied`.

### Фаза 7 — Зачистка и multi-project (follow-up)

- `005_*.sql` — не требуется, если 004 самодостаточна.
- `006_drop_access_role.sql` — после подтверждённого параллельного прогона:
  `ALTER TABLE users DROP COLUMN access_role;` + удалить старый constraint.
  Вычистить `access_role` из `UserRow`, `safeUser`, `JwtPayload`, `signToken`,
  `requireAuth`.
- Multi-project (отдельный план): `projects.department_id`, роут
  `/api/projects/:projectId/...`, `loadProjectContext` берёт проект из параметра,
  переключатель проектов в `Sidebar`, `currentProject()` заменяется на явный
  выбор. Ролевой механизм из Фаз 1–6 при этом не трогается.

---

## 5. Риски и внимание

- **Два зеркальных `permissions.ts`** — любое изменение матрицы/сигнатур
  синхронно на клиенте и сервере (CLAUDE.md).
- **`me.role` vs роль доступа** на клиенте — `role` это должность; не
  переименовывать вслепую.
- **Кэши**: добавляется `membershipCache` рядом с `freshUsers` и кэшом
  `currentProject()`; все пути смены роли/членства должны звать соответствующий
  `invalidate*`.
- **`requireIssuePerm`** теперь зависит от `issues.project_id` — один
  дополнительный столбец в его `SELECT`; проверить, что все задачи имеют
  `project_id NOT NULL` (в схеме — да).
- **`GET /api/project`** менял состав ответа (`users` → `members`) — клиент и
  сервер деплоить вместе либо держать оба поля переходный релиз.
- **Порядок мёржа**: Фаза 1 (миграция) уходит первой и обратно совместима
  (колонка `access_role` жива); Фазы 2–3 — следующим PR; клиент (4–5) — вместе с
  серверным PR или сразу за ним.

---

## 6. Оценка объёма

| Фаза | Область | Размер |
|---|---|---|
| 1 | миграция + seed | S |
| 2 | `permissions.ts` + `middleware.ts` (сервер) | M |
| 3 | роуты + контракт (сервер) | M |
| 4 | store + api + `permissions.ts` (клиент) | M |
| 5 | UI (`PermissionsView` в основном) | M |
| 6 | ручная верификация + чек-лист | S |
| 7 | зачистка (`006`) + multi-project | отдельно, L |

Критический путь: 1 → 2 → 3 → 4 → 5 → 6. Фаза 7 не блокирует релиз проектных
ролей на текущем единственном проекте.
