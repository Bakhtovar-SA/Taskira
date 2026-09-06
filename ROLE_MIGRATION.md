# ROLE_MIGRATION — переход ролевой модели с глобальной на привязанную к проекту

Статус: миграция завершена. Фазы 1–7 сделаны (сервер + клиент; `access_role` удалён миграцией 006). Multi-project — отдельный трек, эту миграцию не блокирует.
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

## 3. Ключевые проектные решения (РЕШЕНО)

### 3.1. Двухуровневая модель: один глобальный admin + руководитель на проект

Решение:

- **Глобальная роль** — `users.global_role IN ('admin', 'member')`.
  `admin` — **один на весь ресурс**. Он создаёт департаменты, проекты и
  пользователей и неявно имеет полные права в любом проекте. (Колонка технически
  допускает несколько `admin`, но продуктовая модель — один; гард «последний
  активный admin» из `server/src/routes/users.ts` сохраняется.)
- **Проектная роль** — `project_members.role IN ('manager', 'employee', 'viewer')`.
  У каждого департамента (= проекта в текущей однопроектной модели) свой
  **руководитель** — `manager`, который ставит, редактирует, удаляет задачи и
  ведёт спринты в **своём** проекте.

Эффективная роль для матрицы прав:

```
resolveRole(user, membership) =
  user.globalRole === 'admin'  ? 'admin'
  : membership?.role ?? null            // null — нет членства в проекте → 403
```

`MATRIX` остаётся на четырёх ключах и **не меняется** — меняется только источник
роли: вместо `user.accessRole` подаётся `resolveRole(...)`.

### 3.2. Распределение полномочий — `MATRIX` без изменений

| Разрешение | Роли (без изменений) | Пояснение в проектной модели |
|---|---|---|
| `browse`, `create`, `edit`, `transition`, `comment` | `admin`, `manager`, `employee` (`browse` ещё и `viewer`) | по проектной роли; `edit` для `employee` по-прежнему сужается до своих задач |
| `delete` | `admin`, `manager` | `manager` — только в своём проекте (роль резолвится по членству) |
| `manageSprints` | `admin`, `manager` | то же |
| `manageAccess` — состав участников проекта | **`admin`** | **только глобальный `admin`.** `manager` проекта состав **не** правит |
| `editWorkflow` — статусы и переходы | **`admin`** | **только глобальный `admin`.** Схема статусов единообразна между проектами отдела; `manager` её не трогает |

Следствие: `MATRIX` в обоих `permissions.ts` не редактируется вообще. Проектная
модель — это исключительно смена источника роли (`resolveRole`) + новый слой
membership. Никакого «роль расширяет матрицу в контексте проекта».

Эндпоинты управления составом (`PUT`/`DELETE /api/project/members/:userId`) идут
под `requirePerm('manageAccess')` — то есть доступны только глобальному `admin`.

### 3.3. Бэкфилл существующих данных (миграция 004)

| Текущий `users.access_role` | Результат |
|---|---|
| `admin` | `global_role = 'admin'`; **строки в `project_members` нет** — доступ через глобальную роль |
| `manager` | `project_members.role = 'manager'` в существующем проекте |
| `employee` *(бывш. `developer`, см. миграцию 002)* | `project_members.role = 'employee'` |
| `viewer` | `project_members.role = 'viewer'` |

- `global_role = 'member'` для всех, кроме `admin`.
- Членство создаётся только для **активных** (`is_active = true`) пользователей;
  деактивированным — не создаём (при реактивации `admin` добавит явно).
- Сид (`server/src/seed.ts`): первый администратор на чистой БД получает
  `global_role = 'admin'` и `access_role = 'admin'`, **без** записи в
  `project_members` — согласовано с правилом бэкфилла для `admin`. Автосозданный
  проект (`seedProject.ts`) остаётся без участников до тех пор, пока `admin` не
  назначит руководителя; сам `admin` управляет проектом через глобальную роль.

### 3.4. Откладываем

- Кросс-департаментные «общие» проекты (открытый вопрос [SCOPE.md](SCOPE.md)).
- Несколько проектов на департамент, переключатель проектов в UI, роут
  `/api/projects/:projectId/...` — **отдельный follow-up**. Этот план сажает
  membership на текущий единственный проект; multi-project становится аддитивным
  (см. Фазу 7).

### 3.5. Совместимость токенов — переходный код не нужен

