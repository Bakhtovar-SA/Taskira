# Трек O — C-07/D-01/D-11: ограниченное движение «Входящих»

Дата: 15.10.2026. База: ff9c8ff. Ветка: codex/track-o-inbox.

Реализовано и проверено:

- MOTION_CAPS: flip=40, ghosts=6, enter=8, track=200; значения используются доской, дашбордом и обоими трекерами строк.
- Превышение tracking очищает геометрию/историю входа; меньший список начинает с новой базовой линии.
- RowMotion ограничивает FLIP видимыми строками и scroll-clip, общий набор активных призраков ≤ 6 между commit.
- Baseline, превышение порога, reduce и dispose снимают прежние controls/ghosts; компоненты вызывают dispose при unmount.
- Призраки сохраняют визуальные shell-классы, но лишены live-row классов, role и data-идентификаторов, остаются aria-hidden/inert.
- Inbox запускает уход/сдвиг до EnterTracker; host остаётся при empty. Focus — на соседнюю живую строку, затем активный фильтр.
- Один CountUp непрочитанных: рост по данным, без движения при first/filter/decrease.
- Общий e2e/motion-helpers.ts идентичен актуальному A-06 helper из PR #198 для независимого draft CI.

## Последовательные проверки

- [x] Vitest: listExit, listEnter, InboxView, boardFlip, gridFlip, CountUp, board.characterize, EnterScope — 89/89 (62,11 с, maxWorkers=1).
- [x] typecheck; motion/colors/contrast/antilist/docs guards. После type-only исправлений отдельно motion/listEnter/listExit — 49/49 (43,60 с, maxWorkers=1), включая прежний custom cap=3.
- [x] Два Inbox Chromium e2e (2/2, 35,6 с, workers=1): удержанный API read, ровно один outgoing row, inert ghost, next-row focus, read-all empty focus; motion и reduce.
- [x] Тот же e2e на production+CSP — 2/2 (18,2 с, workers=1); testMatch дополнен inbox-motion.pw.ts.
- [x] Build и bundle проходят. Рост gzip относительно бюджетной базы: total 225,65→227,16; JS 201,41→202,86; CSS 24,24→24,30; entry 18,38→18,41 КиБ. До — ранее измеренный ff9c8ff/197281d; после — эта сборка. Текущий абсолютный размер: total 423,65; JS 385,96; CSS 37,69; entry 97,55 КиБ. Запас старого JS-бюджета ≈ 0,14 КиБ.
- [x] Desktop1440/mobile390 screenshots просмотрены одним раундом, только test-results, без обновления golden/docs PNG. Motion не меняет итоговую раскладку. На mobile замечено прежнее наложение metadata на текст (layout-классы идентичны HEAD); это отдельный интерфейсный дефект, за пределами motion diff.
- [x] Impeccable static detector: `[]`; git diff --check проходит.

Все тяжёлые проверки выполнены последовательно после освобождения общего слота Track O. Полный клиентский Vitest после интеграции остаётся отдельной проверкой. Helper идентичен e147646 из PR #198 (SHA256 38192603010E57E6839BA2FFB8F3626A70D96ADBA17F8D83E1A6A6078105F4A4).

Выполненные команды (D-only TEMP/cache; Chrome 1194, workers=1):

```powershell
npx vitest run src/listExit.test.ts src/listEnter.test.ts src/components/InboxView.test.tsx src/boardFlip.test.ts src/dashboards/gridFlip.test.ts src/CountUp.test.tsx src/board.characterize.test.tsx src/EnterScope.test.tsx --maxWorkers=1
npx vitest run src/motion.test.ts src/listEnter.test.ts src/listExit.test.ts --maxWorkers=1
npm run typecheck
npx playwright test e2e/inbox-motion.pw.ts --workers=1
npm run build
npx playwright test --config playwright.production.config.ts e2e/inbox-motion.pw.ts --workers=1
npm run bundle:check
```
