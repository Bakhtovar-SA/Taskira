# SEC-TLS-01 — транспорт: штатно HTTP, LDAP без TLS допускается, БД и внутренние связи без TLS

**Статус: открыт.** **Severity: medium.** Найдено в SEC-ASVS-01 (самопроверка ASVS 5.0 L2, 2026-10-06; [docs/security/ASVS-L2.md](../security/ASVS-L2.md)).

- **Требования:** ASVS 5.0: V12.1.1, V12.1.2, V12.2.1, V12.3.1, V12.3.3 (и V4.4.1).
- **Факт:**
  - Штатный контейнерный nginx слушает только HTTP (`nginx.conf:6-7`); `SESSION_COOKIE_SECURE` по умолчанию `false` (`docker-compose.yml:51`); HTTPS описан образцом `deploy/https/` и не проверяется поставкой.
  - LDAP по умолчанию без StartTLS (`LDAP_STARTTLS=false`, `config.ts:271`) и `ldap://` принимается — пароли пользователей идут по сети открыто (`services/ldap.ts:49-54`).
  - PostgreSQL без TLS (`DATABASE_URL` без `sslmode`), клиентский nginx → API по HTTP внутри сети Compose; допущения не оформлены как модель угроз.
  - Образец nginx не задаёт `ssl_ciphers`.
- **Почему важно:** самое вероятное боевое несоответствие: инсталляция по HTTP с куки без `Secure` и LDAP с открытым паролем работает «из коробки» без предупреждений.
- **Что сделать:**
  1. Старт API: предупреждение (и `health warning`) при `SESSION_COOKIE_SECURE=false`, `ldap://` без StartTLS, `CORS_ORIGIN` с `http://` вне localhost; для LDAP — отказ запуска без явного `LDAP_ALLOW_INSECURE=true`.
  2. Поддержка `PGSSLMODE`/`sslrootcert` в `DATABASE_URL` и описание в OPERATIONS.md; в документе — модель угроз для внутренней сети Compose.
  3. В образце nginx — рекомендуемый список шифронаборов (Mozilla intermediate) и проверка в `scripts/test-security-headers.sh` или отдельным тестом.
  4. Опционально: профиль Compose с TLS на клиентском nginx.
- **Критерий готовности:** тесты конфигурации на предупреждения/отказ; OPERATIONS.md и SECURITY_OVERVIEW описывают требуемую схему TLS; строки V12.x пересмотрены.
- **Не сделано:** ничего из перечисленного.
