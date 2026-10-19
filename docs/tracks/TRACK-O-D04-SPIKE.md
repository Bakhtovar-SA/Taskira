# D-04 — календарь: технические gate спайка пройдены

Дата: 17.10.2026. База: ff9c8ff. Ветка: codex/track-o-calendar-spike. Проверено отдельно; публикации нет, интеграция следует после этих gate.

## Код

- Один стабильный calendar-grid: opacity 0.4→1, translateX ±12 px→none, 300 мс. Слайд — только при явной навигации периода (кнопки, PageUp/PageDown, «Сегодня», `t`) при том же month/week mode; стрелки через границу недели не слайдят.
- Первый показ, фильтры и переключение режима — без входа; режим снимает прежний slide. Unmount снимает анимацию.
- `focus`, `onDayKey` и их RAF не изменены. Native calendar draggable/onDrop/actions тоже прежние.
- Общая fixture извлечена из calendar.pw без изменения существующих tests и toBeFocused assertions.

## Приёмка: все пункты обязательны

- [x] Существующие 4 month/week keyboard/theme/lang сценария calendar.pw — каждый 20 повторов, все toBeFocused зелёные.
- [x] Новые normal/reduce focus: PageDown/PageUp month/week, ArrowRight через границу, today; каждый 20 повторов.
- [x] Focus-ring screenshot: ячейка и её стабильный предок получают одинаковое смещение, фокус остаётся на ячейке. Пауза 75 мс используется только для визуального кадра.
- [x] Настоящий pointer DnD из стабильного No due date в новый период: trusted dragstart/drop, настоящий MIME/id из приложения, elementFromPoint и drop target совпадают с днём; ровно один PATCH нужной даты.
- [x] В normal DnD drop попал в RUNNING slide с duration 300 мс и currentTime от 0 до <300 мс. Здесь нет pause, растяжения duration, retries и ручного drag-dispatch.
- [x] Baseline reduce DnD проходит без slide.
- [x] Units slide/reduce/cancel, typecheck, build/CSP production, guards/budget.
- [x] Static detector: `[]`; syntax parse 7 файлов и git diff --check. Исходники RAF/keyboard и прежние calendar assertions идентичны базе.
- [x] Bounded visual review.

Если любой критерий не проходит — spike отклонить, не интегрировать, не ослаблять assertions/тайминги и не обновлять golden screenshots.
Результат 17.10:

- 4 файла, 35 unit — PASS; typecheck, build, guards и budget — PASS.
- Production, native DnD: 2/2 PASS.
- Фокусные сценарии: все 4 исходных и 2 новых, по 20 повторов — 120/120 PASS за 9,6 мин.
- Focus-ring: 1/1 PASS. Desktop screenshot просмотрен: рамка движется вместе с ячейкой, не отдельно.
- Пороги, RAF-фокус, исходные toBeFocused и окно 300 мс не изменены.

## Запуски после разрешённого последовательного слота

```powershell
npx vitest run src/motion.test.ts src/calendarLayout.test.ts --maxWorkers=1
npm run typecheck
npx playwright test e2e/calendar.pw.ts --grep 'calendar month/week, keyboard' --repeat-each=20 --workers=1
npx playwright test e2e/calendar-slide-spike.pw.ts --grep 'focus remains correct' --repeat-each=20 --workers=1
npx playwright test e2e/calendar-slide-spike.pw.ts --grep 'focus ring|pointer DnD' --workers=1
npm run build
npx playwright test --config playwright.production.config.ts e2e/calendar-slide-spike.pw.ts --workers=1
```

## Ограничения native DnD

Тест использует browser mouse input и настоящие HTML draggable handlers; проверяет isTrusted, dataTransfer и ответ API.
Playwright Chromium может обслуживать эту последовательность через CDP drag interception внутри своего драйвера; это
проверка браузерного HTML DnD, а не доказательство аппаратного OS drag-and-drop или переноса между приложениями.
`locator.dragTo` здесь не подходит для приёмки 300 мс: actionability/stability может дождаться завершения transform.
Ручной DOM dispatchDrag/созданный тестом DataTransfer не доказывает hit-testing и запрещён в этом критерии.
Переход начинается обычным кликом toolbar, затем мышь переносит живую плашку без ожидания стабильности движущейся сетки.
Если host/driver тратит больше 300 мс, тест не доказал требуемое окно: gate остаётся провален, окно не продлевается.
Safari/Firefox, Windows DnD под VDI/RDP и touch требуют отдельной ручной проверки; автоматический Chromium не даёт за них результат.

Gzip против ff9c8ff: total 432419 (+152), JS 393885 (+152), CSS 38534 (0), entry 99863 (+11), initial JS 196195 (+44) байт. Budget PASS.

Ручной Safari/Firefox/VDI/RDP/touch остаётся открытым; автоматический Chromium не заменяет эту матрицу. В fixture нет WS-сервера, поэтому console websocket handshake 200 ожидаем и не является проверкой realtime. Предусмотренный API 403 в старых тестах проверяет отказ операции.

18.10: Linux CI выявил гонку старого 300-issue performance drag после возврата периода (131 прочий сценарий PASS). Перед его settled drag добавлен A06 settle, исходные PATCH/assertions сохранены. Независимый production повтор light/dark по 10 раз: 20/20 PASS. Это не замена и не ослабление native-running-slide gate: его 300 мс и trusted pointer проверки остаются прежними.

## Production-конфиг

`e2e/calendar.pw.ts` (вместе с `calendar-slide-spike.pw.ts`) теперь входит в `testMatch` `playwright.production.config.ts` — это новая поверхность production CI. Утверждения в тестах не ослаблены; добавлена только общая fixture и пауза settle перед settled-drag (A06).
