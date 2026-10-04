# INT-11 — Повторяющиеся задачи: задание, API, право `manageRecurring`

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0030 · **Зависит от:** INT-10 · **Блокирует:** INT-12, INT-14

## Цель

Правила создают задачи по расписанию ровно один раз на наступление, в том числе после простоя и при гонках.
Менеджер управляет правилами через API, участники видят правила и историю.

## Файлы

Создать:
- `server/src/services/recurring.ts` — DTO, CRUD, `runRecurringOnce()`, `runRule()`;
- `server/src/routes/recurring.ts`;
- `server/test/recurring.test.ts`.

Изменить:
- `shared/permissions.matrix.json` — новое право в конец `permissions`:
  ```json
  { "id": "manageRecurring", "name": "Повторяющиеся задачи", "desc": "Создать, изменить и остановить правила, которые создают задачи по расписанию из шаблонов задач (ADR-0030). Правила и историю запусков видят все участники.", "scope": "Проект", "roles": ["admin", "manager"] }
  ```
  затем `npm run permissions:generate` (порождает `src/permissions.matrix.ts`, `server/src/permissions.matrix.ts`,
  `docs/PERMISSIONS.md`).
- `src/i18n/ru.ts`, `en.ts` — `permission.manageRecurring` (+ описание, если у прав есть ключ описания — по
  образцу `manageDashboards`), `activity.createdByRule`, `apiError.RECURRING_LIMIT`,
  `apiError.RECURRING_ALREADY_RAN`, `apiError.TEMPLATE_IN_USE`.
- `server/src/contract.ts` — `ActivityEvent` `created`: `ruleId: z.string().uuid().optional()`,
  `ruleName: z.string().optional()`; `RecurringRuleBody`, `RecurringRulePatchBody`, `RecurringRuleDto`,
  `RecurringRunDto`, `RecurringPreviewBody`, `RecurringConfigDto`, `LIMITS.recurring`.
- `server/src/services/activity.ts` — `activityText`: `created` с `ruleName` → `создал(а) задачу по расписанию «X»`.
- `src/activityText.ts` (+ `activityLine()`) — то же через `activity.createdByRule`.
- `src/validation.ts` — зеркало `LIMITS.recurring`.
- `server/src/routes/issueTemplates.ts` — удаление шаблона, на который ссылается правило: перехватить FK-ошибку
  `23503` → 409 `TEMPLATE_IN_USE` («Шаблон используется в повторяющихся задачах: …» с именами правил).
- `server/src/config.ts`, `server/.env.example` — `RECURRING_ENABLED` (по умолчанию `true`), `RECURRING_POLL_MS`
  (60 000).
- `server/src/services/maintenance.ts` — задание `recurring` (интервал `RECURRING_POLL_MS`, старт после
  `startDelayMs` + 25 с); очистка `recurring_runs` (старше 365 дней или сверх 200 последних на правило).
- `server/src/metrics.ts` — `taskira_recurring_runs_total{result}`, `taskira_recurring_lag_seconds`.
- `server/README.md` — раздел «Повторяющиеся задачи».

## Задание

### 1. Маршруты

Трек L §4.3; права через `requirePerm("browse")` / `requirePerm("manageRecurring")`.
- `POST`/`PATCH`: `assertValidTiming`; шаблон из этого проекта (иначе 404); исполнители — участники проекта
  (`validateAssigneesInProject`); лимит 50 → 409 `RECURRING_LIMIT`; имя уникально без учёта регистра → 409
  `CONFLICT`. `owner_id` = вызывающий. `next_run_at = nextOccurrence(timing, now)`.
- `pause`: `state='paused'`, `paused_reason='manual'`, `next_run_at=NULL`. `resume`: `state='active'`,
  `paused_reason=NULL`, `next_run_at = nextOccurrence(timing, now)` (без догоняния), `owner_id` = вызывающий.
- `run-now`: `scheduled_for = date_trunc('minute', now())`, `manual = true`, тот же `runRule()`. Конфликт
  уникальности → 409 `RECURRING_ALREADY_RAN`. `next_run_at` не меняется.
- `preview` → 5 ближайших `nextOccurrence` подряд от «сейчас».
- `GET /recurring/config` (`requireAuth`) → `{ enabled, defaultTimeZone: cfg.reminders.timeZone }`.
- Аудит: `recurring.create|update|delete|pause|resume|run_now`.

### 2. Задание (`runRecurringOnce`, тик под `withAdvisoryLock("taskira:job:recurring", { wait: false })`)

До 20 правил за тик. Каждое — в своей транзакции:

```
BEGIN
  SELECT * FROM recurring_rules WHERE state='active' AND next_run_at <= now()
   ORDER BY next_run_at LIMIT 1 FOR UPDATE SKIP LOCKED            -- нет строки → COMMIT, конец тика
  due = occurrencesBetween(timing, rule.next_run_at, now(), 1000)  -- все пропущенные, включая next_run_at
  S = последний элемент due; missed = due.length - 1
  nextAt = nextOccurrence(timing, now())
  владелец NULL / неактивен / нет права create в проекте (resolveRole + roleCan, членство из project_members) →
     UPDATE rule SET state='paused', paused_reason='owner_lost_access', next_run_at=NULL;
     audit(null, 'recurring.auto_pause', …); COMMIT; continue
  skip_if_open и задача последнего запуска с result='created' существует, не в архиве, категория статуса <> 'done' →
     INSERT run (S, 'skipped_open', missed) ON CONFLICT DO NOTHING; UPDATE rule SET next_run_at=nextAt; COMMIT; continue
  SAVEPOINT s
  INSERT run (rule, S, 'created', missed) ON CONFLICT (rule_id, scheduled_for) DO NOTHING RETURNING id
     → нет строки (уже был запуск): UPDATE rule SET next_run_at=nextAt; COMMIT; continue
  issue = createIssueInTx(client, project, input(rule, template, S), rule.owner_id)
  UPDATE run SET issue_id; UPDATE rule SET next_run_at=nextAt, last_run_at=now()
  при ошибке: ROLLBACK TO SAVEPOINT s;
     INSERT run (S, 'failed', missed, error_code = код ApiHttpError или 'internal') ON CONFLICT DO NOTHING;
     UPDATE rule SET next_run_at=nextAt; audit(null, 'recurring.run_failed', …)
COMMIT
после COMMIT: те же побочные эффекты, что у POST …/issues (audit 'issue.create' c details.via='recurring',
уведомления исполнителям — как в маршруте), метрики
```

`input(rule, template, S)`:
- название: `rule.title ?? template.title`, а если пусто — `rule.name`; `{date}` → `localDateOf(S, rule.time_zone)`;
- описание, тип, приоритет, статус — из шаблона;
- исполнители — правила ∩ текущие участники проекта; выпавшие — в `run.details.droppedAssignees` (id);
- `dueDate = due_in_days` дней после `localDateOf(S)`, или `null`;
- `labels []`, `checklistItems []`;
- `activity = { kind: "created", ruleId, ruleName }`.

Без `RECURRING_ENABLED` тик `skipped`.

## Тесты (`recurring.test.ts`)

- **Права**: viewer и employee — 403 на запись, 200 на чтение и preview; manager и admin — 2xx. Матрица из
  `permissions-sync.test.ts` проходит после генерации.
- **Создание по расписанию**: `next_run_at` в прошлом → один тик → одна задача:
  - название с подставленной датой;
  - исполнители;
  - срок `+N`;
  - история `created` с `ruleName`;
  - автор — владелец;
  - `next_run_at` в будущем.
- **Догоняние**: `next_run_at` на 3 наступления назад → одна задача, `missed_count = 2`, `scheduled_for` —
  последнее наступление.
- **Дубли**:
  - два `runRecurringOnce()` параллельно → одна задача;
  - строка `recurring_runs` на `(rule, S)` уже есть (имитация «упали после коммита задачи до сдвига» — вставить её
    и вернуть `next_run_at` назад) → задача не создаётся, `next_run_at` сдвинут.
- **skip_if_open**: предыдущая задача открыта → `skipped_open`, задачи нет; закрыта → создаётся.
- **Потеря доступа**: владелец деактивирован или исключён из проекта → правило `paused/owner_lost_access`, задачи
  нет, запись аудита.
- **Ошибка создания** (у проекта нет статуса `todo`, а у шаблона нет статуса) → `failed` с кодом, `next_run_at`
  сдвинут, задач нет, транзакция не упала целиком.
- **run-now** дважды в одну минуту → второй 409 `RECURRING_ALREADY_RAN`.
- **Удаление шаблона** с правилом → 409 `TEMPLATE_IN_USE`; без правил → 204, как раньше.
- **Вебхук** (если INT-02 влит): созданная правилом задача даёт `issue.created`.
- Лимит 51-го правила → 409.

## Критерии приёмки

- `cd server && npm run typecheck && npm test` — зелёно.
- В корне `npm run typecheck && npm test && npm run docs:check && npm run permissions:check` — зелёно
  (`apiErrors.test.ts`, `cyrillicGuard.test.ts`).

## Не входит

UI (INT-12); правила с условиями; перенос правила в другой проект.

## Риски и откат

- Создание задач без человека: ошибка в расчёте может создать много задач. Защиты:
  - не больше одной задачи на правило за тик;
  - частота правила — не чаще суток;
  - уникальность запуска.
- Аварийная остановка: `RECURRING_ENABLED=false` и рестарт. Откат — revert; созданные задачи остаются обычными
  задачами.