Поле `role` в payload JWT для авторизации **не используется**: `requireAuth`
(`server/src/middleware.ts`) на каждом запросе перечитывает роль/активность из БД
(`freshUsers`, TTL 30 с) и перезаписывает `req.user`. Клиент токен сам не
декодирует — профиль приходит через `authApi.me()`. Значит:

- Payload можно переименовать `role` → `globalRole` **без fallback-шимов**:
  выданные токены остаются валидными, потому что значим только `sub`, а
  `requireAuth` кладёт в `req.user` уже свежий `globalRole` из БД.
- Единственное требование — `requireAuth` при промахе кэша выбирает
  `global_role` (не `access_role`), см. Фазу 2.
- Форс-релогин не требуется.

---

## 4. План по фазам

Порядок: Фазы 1–6 доводятся и мёржатся **на текущем единственном проекте**,
без работы по Департаментам. Каждая фаза оставляет систему рабочей.

### Фаза 1 — Схема БД  *(в работе)*

**Готово:**
- `server/migrations/004_project_roles.sql` — колонка `users.global_role`,
  таблица `project_members`, индекс, бэкфилл по правилу 3.3 (одна транзакция,
  как все остальные миграции).
- `server/src/seed.ts` `seedAdmin()` — первый администратор получает
  `global_role = 'admin'` (плюс прежний `access_role = 'admin'`), **без** записи
  в `project_members`.

Итоговый SQL миграции 004:

```sql
-- 1) Глобальная роль (тонкая): admin | member
ALTER TABLE users ADD COLUMN IF NOT EXISTS global_role text NOT NULL DEFAULT 'member'
  CHECK (global_role IN ('admin', 'member'));
UPDATE users SET global_role = 'admin' WHERE access_role = 'admin';

-- 2) Членство в проекте + проектная роль
CREATE TABLE IF NOT EXISTS project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('manager', 'employee', 'viewer')),
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members (user_id);

-- 3) Бэкфилл: активные пользователи, КРОМЕ admin, → участники текущего
--    единственного проекта. admin доступ получает через global_role и
--    в состав проекта не входит (правило 3.3).
INSERT INTO project_members (project_id, user_id, role)
SELECT p.id, u.id,
       CASE u.access_role
         WHEN 'manager' THEN 'manager'
         WHEN 'viewer'  THEN 'viewer'
         ELSE 'employee'
       END
FROM users u
CROSS JOIN (SELECT id FROM projects ORDER BY created_at LIMIT 1) p
WHERE u.is_active
  AND u.access_role <> 'admin'
ON CONFLICT (project_id, user_id) DO NOTHING;

-- users.access_role НЕ удаляем — параллельный прогон, дроп в 006.
```

На чистой БД `migrate()` идёт до сида: users/projects пусты → шаги 2–3 создают
только структуру, бэкфилл ничего не вставляет; далее `seedAdmin()` + `seedProject()`.

### Фаза 2 — Ядро прав (сервер)  *(сделано)*

**Реализовано:**

`server/src/errors.ts` *(новый файл, не было в плане)* — класс `ApiHttpError`
вынесен из `middleware.ts`. Причина: Фаза 2 добавляет стрелку
`middleware → services/project` (для `currentProject()`), а `services/project.ts`
импортировал `notFound` из `middleware.ts` — получался цикл. Теперь
`services/project.ts` бросает `new ApiHttpError(...)` из `errors.js`;
`middleware.ts` ре-экспортирует `ApiHttpError` для обратной совместимости
существующих импортов.

`server/src/permissions.ts`:
- `ServerUser` → `{ id, globalRole: GlobalRole }`; типы `GlobalRole`,
  `ProjectRole`, `Membership = { projectId; role: ProjectRole } | null`.
- `resolveRole(user, membership): AccessRole | null` (§3.1).
- `roleCan(role, perm, ctx?)` / `roleDenialReason(role, perm, ownViolation?)` —
  примитивы по уже вычисленной роли (нужны роутам, где роль уже в `req.projectRole`).
- `can(user, membership, perm, issue?)` / `denialReason(...)` — обёртки:
  `resolveRole` → примитив. `null` → `false` / «Нет доступа к проекту».
- `MATRIX` **не тронут** (решение 3.2). `isOwnIssue` принимает `userId: string`.

`server/src/middleware.ts`:
- `requireAuth` — `freshUsers` кэширует `{ globalRole, active }`; при промахе
  `SELECT global_role, is_active`. Payload токена (`role`/`globalRole`) для
  авторизации не используется (§3.5), старые токены работают без релогина.
