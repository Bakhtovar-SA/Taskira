# Локальный стенд и материалы аудита

Checkout: `D:/CodexScratch/Taskira-UI-Audit-20261009`. Runtime: `D:/CodexScratch/Taskira-UI-Audit-20261009-runtime`. Ветка: `codex/ui-audit-2026-10-09`; baseline: `da85515e04f6f5e07baa39cee4bbbdb3a9f95140`.

- Приложение: http://localhost:3000
- Альбом: http://localhost:3000/docs/design/audit-2026-10-09/index.html
- API: http://127.0.0.1:8080 с proxy Vite /api
- PostgreSQL: 127.0.0.1:55432, отдельный кластер runtime/postgres и база taskira_ui_audit
- Вход: файл `D:/CodexScratch/Taskira-UI-Audit-20261009-runtime/LOGIN.txt`, пользователи audit_admin, audit_manager, audit_employee, audit_viewer.

## Запуск и остановка

В PowerShell:

```powershell
Set-Location 'D:/CodexScratch/Taskira-UI-Audit-20261009'
& './docs/design/audit-2026-10-09/tools/start.ps1'
# Когда совместный просмотр закончен:
& './docs/design/audit-2026-10-09/tools/stop.ps1'
```

Стенд оставлен работающим. Скрипт start проверяет сохранённые PID и время старта, не занимает занятые чужими процессами порты; stop завершает только зарегистрированные процессы и отдельный PostgreSQL-кластер. Логи runtime/logs; процессы runtime/processes.json. Секреты в server/.env.audit (игнорируется Git). LOGIN.txt содержит только тестовый пароль и не входит в репозиторий. PostgreSQL binary читается из установленного C:/Program Files/PostgreSQL/18/bin; данные и временные файлы на D.

## Повторение на этой машине

Зависимости установлены по обоим lock-файлам. При необходимости установить заново с TEMP/TMP/npm cache на D:

```powershell
$env:TEMP='D:/CodexScratch/Taskira-UI-Audit-20261009-runtime/temp'
$env:TMP=$env:TEMP
$env:npm_config_cache='D:/CodexScratch/Taskira-UI-Audit-20261009-runtime/npm-cache'
npm ci
npm ci --prefix server
npm run build --prefix server
node './docs/design/audit-2026-10-09/tools/setup.mjs'
node --env-file=server/.env.audit --import tsx './docs/design/audit-2026-10-09/tools/seed.mjs'
& './docs/design/audit-2026-10-09/tools/start.ps1'
```

Setup ограничен host127.0.0.1/port55432/dbtaskira_ui_audit; seed запускает штатные миграции/startup seeds и создаёт 2 проекта, 4 роли, 17 задач с разными статусами/сроками, длинным текстом и несколькими исполнителями. Seed не предназначен для сброса всех изменений. Auth local; внешние письма/напоминания/webhooks отключены. Login rate limit поднят до100 только для повторяемых проверок ролей в локальном стенде.

Снимки: `node docs/design/audit-2026-10-09/tools/audit-capture.mjs`. Реальные сценарии: `node docs/design/audit-2026-10-09/tools/audit-behavior.mjs`, затем `node docs/design/audit-2026-10-09/tools/audit-confirm.mjs` для нормализации результатов и восстановления тестовых изменений. Повтор перезаписывает только снимки **этого** аудита; старые эталоны вне каталога не менялись. Предпочтительно новый каталог для следующего baseline. Дефекты в инъекциях не являются падением самого сценария; финальная классификация записана в real-api-checks.json.

Профильные существующие проверки и точная конфигурация перечислены в assessment-b.md и playwright-checks.txt. Общие результаты — report.md. Утилиты используют установленные Playwright/Chromium, не скачивают браузер на C. Снимки не заменяют реальный zoom200%, это отдельно отмечено в отчёте.

## Аннотации

Откройте настоящий интерфейс на localhost:3000 и оставляйте аннотации прямо на нём. Альбом исходных экранов служит архивом до/после и не требует действий. Полученные 14 аннотаций и дополнительное замечание о группировке записаны в ../refinement-2026-10-10/annotations.json. Новое сравнение — ../refinement-2026-10-10/index.html.

### Уточнение для совместного просмотра · 10 октября

Альбом исходных экранов — архив для сравнения; выполнять действия на снимках не требуется. Открывайте настоящее приложение http://localhost:3000 и оставляйте аннотации там. Полученные 14 отметок и замечание о группировке записаны в `../refinement-2026-10-10/annotations.json` и связаны с исправлениями. Визуальное сравнение: http://localhost:3000/docs/design/refinement-2026-10-10/index.html. Новые основные размеры — 1920×1080 и 3440×1440 при 100%; профиль 1920 сохранён компактным, от 2560 CSS px элементы увеличены. После изменения размеров верните браузер на 100% для оценки нового интерфейса.
