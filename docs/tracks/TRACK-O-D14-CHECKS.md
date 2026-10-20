# Трек O — D-14: подтверждённые даты роудмапа

База ff9c8ff; codex/track-o-roadmap-flash. Автоматические проверки выполнены17.10.2026.

- Реальный путь: row menu → Сроки и вехи → DatePicker → PATCH roadmap → Open roadmap.
- Одна ephemeral запись в памяти модуля, без store/subscriptions/storage; user/project, точные ожидаемые даты, один таймерTTL30s.
- Begin нового save инвалидирует прежний успех/in-flight. No-op не отправляет PATCH и сбрасывает прежний marker. Ошибка не подтверждает marker; unmounted settings не подтверждают поздний ответ.
- Bootstrap/logout/401/project switch сбрасывают запись и поколение; поздние подтверждения не воскрешают marker.
- Первый успешный load после initial positioning потребляет запись, сравнивает обе даты и фактический viewport clip. Нет DOM/видимости/совпадения — запись выбрасывается.
- Scroll/zoom не создают и не воспроизводят marker. Reduce обрабатывает flash, запись всё равно потребляется.
- Timeline существующие transitions не меняются. Ни входа виртуализированных полос, ни cross-project highlights.

- [x] Marker unit:10/10 — ack/once, stale confirmation, TTL/timer, owner/project, changed values, virtualized/offscreen.
- [x] Typecheck PASS; marker + RoadmapView + store.bootstrap:3 файла /18 unit PASS. Отдельного ProjectRoadmap test suite в базе нет; реальный путь покрыт browser-сценариями.
- [x] Chromium dev3/3 и production3/3: real-action delayed PATCH, no-op/error/reduce, offscreen→scroll.
- [x] Build/budget и motion/colors/contrast/antilist/docs/permissions guards PASS; desktop1440 screenshot подтверждённых дат просмотрен, новых layout-изменений нет. Дополнительный production normal1/1 для снимка PASS.
- [x] Static detector: `[]`; syntax parse и git diff --check. Это не typecheck и не прогон тестов.

Gzip против ff9c8ff: total432730(+463), JS394196(+463), CSS38534(0), entry99832(-20), initial JS196414(+263) байт. Budget PASS.

Ручной Safari/Firefox/reader/VDI, мобильный QA владельца и общая проверка после интеграции остаются открытыми. Публикация ожидает прямого разрешения владельца.