- `JwtPayload.role` → `JwtPayload.globalRole`; `signToken` пишет `global_role`.
- Membership прямо в `middleware.ts` (рядом с `freshUsers`, отдельный файл
  `loadProjectContext` не понадобился): `membershipCache` `Map<'user::project', …>`,
  TTL 30 с, `loadProjectMembership()`, экспорт `invalidateMembership(userId, projectId)`.
- `req.membership` / `req.projectRole` объявлены в аугментации `FastifyRequest`.
- `requirePerm(perm)` — резолвит проект (`currentProject()`) + membership, ставит
  `req.membership`/`req.projectRole`, `can(u, membership, perm)`; 403 с `projectId`
  в аудите, если нет доступа.
- `requireIssuePerm(perm)` — в `SELECT` добавлен `project_id`; membership
  резолвится для проекта **задачи**.

`server/src/routes/issues.ts` — инлайновая проверка `manageSprints` в
`PATCH /issues/:id` переведена с `user.role` на `req.projectRole` +
`roleDenialReason(...)`.

`server/src/auth.ts` — `UserRow.global_role`; `SafeUser` пока без изменений
(поле `globalRole` в DTO — Фаза 3).

**Проверено вживую** (сборка + отдельный инстанс на :8091, БД восстановлена):
глоб. admin без строки в `project_members` — полный доступ; `member` без
членства — 403 «Нет доступа к проекту»; `member` + `project_members.role='viewer'`
— `browse` да, `create`/`manageAccess`/`editWorkflow` — 403 с точной причиной;
смена членства подхватывается после TTL/рестарта; JWT-payload несёт `globalRole`.

**Расхождение клиента (осознанное, до Фазы 4):** `src/permissions.ts` (клиент)
временно расходится с серверной копией — правило «менять обе синхронно»
(CLAUDE.md) снимается на время миграции и восстанавливается в Фазе 4, когда
клиент получит `globalRole` + `members` из bootstrap. До этого клиент работает
на прежнем `accessRole`, который сервер продолжает отдавать в `SafeUser`.

### Фаза 3 — Роуты + контракт (сервер)  *(сделано)*

**Реализовано:**

`server/src/contract.ts`:
- `GLOBAL_ROLES = ['admin','member']`, `PROJECT_ROLES = ['manager','employee','viewer']`
  (`ACCESS_ROLES` оставлен — это enum эффективной роли в ответах).
- `CreateUserBody`: `accessRole` → `globalRole: z.enum(GLOBAL_ROLES).default('member')`.
- `ChangeRoleBody`: `accessRole` → `globalRole: z.enum(GLOBAL_ROLES)`.
- `SetMemberBody = z.object({ role: z.enum(PROJECT_ROLES) })`, `MemberParams = { userId: uuid }`.
- Шапка-док обновлена (breaking).

`server/src/middleware.ts` — добавлен `zparams(schema)` (валидация path-параметров,
как `zbody`/`zquery`).

`server/src/auth.ts` — `SafeUser`/`safeUser` получили `globalRole`. `accessRole`
оставлен до Фазы 4 (клиент) / дропа колонки в 006.

`server/src/routes/project.ts`:
- `GET /api/project` → ответ получил поле `members: [{ userId, role }]`
  (`SELECT user_id, role FROM project_members WHERE project_id = …`). `users`
  остался списком всех активных профилей (assignee-пикеры и т.п.) — теперь с
  `globalRole` в каждом DTO. Профиль и проектная роль не смешаны.
- `PUT /api/project/members/:userId` `{ role }` — upsert участника
  (`INSERT … ON CONFLICT DO UPDATE`). `preHandler: requirePerm('manageAccess')`
  → только глобальный `admin`. Проверяет, что пользователь существует и активен.
- `DELETE /api/project/members/:userId` — 404 если не участник, иначе удаляет.
- **Гард `assertNotLastManager()` на обоих путях**: 409, если цель —
  единственный активный `manager` проекта (`DELETE` целиком или `PUT` с
  понижением роли). Аналог гарда «последний активный admin».
- Оба зовут `invalidateMembership(userId, projectId)` и пишут аудит
  (`member.add` / `member.role.change` / `member.remove`, с `projectId`).

`server/src/routes/users.ts`:
- `GET /users` — DTO теперь с `globalRole` (через `safeUser`).
- `POST /admin/users` — пишет `global_role` из `body.globalRole`; `access_role`
  не задаётся (дефолт `'employee'`, легаси).
- `PATCH /users/:id` — обновляет `global_role` + `is_active`; гард «последний
  активный admin» переведён на `global_role = 'admin'`.

