# Трек O — D-13: сводка фильтров доски

База ff9c8ff; codex/track-o-filter-pop. Автоматические проверки выполнены17.10.2026.

- BoardFilterSummary вызывает enter(button, pop) один раз за логическое появление; count/open/rerender и lazy fallback→real не повторяют вход.
- Отдельная кнопка объединяет локальный ref и callback/object ref Popover; React19 cleanup возвращается и вызывается.
- Соседние элементы не измеряются/не FLIP; уменьшение движения проверяет общая enter.
- Реальные actions e2e: mine, search count, открытие/закрытие Popover, selection, reset/reappear; desktop/mobile и reduce.
- motion-helpers.ts — точная копия актуального A06 e147646 для независимого CI. PNG только test-results.

- [x] BoardFilterSummary и board.characterize:22/22 unit PASS; typecheck PASS.
- [x] Chromium dev4/4 и production4/4, desktop/mobile, normal/reduce, реальные действия и точный top<1px. Существующая полная board geometry будет повторена после интеграции этой темы.
- [x] Build/budget и motion/colors/contrast/antilist/docs/permissions guards PASS. Desktop1460/mobile390 screenshots просмотрены: новая сводка не добавляет перекрытий.
- [x] Static detector: `[]`; syntax parse и git diff --check. Это не typecheck и не прогон тестов.

Gzip против ff9c8ff: total432479(+212), JS393945(+212), CSS38534(0), entry100056(+204), initial JS196355(+204) байт. Budget PASS. Первая mobile e2e подготовка открывала drawer клавишей[; заменена ожиданием штатной idle-загрузки Board. Проверяемые продуктовые действия и ожидания pop count не менялись.

Ручная браузерная матрица и QA владельца остаются открытыми. Публикация ожидает прямого разрешения владельца; main не меняется.
