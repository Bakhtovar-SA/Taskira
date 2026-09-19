# Опорные снимки БД

Каждый `.sql` — schema-only `pg_dump` после указанной исторической миграции,
плюс содержимое служебной таблицы `schema_migrations` и одна probe-строка для
проверки сохранности данных. CI автоматически тестирует каждый файл в этом
каталоге: восстанавливает его в чистый PostgreSQL, запускает актуальный сервер,
ждёт применения оставшихся миграций и проверяет health/login/probe.

Опорные точки соответствуют реальным Git-коммитам проекта:

- `schema-011-9a8a9c5.sql` — notifications schema;
- `schema-018-880c254.sql` — points → complexity;
- `schema-023-d6c3966.sql` — optional sprints module.

При каждом релизе добавляйте новый снимок, не изменяя старые:

```bash
cd server
node scripts/create-db-snapshot.mjs 029_session_version.sql \
  ../fixtures/db-snapshots/v1.4.0.sql
```

Нужны `DATABASE_URL`, клиент `pg_dump` той же или более новой версии PostgreSQL
и пустое место для временной схемы. Генератор удаляет временную схему после
создания файла. Имя релизного снимка должно содержать SemVer релиза.