`routes/issues.ts` — инлайн `manageSprints` уже переведён в Фазе 2.
`routes/workflow.ts` / `sprints.ts` / `comments.ts` — без изменений (роль
резолвится в `requirePerm`/`requireIssuePerm`).

**Проверено вживую** (`:8091`, БД восстановлена — 4 юзера, 3 членства, 0 задач):
bootstrap отдаёт `members` + `globalRole`; `PUT`/`DELETE` состава — только
глоб. admin (менеджер проекта → 403 `manageAccess`); гард последнего менеджера
срабатывает и на `DELETE`, и на `PUT`-понижение; смена членства применяется
сразу (`invalidateMembership`); `PATCH /users/:id` с `globalRole` работает,
гард последнего admin даёт 409; старое тело `{ accessRole }` → 400 (контракт).
Дев-сервер `:8080` подхватил изменения (`tsx watch`).

### Фаза 4 — Клиент: права и store  *(сделано)*

**Реализовано:**

`src/api/index.ts`:
- `SafeUser` получил `globalRole: GlobalRole`; `accessRole` оставлен (легаси, до Фазы 7).
- Типы `GlobalRole` / `ProjectRole` экспортируются отсюда.
- `ProjectBootstrap` получил `members: { userId; role: ProjectRole }[]`.
- `membersApi.set(userId, role)` (`PUT`), `membersApi.remove(userId)` (`DELETE`).

`src/types.ts`:
- Типы `GlobalRole`, `ProjectRole`.
- `User` получил `globalRole`. `accessRole` **оставлен**, но его смысл — уже
  *эффективная роль в текущем проекте* (для `me` вычисляется в store).
  Полное удаление поля перенесено в Фазу 5 (иначе ломается 4 UI-компонента —
  правило «зеркалить оба `permissions.ts`» это не нарушает: `MATRIX` не менялся).
- `Data` получил `members: Record<string, ProjectRole>` (состав текущего проекта).

`src/permissions.ts` (клиент):
- Добавлен `resolveRole(globalRole, projectRole)` — зеркалит серверный
  `resolveRole()`. `MATRIX` / `can()` / `denialReason()` — без изменений
  (`user.accessRole` теперь = эффективная роль, семантически == серверный `roleCan`).

`src/store.tsx`:
- `mapUser` — читает `globalRole`.
- `me` (useMemo) — эффективная роль:
  `resolveRole(base.globalRole, data.members[base.id]) ?? 'viewer'`.
- `bootstrap()` заполняет `data.members` из `boot.members`; `emptyData()` — `{}`.
- Новые экшены `setMemberRole(userId, role)` / `removeMember(userId)` —
  `requirePerm('manageAccess')` → вызов `membersApi` → оптимистичный патч
  `data.members`, тост/`handleApiError` при отказе.

`src/seed.ts` — вырезаны мёртвые демо-данные (`freshData`/`USERS`/`SPRINTS`/
`issues` никто не импортировал; типы разошлись с моделью). Оставлен только
`DEFAULT_WORKFLOW` (его тянет `DocsView.tsx`). Убрало 11 ошибок `typecheck`.

**Проверено:** `npm run build` (Vite) — успешно; `npm run typecheck` — новых
ошибок нет. Осталось 10 пред-существующих (не связаны с ролями, есть и на
`main`): `import.meta.env` в `api/index.ts` (нет `vite/client` в типах) и
сравнения `typeId === 'epic'` в 7 компонентах (тип упразднён миграцией 002) —
чинятся отдельно / в Фазе 5.

**Синхронность зеркал восстановлена частично:** `MATRIX` и логика проверок
идентичны серверу; полное удаление `User.accessRole` и чистка UI — Фаза 5.

### Фаза 5 — Клиент: UI  *(сделано)*

**`src/components/PermissionsView.tsx`** — переписан блок «состав»:
- «Участники проекта» строятся из `data.members` (userId → проектная роль),
  join с `data.users` за профилем. Не-участники в списке не показываются.
- Для роли с правом `manageAccess` (= глобальный `admin`, решение §3.2):
  `<select>` смены роли на каждом участнике (`setMemberRole`), кнопка «Убрать»
  (`removeMember`), строка «Добавить участника» (выбор из не-участников + роль).
  Остальным — `RoleBadge` только на чтение.
- Счётчики — по `data.members` + число глобальных админов.
- Отдельная строка «Администраторы ресурса» (полный доступ, не входят в состав).
- Матрица разрешений — без изменений; сноска обновлена (manageAccess/editWorkflow
  только у админа ресурса).
