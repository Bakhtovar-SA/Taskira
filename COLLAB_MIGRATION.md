# COLLAB_MIGRATION — участники задачи (issue collaborators) + управление составом из AdminView

Статус: **решения §3 подтверждены (D1–D8, см. «РЕШЕНО»). Фаза 4 (Feature A) — сделана,
отдельная ветка `feat/project-members-adminview`. Feature B (Фазы 1–3, 5–6) — не начата.**
Порядок: Feature A (Фаза 4) — отдельным PR первым; затем Feature B (Фазы 1–3, 5–6) одной веткой.
Контекст: [SCOPE.md](SCOPE.md) — кросс-департаментные проекты и «участие нескольких отделов»;
[ARCHITECTURE.md](ARCHITECTURE.md) — модель `Issue`. Предыдущие миграции —
[ROLE_MIGRATION.md](ROLE_MIGRATION.md), [DEPT_MIGRATION.md](DEPT_MIGRATION.md).

---

## 1. Зачем

Две связанные задачи по людям и доступу.

**(A) Удобное добавление людей в проект из AdminView.** Сейчас состав правится
только по одному проекту за раз: `switchProject` → `PermissionsView`. Нужно из
экрана отдела добавлять человека в конкретный проект этого отдела с выбором роли,
не переходя в `PermissionsView` каждого проекта. Без авто-доступа ко всем проектам
отдела — выбор проекта + роли остаётся явным, просто из более удобного места.

**(B) Новая возможность — участник конкретной задачи (issue collaborator).**
Человека из другого отдела/проекта нужно подключать к **одной задаче** (например,
сотрудник IT к задаче в проекте ИБ): он видит и комментирует именно эту задачу —
**без доступа к остальным задачам проекта**. Не становится исполнителем (assignee
остаётся ограничен участниками проекта, [DEPT_MIGRATION.md §3.6](DEPT_MIGRATION.md)) —
только просмотр + комментарии на эту задачу.

Сейчас доступ к задаче — чисто ролевой: `requireIssuePerm` → членство в проекте
задачи → `resolveRole` → `MATRIX`. Не участник → `403` на любом эндпоинте задачи.
Issue-scoped грантов нет.

---

## 2. Что в коде сейчас

| Слой | Файл | Состояние |
|---|---|---|
| Доступ к задаче | `middleware.ts` `requireIssuePerm` | членство по проекту задачи → `resolveRole` → `can()`; issue-scoped исключение только одно — «`employee` редактирует лишь свои» |
| Чтение одной задачи | `routes/issues.ts` `GET /:id` | `requirePerm("browse")` — **project-scoped**, не issue-scoped |
| Чтение комментариев | `routes/comments.ts` `GET /:id/comments` | `requirePerm("browse")` — project-scoped |
| Запись комментария | `routes/comments.ts` `POST /:id/comments` | `requireIssuePerm("comment")` |
| Список задач | `routes/issues.ts` `GET /` | `requirePerm("browse")` — **без контекста задачи** (ключевое для изоляции collaborator) |
| История (`activity`) | `services/issues.ts` `logActivity` пишет; **read-эндпоинта нет** | клиент `openIssue` тянет только `issue` + `comments`; `issue.activity` на API-версии фактически всегда пуст |
| Видимость проекта | `services/projects.ts` `listVisibleProjects` | `project_members ∪ is_shared ∪ admin` ([DEPT_MIGRATION.md §3.5](DEPT_MIGRATION.md)) |
| Assignee | `routes/issues.ts` create/patch | `global_role='admin' OR project_members` ([DEPT_MIGRATION.md §3.6](DEPT_MIGRATION.md)) |
| MATRIX | `src/permissions.ts` ↔ `server/src/permissions.ts` | заморожен ([ROLE_MIGRATION.md §3.2](ROLE_MIGRATION.md)); 9 прав, роли `admin/manager/employee/viewer` |
| Состав проекта | `routes/members.ts` `PUT`/`DELETE /:userId` | `requirePerm("manageAccess")` = только global admin; атомарный гард «последний менеджер»; **уже работает для любого проекта**, если вызывающий — global admin |
| Клиент — состав | `store.tsx` `data.members` | только **текущий** проект; `setMemberRole`/`removeMember` бьют в `pid()` |
| Клиент — AdminView | `src/components/AdminView.tsx` | на проект: инлайн-название, `is_shared`, «Открыть», удалить. **Состава нет** |
| Список пользователей | `routes/users.ts` `GET /api/users` | `requireGlobalAdmin` — **менеджеру недоступен** (важно для пикера, D7) |

