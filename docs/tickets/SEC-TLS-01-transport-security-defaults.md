# SEC-TLS-01 — транспорт: штатно HTTP, LDAP без TLS допускается, БД и внутренние связи без TLS

**Статус: открыт.** **Severity: medium.** Найдено в SEC-ASVS-01 (самопроверка ASVS 5.0 L2, 2026-10-06; [docs/security/ASVS-L2.md](../security/ASVS-L2.md)).

- **Требования:** ASVS 5.0: V12.1.1, V12.1.2, V12.2.1, V12.3.1, V12.3.3 (и V4.4.1; `Secure` в V3.3.1 и действие HSTS в V3.4.1 — вместе с [SEC-WEB-01](SEC-WEB-01-cookie-prefix-hsts-csrf-origin.md)).
- **Факт:**
  - Штатный контейнерный nginx слушает только HTTP (`nginx.conf:6-7`); `SESSION_COOKIE_SECURE` по умолчанию `false` (`docker-compose.yml:51`, `.env.example:62`, `scripts/release/.env.example:28`), хотя в коде умолчание — `NODE_ENV === "production"` (`config.ts:514`): поставка явно перекрывает безопасное значение, и кука уходит без `Secure` (V3.3.1). HSTS по HTTP браузер игнорирует (V3.4.1). HTTPS описан образцом `deploy/https/` и не проверяется поставкой.
  - LDAP по умолчанию без StartTLS (`LDAP_STARTTLS=false`, `config.ts:272`) и `ldap://` принимается — пароли пользователей идут по сети открыто (`services/ldap.ts:49-54`).
  - PostgreSQL без TLS (`DATABASE_URL` без `sslmode`), клиентский nginx → API по HTTP внутри сети Compose; допущения не оформлены как модель угроз.
  - Образец nginx не задаёт `ssl_ciphers`.
- **Почему важно:** самое вероятное боевое несоответствие: инсталляция по HTTP с куки без `Secure` и LDAP с открытым паролем работает «из коробки» без предупреждений.
- **Решение:** чинить до внешнего аудита пп. 1, 2 и 4 (предупреждения и отказ запуска для LDAP без TLS, умолчание `Secure`, шифронаборы в образце) — самое вероятное боевое несоответствие при небольших правках конфигурации; п. 3 (TLS к PostgreSQL и nginx → API внутри сети Compose) — принять риск: эти порты не публикуются за пределы сети Compose, модель угроз записать в SECURITY_OVERVIEW.
- **Что сделать:**
  1. Старт API: предупреждение (и `health warning`) при `SESSION_COOKIE_SECURE=false`, `ldap://` без StartTLS, `CORS_ORIGIN` с `http://` вне localhost; для LDAP — отказ запуска без явного `LDAP_ALLOW_INSECURE=true`.
  2. Убрать `SESSION_COOKIE_SECURE=false` из умолчаний `render-compose.sh`/`docker-compose.yml` и `.env.example` (оставить умолчание кода), для HTTP-стенда — явное `false` с комментарием; это же условие для префикса `__Host-` (SEC-WEB-01).
  3. Поддержка `PGSSLMODE`/`sslrootcert` в `DATABASE_URL` и описание в OPERATIONS.md; в документе — модель угроз для внутренней сети Compose.
  4. В образце nginx — рекомендуемый список шифронаборов (Mozilla intermediate) и проверка в `scripts/test-security-headers.sh` или отдельным тестом.
  5. Опционально: профиль Compose с TLS на клиентском nginx.
- **Критерий готовности:** тесты конфигурации на предупреждения/отказ; OPERATIONS.md и SECURITY_OVERVIEW описывают требуемую схему TLS; строки V12.x, V4.4.1, V3.3.1, V3.4.1 пересмотрены.
- **Не сделано:** ничего из перечисленного.
