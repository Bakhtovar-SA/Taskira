# SEC-IDOR-01 — матрица доступа по всем маршрутам

**Статус: открыт, в работе на ветке `claude/m-sec-idor-01`.** **Severity: medium.** Тикет Трека M ([TRACK-M-PRODUCTION-READINESS.md](../tracks/TRACK-M-PRODUCTION-READINESS.md), раздел M1 «SEC-IDOR-01»); здесь — только привязка к строкам самопроверки SEC-ASVS-01 ([docs/security/ASVS-L2.md](../security/ASVS-L2.md)). Объём, критерии и порядок работ — в треке, этот файл их не переопределяет.

- **Требования:** ASVS 5.0: V8.2.1, V8.2.2.
- **Факт (по самопроверке, код `main` на `4b2736d`):**
  - Статический скан `server/src/routes/*.ts`: все маршруты, кроме `POST /api/auth/login`, `GET /api/instance/brand`, `GET /api/instance/brand/logo` (публичны намеренно) и WebSocket (аутентификация сообщением/кукой, `routes/ws.ts`), имеют `preHandler` с `requireAuth`/`requireSession`/`requirePerm`/`requireIssuePerm`/`requireGlobalAdmin`.
  - Наличие guard проверено, правильность роли и объекта на каждом маршруте — только выборочно (`server/test/access.multiproject.test.ts`, `access.attachments.test.ts`, `access.roles.test.ts`); манифеста «маршрут × сценарий доступа» на `main` нет.
- **Что сделать:** по Треку M — тест-манифест всех зарегистрированных маршрутов (`server/test/access/routes.manifest.ts`) и табличный прогон сценариев `anon`, `outsider`, `employee-foreign-issue`, `collaborator-other-issue`, `deactivated`, `api-token-out-of-scope`; единое правило 404/403 в SECURITY_OVERVIEW.
- **Критерий готовности:** по Треку M; после слияния строки V8.2.1, V8.2.2 в ASVS-L2.md пересмотрены со ссылкой на манифест.
- **Не сделано (на `main`):** манифест и табличный тест не слиты.