Схема: таблицы `issue_collaborators` нет. Последняя миграция — `007_departments.sql`
(005 пропущена, 006 — drop `access_role`); следующая — **008**.

---

## 3. Ключевые решения (РЕШЕНО)

Подтверждено целиком, как предложено:

| # | Решение |
|---|---|
| **D1** | Collaborator — не роль. Аддитивный fallback в `requireIssuePerm`: провал `can()` + `perm ∈ {browse, comment}` + строка `issue_collaborators` → пропуск, `req.isCollaborator = true`. `resolveRole` / роли / права ролей в `MATRIX` не меняются. |
| **D2** | Добавляет/убирает collaborator — **менеджер проекта + global admin**. Новое право `manageCollaborators`, аддитивный ключ в `MATRIX` обеих копий `["admin", "manager"]`, проверка issue-scoped. Автор/исполнитель — нет (возможный follow-up-тоггл). |
| **D3** | Collaborator видит **всю задачу + полный тред комментариев** всех участников. Не видит: список задач, доску, бэклог, спринты, workflow, состав проекта, проект в переключателе. История (`activity`) read-эндпоинта не имеет — вопрос неактуален; появится позже — тот же `requireIssuePerm("browse")`. |
| **D4** | **Фаза 6 входит в этот заход.** Без одиночного просмотра задачи фича не решает исходный сценарий (чисто внешний участник без иного доступа к проекту). |
| **D5** | `GET /issues/:id` и `GET /issues/:id/comments` переводятся с `requirePerm("browse")` на `requireIssuePerm("browse")`. Для участников/админов — идентично; попутно строже IDOR. Регрессионный тест «участник → `200`» обязателен. |
| **D6** | Collaborator никогда не assignee. Проверка `global_role='admin' OR project_members` уже это гарантирует — **не ослаблять**. |
| **D7** | Тонкий `GET /api/users/pickable` (`id, name, initials, color, jobRole, isActive`) для любого аутентифицированного. Полный `/api/users` (`globalRole`, `username`) остаётся admin-only. |
| **D8** | Feature A (состав из AdminView) — без миграции, чисто клиент. Параметрические стор-экшены + ленивый `projectsApi.get` на раскрытие блока «Состав». Отдельный маленький PR **первым**. |

Ниже — обоснования и отклонённые альтернативы по каждому пункту.

### D1. Enforcement для collaborator — аддитивная проверка в `requireIssuePerm`, MATRIX по сути не трогаем

**Рекомендация.** Collaborator — **не роль**. В `requireIssuePerm(perm)`: если
обычный `can()` не прошёл, `perm ∈ {browse, comment}` **и** есть строка
`issue_collaborators(issue, user)` → пропускаем, ставим `req.isCollaborator = true`.
`resolveRole`, значения ролей и наборы прав ролей в `MATRIX` не меняются.

**Обоснование.** Грант строго issue-scoped. Список задач `GET /api/projects/:id/issues`
и bootstrap `GET /api/projects/:id` ходят через `requirePerm("browse")` **без
контекста задачи** — там collaborator как получал `403`, так и получает → бэклог не
течёт. Это прямая параллель уже существующему issue-scoped спец-правилу «`employee` —
только свои задачи».

**Альтернатива (хуже).** Псевдороль `collaborator` в `MATRIX`: `browse` в матрице
означает «весь проект», пришлось бы расщеплять смысл общего права и пачкать
замороженную зеркальную матрицу.

### D2. Кто добавляет/убирает collaborator — **менеджер проекта + global admin**

**Рекомендация.** Новое право `manageCollaborators`, **аддитивный** ключ в `MATRIX`
обеих копий: `["admin", "manager"]`. Проверяется issue-scoped:
`requireIssuePerm("manageCollaborators")`.

**Обоснование.** Минимальный грант, снимающий трение: менеджер ИБ сам подключает
айтишника к своей задаче, но ответственный за проект в контуре. `manageAccess`
(состав проекта целиком) остаётся admin-only — это заметно больший грант.

**Не рекомендую.**
- *Только global admin* — возвращает всё трение к одному человеку, ради чего фича и
  затевается.
