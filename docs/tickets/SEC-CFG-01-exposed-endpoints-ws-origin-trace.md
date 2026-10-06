# SEC-CFG-01 — служебные эндпоинты без аутентификации, нет проверки Origin у WebSocket, `CORS_ORIGIN=*` с `credentials`, TRACE не покрыт тестом

**Статус: открыт.** **Severity: low.** Найдено в SEC-ASVS-01 (самопроверка ASVS 5.0 L2, 2026-10-06; [docs/security/ASVS-L2.md](../security/ASVS-L2.md)).

- **Требования:** ASVS 5.0: V13.4.4, V13.4.5, V4.4.2, V3.4.2.
- **Факт:**
  - `/metrics`, `/health`, `/ready`, `/api/health` без аутентификации (`app.ts:179,224-231`); `/api/health` публично раскрывает версию, ожидающие миграции и предупреждения (`app.ts:211-221`). Штатно `/metrics` снаружи недоступен (порт 8080 не публикуется, nginx проксирует только `/api/`), но при запуске без compose он открыт.
  - При WS-рукопожатии `Origin` не проверяется (`routes/ws.ts`); смягчает `SameSite=Strict` и то, что push несёт только сигнал.
  - TRACE на собранном `buildApp()` — 404 (проба 2026-10-06), через nginx и автотестом не подтверждено.
  - `CORS_ORIGIN=*` превращается в `origin: true` с `credentials: true` (`app.ts:139-147`) — проба 2026-10-06: preflight с `Origin: https://evil.example` получает этот origin в `Access-Control-Allow-Origin` и `Access-Control-Allow-Credentials: true` (V3.4.2). Допустимо только потому, что куки `SameSite=Strict`, но `server/.env.example:10` называет `*` поддерживаемым. При конкретном списке (штатный compose, `docker-compose.yml:36`) чужой origin не отражается.
- **Почему важно:** мелочи, но их находит любой сканер; часть — вопрос «что видно снаружи».
- **Что сделать:**
  1. `/metrics` — опциональный Bearer-токен/адресный allowlist (`METRICS_TOKEN`/`METRICS_ALLOW`); `/api/health` без `pendingMigrations`/`warnings` для анонимов (детали — только для администратора или внутренний `/ready`).
  2. Проверка `Origin` при WS-рукопожатии по `CORS_ORIGIN` (отказ при несовпадении, пустой Origin от не-браузерных клиентов — по настройке). Та же проверка для HTTP-запросов с кукой — в [SEC-WEB-01](SEC-WEB-01-cookie-prefix-hsts-csrf-origin.md).
  3. Запретить `CORS_ORIGIN=*` при `credentials` (отказ запуска в production) либо убрать `credentials` для `*`; поправить комментарий в `server/.env.example`.
  4. Тест `TRACE`/`OPTIONS` на собранном `buildApp()` и проверка в `scripts/test-security-headers.sh` через nginx.
- **Критерий готовности:** тесты на каждый пункт; строки V13.4.4, V13.4.5, V4.4.2, V3.4.2 пересмотрены.
- **Не сделано:** ничего из перечисленного.