- «Войти как…» переименовано в «Просмотр интерфейса от лица другой роли» —
  оставлено как дев-инструмент (localhost, см. отдельный коммит), с честной
  подписью про то, что это только UI.

**`src/components/DocsView.tsx`** — строка модели данных: `User` →
`globalRole (admin | member)`, добавлена `ProjectMember`; текст про
`can()`/`resolveRole()`; секция «Хранение» переписана под API (в localStorage —
только JWT), убрано упоминание миграции `accessRole`.

**`Sidebar.tsx` / `Topbar.tsx`** — изменений не потребовалось: `me.accessRole`
после Фазы 4 уже несёт эффективную роль, бейджи корректны.

**`User.accessRole` не удалён** (отклонение от исходного плана, осознанно):
поле теперь = *вычисленная эффективная роль*, для `me` пересчитывается в
store-memo на изменение `data.members`. Полное удаление потребовало бы менять
сигнатуры `can()`/`denialReason()` на клиенте и уводить их дальше от серверной
формы — churn без выгоды. Правило «зеркалить оба `permissions.ts`» соблюдено:
`MATRIX` идентичен. Для других пользователей проектная роль читается из
`data.members` напрямую (в `PermissionsView`), не из `user.accessRole`.

**Проверено:** `npm run typecheck` — новых ошибок нет (10 пред-существующих,
не по ролям); `npm run build` — успешно. CORS-фикс (`app.ts`, `methods`) —
отдельным коммитом, без него браузерные `PATCH/PUT/DELETE` не проходили.

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
- [ ] `manager` проекта получает `403` на `editWorkflow` и на
      `PUT/DELETE /api/project/members/:userId` (эти права — только у
      глобального `admin`, решение 3.2);
- [ ] гард «последний `manager` проекта` срабатывает **и на `DELETE` членства,
      и на `PUT` с понижением роли последнего менеджера;
- [ ] гард «последний активный глобальный `admin`» при `PATCH /users/:id`;
- [ ] смена проектной роли применяется в пределах TTL кэша (30 с) без релогина;
- [ ] удаление из проекта отзывает доступ в пределах TTL;
- [ ] токен, выданный до миграции (payload с `role`), продолжает работать без
      релогина — роль берётся из БД в `requireAuth` (3.5);
- [ ] `audit_log` содержит `projectId` в `access.denied`.

### Фаза 7 — Зачистка `access_role`  *(сделано)*

- `005_*.sql` не потребовалась (004 самодостаточна).
- **`server/migrations/006_drop_access_role.sql`** — `DROP CONSTRAINT
  users_access_role_check` + `DROP COLUMN access_role` (обе `IF EXISTS`, одна
  транзакция). Применена; в `schema_migrations` — `001, 002, 003, 004, 006`.
  Перед применением снят дамп `backup_before_006.sql` (в `.gitignore`).
- Сервер: `access_role` убран из `UserRow`, `SafeUser`, `safeUser()`;
  из `INSERT` в `seedAdmin()` и `POST /api/admin/users`. `JwtPayload` /
  `signToken` / `requireAuth` были очищены ещё в Фазе 2.
- Клиент: `accessRole` убран из `SafeUser` (`src/api/index.ts`). `mapUser`
  ставит `User.accessRole` заглушкой уровня профиля
  (`resolveRole(globalRole, undefined) ?? 'viewer'`); эффективную роль `me`
  по-прежнему считает store-memo из `globalRole` + `data.members`.
- `User.accessRole` в `src/types.ts` намеренно оставлено (см. Фазу 5) — это
  теперь чисто клиентское вычисляемое поле, не из контракта.

**Проверено:** миграция в `schema_migrations`; колонки `access_role` и
constraint'а больше нет; login / `/me` / `/project` DTO без `accessRole`,
с `globalRole`; `POST /api/admin/users` (INSERT без колонки) → 201;
`typecheck` (сервер и клиент) — новых ошибок нет; `npm run build` — успешно.

### Multi-project — отдельный трек (не входит в эту миграцию)

`projects.department_id`, роут `/api/projects/:projectId/...`, резолв проекта из
параметра вместо `currentProject()`, переключатель проектов в `Sidebar`.
Ролевой механизм из Фаз 1–7 при этом не трогается — только источник `projectId`.

---

## 5. Риски и внимание

- **Два зеркальных `permissions.ts`** — `MATRIX` не меняется (решение 3.2), но
  сигнатуры `can()`/`denialReason()` и `resolveRole` правятся синхронно на
  клиенте и сервере (CLAUDE.md).
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