- *Автор/исполнитель задачи тоже может* — тогда любой сотрудник может расширять
  круг видящих задачу. Оставить опциональным follow-up (Фаза 6), если менеджеры
  сочтут поток слишком медленным.

**Альтернатива без MATRIX.** Инлайн-проверка `req.projectRole ∈ {admin, manager}`
прямо в роуте (как проверка `manageSprints` при смене `sprintId` в `issues.ts`).
Рабочее, но право не отображается в матрице `PermissionsView` и не покрыто общим
механизмом. Матрицу считаю более честным местом.

### D3. Что видит collaborator — **сама задача + вся ветка комментариев** (не только свои)

**Рекомендация.** Задача (все поля карточки) + полный тред комментариев всех
участников. **Не видит:** список задач, доску, бэклог, спринты, редактор workflow,
состав проекта, сам проект в переключателе (если он не участник и проект не
`is_shared`).

**Обоснование.** Обсуждение, в котором виден только свой комментарий, бессмысленно
(«мог комментировать» подразумевает диалог). Весь объём — одна задача.

**История (`activity`).** Отдельного read-эндпоинта у истории сейчас нет, на клиенте
она фактически пуста — то есть **вопрос не актуален на сегодня**. Если позже появится
`GET /issues/:id/activity`, он должен идти под тем же `requireIssuePerm("browse")`;
тогда же решим, показывать ли историю приглашённому (там всплывают внутренние имена
и churn статусов) — это самое дешёвое, что можно ограничить.

### D4. Клиентская достижимость — чисто внешний collaborator и Фаза 6

**Как есть по фазам.** Phase A (Фазы 1–3) даёт: серверный enforcement + UI
добавления/показа collaborator'ов в `IssueModal` (для manager/admin) + это сразу
работает для collaborator'ов, **у кого уже есть доступ к проекту** (участник или
`is_shared`). **Чисто внешний** collaborator (нет членства, проект не общий) на
Phase A имеет доступ по API, но UI, чтобы открыть задачу, ещё нет — клиент
project-центричен, `bootstrap()` грузит проект целиком.

**Решено — делаем в этом заходе (Фаза 6).** Отдельный «одиночный просмотр задачи»:
прямая ссылка на задачу + раздел «Мои подключения» (`GET /api/issues/collaborating`)
+ мини-bootstrap (`getIssueDto` с `participants` + `/comments`), урезанная карточка
без проектной навигации. Без этого чисто внешний участник (нет членства, проект не
`is_shared`) имеет доступ по API, но не может открыть задачу — а это и есть исходный
сценарий.

### D5. Перевод чтения задачи/комментариев на issue-scoped

`GET /issues/:id` и `GET /issues/:id/comments` переводятся с `requirePerm("browse")`
на `requireIssuePerm("browse")`. Для участников/админов поведение идентично; для
collaborator — открывается fallback D1; попутно строже IDOR (сверка
`issue.project_id == :projectId` вместо доверия пути). Горячие пути — обязателен
регрессионный тест «участник по-прежнему `200`».

### D6. Collaborator никогда не assignee

Существующая проверка assignee (`global_role='admin' OR project_members`) уже это
гарантирует — **не ослаблять**, collaborator в списке кандидатов не появляется.
Если collaborator позже станет участником проекта — строка `issue_collaborators`
становится no-op; чистить не обязательно (можно удалять при добавлении в состав —
косметика).

### D7. Пикер пользователей для менеджера

`GET /api/users` сейчас `requireGlobalAdmin`. Менеджеру он недоступен, а для
подключения collaborator'а нужен кросс-департаментный выбор человека.

**Решено:** тонкий `GET /api/users/pickable` — `id, name, initials, color, jobRole,
isActive` (только активные) для **любого аутентифицированного**. Полный `/api/users`
(с `globalRole`, `username`) остаётся admin-only — не светим глобальные роли и логины
всем. Отклонено: ослабление `/api/users` целиком.

### D8. Feature 1 (состав из AdminView) — схема не нужна, чисто клиент

Сервер уже позволяет global admin'у `PUT`/`DELETE` участника **любого** проекта
(`requirePerm("manageAccess")` резолвит `admin` глобально). AdminView и так
admin-only. Значит:

**Рекомендация.** Параметрические стор-экшены `setProjectMember(projectId, …)` /
`removeProjectMember(projectId, …)`; в AdminView на каждый проект — раскрываемый
блок «Состав»: ленивый `projectsApi.get(projectId)` **на раскрытие** (без нового
эндпоинта — bootstrap уже отдаёт `members` + `users`), дропдауны ролей, «Убрать»,
строка «добавить: пользователь + роль». `409` «последний менеджер» → тост.

**Порядок.** Feature 1 независима от Feature 2 и не требует миграции — можно
выпустить **первым отдельным маленьким PR**.

---

## 4. План по фазам

Порядок: **Фаза 4 (Feature A) — отдельным PR первой.** Затем Feature B одной веткой:
**1 → 2 → 3 → 6 → 5** (5 — верификация всего, после одиночного просмотра).

### Фаза 1 — Схема БД (миграция 008)  *(план)*

```sql
-- server/migrations/008_issue_collaborators.sql
-- Приглашённый участник ОДНОЙ задачи: просмотр задачи + комментарии, без
-- членства в проекте и без доступа к остальным задачам (COLLAB_MIGRATION.md D1).
CREATE TABLE issue_collaborators (
  issue_id  uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  added_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX idx_issue_collaborators_user ON issue_collaborators (user_id);
```

Бэкфилла нет — новая возможность. Каскады: удаление задачи или проекта (через
`issues`) сносит строки `issue_collaborators`.

### Фаза 2 — Сервер: enforcement + роуты коллабораторов  *(план)*

- **`permissions.ts` ×2** — `PermId` += `manageCollaborators`; `MATRIX.manageCollaborators = ["admin", "manager"]`; `PERM_NAMES` += запись. Меняется в **обеих** копиях одним коммитом (CLAUDE.md).
- **`middleware.ts` `requireIssuePerm`** — после провала `can()`: если
  `perm ∈ {browse, comment}` и `await isIssueCollaborator(u.id, issueId)` → пропустить,
  `req.isCollaborator = true`. Хелпер `isIssueCollaborator(userId, issueId)`
  (`SELECT 1 FROM issue_collaborators …`); при нагрузке — короткий TTL-кэш
  `user::issue` рядом с `membershipCache` + `invalidateIssueCollaborator()`.
- **`routes/issues.ts` `GET /:id`** и **`routes/comments.ts` `GET /:id/comments`** →
  `requireIssuePerm("browse")` (было `requirePerm("browse")`), D5.
- **`services/collaborators.ts`** *(новый)* — `listCollaborators(issueId)` (с мини-профилем),
  `isIssueCollaborator(userId, issueId)`, `addCollaborator(issueId, userId, byId)`,
  `removeCollaborator(issueId, userId)`.
- **`routes/collaborators.ts`** *(новый)*, под `/api/projects/:projectId/issues/:id/collaborators`:
  - `GET` — `requireIssuePerm("browse")` (видят и участники, и сам collaborator);
  - `PUT /:userId` — `requireIssuePerm("manageCollaborators")`; цель — **любой
    активный пользователь** (в этом смысл кросс-департаментности); `409`, если уже
    участник проекта задачи (не нужно — пусть работает как участник) — опционально,
    можно молча no-op;
  - `DELETE /:userId` — `requireIssuePerm("manageCollaborators")`.
  - Аудит `issue.collaborator.add` / `issue.collaborator.remove` (`{ userId }`).
- **`app.ts`** — регистрация `collaboratorRoutes` в под-дереве `/projects/:projectId`
  с `prefix: "/issues"` (рядом с `commentRoutes`).
- **`services/issues.ts` `getIssueDto`** — добавить `collaborators: [{ userId, name, initials, color }]`
  (для Фазы 6 — ещё `participants`: reporter + assignee + авторы комментариев).
- **`contract.ts`** — `CollaboratorParams = z.object({ userId: uuid })`; тела у `PUT` нет.

### Фаза 3 — Клиент: добавление/показ в IssueModal  *(план)*

- **`src/api/index.ts`** — `collaboratorsApi.list(projectId, issueId)` /
  `.add(projectId, issueId, userId)` / `.remove(projectId, issueId, userId)`;
  `usersApi.pickable()` (D7).
- **`src/store.tsx`** — деталь задачи несёт `collaborators`; экшены
  `addCollaborator(issueId, userId)` / `removeCollaborator(issueId, userId)` под
  `requirePerm("manageCollaborators", issue)`, оптимистичный патч + `handleApiError`.
  `openIssue` дотягивает `collaborators` из `getIssueDto`.
- **`src/components/IssueModal.tsx`** — секция **«Участники задачи»** (отдельно от
  «Наблюдателей» и от исполнителя): чипы с аватарами + (для manager/admin) пикер из
  `usersApi.pickable()` + «убрать». Подпись: «видит эту задачу и комментарии, не
  входит в проект». Для остальных ролей — read-only чипы.
- **`src/permissions.ts`** (клиент) — `manageCollaborators` в `MATRIX` уже добавлен
  в Фазе 2 (зеркало).

### Фаза 4 — Клиент: состав проекта из AdminView (Feature A)  *(сделано)*

Ветка `feat/project-members-adminview` от `main` (после мержа PR #11). Схема и сервер
не менялись — `PUT`/`DELETE /api/projects/:projectId/members/:userId` уже доступны
глобальному admin для любого проекта.

- **`src/store.tsx`** — `setProjectMember(projectId, userId, role)` /
  `removeProjectMember(projectId, userId)` (`Promise<void>`, гейт
  `requirePerm("manageAccess")`, `handleApiError` + rethrow). Если
  `projectId === currentProjectId` — `syncCurrentMembers()`: ресинк `data.members`
  **и** `data.users` из свежего bootstrap (оптимистичного патча только `data.members`
  мало — новый участник иначе отсутствует в `data.users`: сырой UUID в
  `PermissionsView`, нет в пикере исполнителя — правка по ревью PR #12).
- **`src/components/AdminView.tsx`** — на каждый проект кнопка «Состав» (chevron)
  разворачивает `<ProjectMembers>`: ленивый `projectsApi.get(projectId)` при
  раскрытии (без нового эндпоинта), участники с дропдаунами ролей и «Убрать»,
  строка «добавить: человек + роль». Кандидаты — `usersApi.list()` (AdminView
  admin-only), минус глобальные админы и уже состоящие. После каждой мутации —
  рефетч bootstrap проекта (виден отказ гарда «последний менеджер» — `409` → тост).
  Подпись «добавление не открывает остальные проекты отдела».
- **`server/test/access.multiproject.test.ts`** — блок «состав проекта — global
  admin правит любой проект»: admin добавил/убрал участника в проекте, где не
  состоит; менеджер чужого проекта → `403`; понижение единственного менеджера →
  `409`. Всего 20 тестов, зелёные.
- Проверка: `typecheck` (клиент — 10 пред-существующих, новых нет; сервер — 0),
  `npm run build` — успешно, `npm test` (сервер) — 20/20. **Браузерная проверка UI
  ещё не делалась.**
- Без авто-доступа: добавление — всегда явный выбор проекта + роли (§1(A), D8).

### Фаза 5 — Верификация  *(план)*

Тест-раннер — Vitest (`server/test/`), новый `access.collaborators.test.ts` +
ручной чек-лист в `server/README.md`:

- collaborator: `GET issue` → `200`; `GET/POST /comments` → `200`;
- collaborator: `GET /api/projects/:id/issues` (список) → `403`; bootstrap
  `GET /api/projects/:id` → `403`; `PATCH`/`DELETE`/`transition` задачи → `403`;
- collaborator **не появляется** в `GET /api/projects` и в переключателе проектов;
- участник проекта: доступ к задаче и комментариям не изменился (регресс D5);
- IDOR: `GET /api/projects/A/issues/<из B>` и `…/comments` → `404`;
- assignee: collaborator в `assigneeId` при create/patch → `400`;
- `manager` добавил и убрал collaborator; `employee`/`viewer` на `PUT/DELETE
  …/collaborators/:userId` → `403`;
- удаление задачи и удаление проекта каскадят `issue_collaborators`;
- AdminView: global admin из экрана отдела добавил человека в проект **другого**
  отдела, роль применилась; `409` при понижении последнего менеджера;
- **одиночный просмотр (Фаза 6):** чисто внешний collaborator (0 видимых
  проектов) логинится → видит «Мои подключения» и открывает задачу по прямой
  ссылке; `GET /api/issues/collaborating` отдаёт только его задачи; карточка
  рендерит имена участников без bootstrap проекта; форма комментария работает,
  прочие мутации скрыты; пользователь без collaborator-строк и без проектов →
  пустой экран «нет доступных задач», не ошибка.

### Фаза 6 — Клиент: одиночный просмотр задачи для внешнего collaborator  *(план, в этом заходе — D4)*

- **`server`**:
  - `GET /api/issues/collaborating` — задачи, где текущий пользователь collaborator
    (кросс-проектно): `[{ issueId, projectId, key, title, statusId, projectName }]`,
    `preHandler: requireAuth` (без проектного контекста).
  - `getIssueDto` — поле `participants: [{ id, name, initials, color }]` (reporter +
    assignee + авторы комментариев + collaborators) — чтобы карточка рендерила имена
    без bootstrap проекта.
- **`src/api/index.ts`** — `issuesApi.collaborating()`; `issuesApi.get` уже
  issue-scoped (D5).
- **`src/store.tsx`** — режим «одиночная задача»: если `bootstrap()` не смог
  открыть ни одного проекта (нет видимых) ИЛИ пользователь пришёл по прямой ссылке
  `#/issue/<projectId>/<id>` — грузим `getIssueDto` + `/comments` + `collaborating`
  в урезанный `Data` (без `workflow`/`sprints`/`board`), `bootStatus = "ready"`.
- **`src/App.tsx` / `IssueModal` / новый `SoloIssueView`** — карточка задачи во весь
  экран: заголовок, поля (read-only), тред комментариев + форма (если
  `req.isCollaborator` → `comment` разрешён), список «Мои подключения» для навигации
  между такими задачами. Без сайдбара проекта, доски, переключателя.
- **`Sidebar` / `Topbar`** — прячутся или сводятся к «Мои подключения», если у
  пользователя нет ни одного видимого проекта.

**Отложено за пределы захода (отдельные follow-ups):**

- Тоггл «автор/исполнитель задачи тоже может подключать collaborator'ов» (D2).
- `GET /issues/:id/activity` + показывать ли историю приглашённому (D3).
- Чистка строки `issue_collaborators` при добавлении того же человека в состав
  проекта (D6, косметика).

---

## 5. Риски и внимание

- **Правка авторизации `GET issue` / `GET comments`** на горячих путях (D5) —
  регресс доступа участников. Обязателен тест «участник → `200`».
- **`MATRIX` меняется в ОБЕИХ копиях** одним коммитом (CLAUDE.md), ключ аддитивный
  (существующие права ролей не трогаются).
- **Fallback D1 обязан быть строго issue-scoped.** Протечка в `requirePerm("browse")`
  (роут списка) = утечка всего бэклога. Явные тесты на `403` списка и bootstrap для
  collaborator.
- **Пикер пользователей (D7)** — решить `pickable` vs ослабление `/api/users` до
  подтверждения фаз.
- **Одиночный просмотр (Фаза 6)** трогает boot-путь клиента (`bootstrap()` при
  0 видимых проектов, разбор прямой ссылки, скрытие сайдбара/переключателя) —
  регресс для обычных пользователей с проектами; проверить оба сценария.
- **`isIssueCollaborator`** — доп. запрос только когда роль-проверка уже провалилась
  (участники/админы его не задевают). При нужде — короткий TTL-кэш `user::issue`.
- **UI-терминология** — «Участники задачи» (collaborators) ≠ «Участники проекта»
  (members) ≠ «Наблюдатели» (watchers). Разные секции, разные подписи.
- **Feature 1:** `data.members` — только текущий проект; патчить лишь при совпадении
  `projectId`, иначе рассинхрон роли `me`.
- **assignee vs collaborator** в `IssueModal` — визуально разнести, чтобы менеджер не
  путал «подключить к обсуждению» и «назначить ответственным».

---

## 6. Оценка объёма

| Фаза | Область | Размер |
|---|---|---|
| 4 | **Feature A** — состав проекта из AdminView (без миграции). Отдельный PR, первым | M |
| 1 | миграция 008 (`issue_collaborators`) | S |
| 2 | сервер: `manageCollaborators` + fallback в `requireIssuePerm` + роуты коллабораторов + `getIssueDto` + `/api/users/pickable` | **M–L** |
| 3 | клиент: `collaboratorsApi` + store-экшены + секция «Участники задачи» в `IssueModal` | M |
| 6 | сервер `GET /api/issues/collaborating` + `participants`; клиент — одиночный просмотр задачи / «Мои подключения» | **M–L** |
| 5 | верификация + `access.collaborators.test.ts` + чек-лист | S–M |

Feature A (Фаза 4) — независимый маленький PR, первым. Feature B — Фазы
1 → 2 → 3 → 6 → 5 одной веткой.
