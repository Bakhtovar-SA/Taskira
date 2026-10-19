# B-03: эталоны середины движения

Статус 19.10.2026: все десять эталонов `e2e/__screenshots__/motion-*-mid-{light,dark}.png` лежат в репозитории.
Они получены из артефакта CI (`ui-visual`) в образе `mcr.microsoft.com/playwright:v1.56.1-noble` — тот же
образ, что требует `goldenEnvironment()`; это не Windows-снимки и не заглушки. Локально тесты и генерация PNG
не запускались (Docker нет). B-03 остаётся открытым до просмотра эталонов владельцем и зелёного сравнения в CI.
B-04 и ручной чек-лист B-02 этим файлом не закрываются.

## Область

`e2e/motion-stand.visual.pw.ts` — ровно пять сцен настоящего DEV-стенда A-08, по светлой и тёмной
теме, десять тестов:

| Сцена | Действие | Что попадает в кадр |
|---|---|---|
| board-flight | board-move | Полёт копии .flip-flight и сдвиг соседних карточек |
| list-ghost | list-remove | Призрак удалённой строки и сдвиг живых соседей |
| dialog-enter | enter-dialog | Примитив enter("dialog"), не нативное окно целиком |
| count-up | count-up | Три существующих CountUp с left/center/right |
| tab-indicator | tab-2 | Индикатор между первой и третьей вкладками |

Viewport 1280×900, deviceScaleFactor=1, русский язык, обе базовые темы, системное и личное
уменьшение движения выключены. Шрифты и ленивый движок загружаются до остановки времени.
Кадр ограничен стабильной областью сцены; страница перед этим прокручивается к ней.
Это midpoint-проверки, а не новый набор мобильных или product-page эталонов.

## Как фиксируется время

`e2e/motion-midpoint-helpers.ts` устанавливает Playwright clock **до навигации**. После готовности
стенда, шрифтов и начального движения JS-время останавливается. Это замораживает настоящий
страховочный setTimeout полёта; runtime timeout, длительности и публичный motion API не меняются.

Scoped перехват Element.animate сохраняет настоящие нативные Animation и обработчик Motion.
Только эффекты выбранной сцены сразу ставятся на паузу и получают currentTime =
`delay + activeDuration / 2`. Остальные эффекты не перематываются. После native ready тест
проверяет paused, тот же currentTime, connected target, pending native finished, отсутствие
finish/cancel и неизменность inline/computed transform/opacity до и после снимка.
Для полёта дополнительно проходит 1100 мс настоящего Node-времени: копия остаётся, а оригинал
скрыт, поскольку JS guard заморожен. Живой призрак также остаётся до возобновления,
что проверяет незавершённую цепочку exit/finished/удаление. После снимка анимации и JS-время
возобновляются, временные перехваты снимаются, проверяется отсутствие полётов/призраков/счёта.

CountUp не является WAAPI-анимацией. Только в его тесте очередь настоящих requestAnimationFrame
callbacks временно удерживается тестовым helper. Вызов на elapsed=0 устанавливает начало
(совместим и с реализацией, начинающей время на первом RAF), clock проходит COUNT_MS/2,
затем те же callbacks получают точную текущую метку. Промежуточные DOM-значения не записываются
тестом. При COUNT_MS=300 и 100→125 на 150 мс ease-out даёт округлённое **122**, при этом
textContent с самого начала равен **125**. До и после PNG очередь и ::after проверяются
на неизменность. В cleanup реальный счёт доводится до конца и RAF восстанавливается.

В DEV-кнопке «Пауза на 50 %» исправлена та же формула: endTime/2 не является серединой
активной части при ненулевом delay. Кнопка по-прежнему не обещает останавливать RAF-счётчик.

## Локальная проверка capture-only на D

Выполнять только после передачи общего тяжёлого слота. Этот режим **не** вызывает
toHaveScreenshot и не создаёт/обновляет golden. PNG пишутся только в указанный каталог
непосредственно внутри существующего D-drive TEMP; относительные пути, другой диск,
__screenshots__, выход через junction и режим CI отвергаются. JSON proof сохраняется рядом.
Без этой переменной Windows midpoint-тесты пропускаются с объяснением Linux-only.

```powershell
$env:TEMP = 'D:\CodexScratch\Taskira-Track-O-temp'
$env:TMP = $env:TEMP
$env:npm_config_cache = 'D:\CodexScratch\npm-cache'
$env:CHROMIUM_PATH = 'C:\Users\user\AppData\Local\ms-playwright\chromium-1194\chrome-win\chrome.exe'
$env:PLAYWRIGHT_PORT = '3566'
$env:MOTION_MIDPOINT_CAPTURE_DIR = Join-Path $env:TEMP 'motion-midpoints-capture'
npx playwright test e2e/motion-stand.visual.pw.ts --workers=1 --output "$env:TEMP\motion-midpoints-results"
```

PNG не прикрепляется повторно через testInfo.attach, чтобы Playwright не создал копию
в checkout/test-results вне TEMP. Все десять PNG и proof.json нужно просмотреть одним
батчем; при проблеме — один пакет исправлений и подтверждение. Локальные PNG нельзя
переносить в e2e/__screenshots__. Стабильный Windows capture не доказывает Linux goldens.

После слота также проверить изменённую DEV-паузу существующим тестом:

```powershell
Remove-Item Env:MOTION_MIDPOINT_CAPTURE_DIR
npx playwright test e2e/motion-stand.pw.ts -g "pause, slow" --workers=1 --output "$env:TEMP\motion-midpoints-pause-results"
```

Typecheck/build/bundle и guards выполняются отдельно под тем же последовательным слотом.
У DEV-модуля не должно появиться production-чанка. До выполнения этих команд результаты
не считаются проверенными.

## Linux actual → просмотр → эталоны → повтор

Используется существующий `.github/workflows/ui-visual.yml`, новый workflow не нужен:
`mcr.microsoft.com/playwright:v1.56.1-noble`, установленный из lock Playwright 1.56.1.
Обычный режим дополнительно сверяет driverVersion/dockerImageName из
`/ms-playwright/.docker-info` и запрещает подмену Chromium через CHROMIUM_PATH.

1. ROOT публикует ветку. Обычный `npm run test:ui` подхватит новый *.visual.pw.ts.
2. При отсутствующих baseline стандартный matcher создаёт *-actual.png в test-results и
   намеренно помечает тест ошибкой. Это ожидаемый первичный bootstrap, не зелёная регрессия.
   Default mode продолжает следующие тесты после ошибки, чтобы получить все десять кадров.
3. Существующий upload-artifact шага failure загружает `ui-visual-diff` с test-results.
   ROOT скачивает артефакт на D и проверяет имена, оба theme, proof pending/paused и содержимое PNG.
4. Только просмотренные Linux *-actual.png ROOT вносит под соответствующими именами
   `e2e/__screenshots__/motion-*-mid-{light,dark}.png`. Автоматического commit/push из job нет.
5. Повторный запуск сравнивает те же PNG: `animations: "allow"`,
   `maxDiffPixelRatio: 0.002`, caret hidden, scale css. Допуск не расширяется.
   Если полупрозрачный кадр нестабилен в закреплённом образе, сначала зафиксировать причину;
   fallback opacity 0/1 из Track O требует отдельного решения, молча не применяется.

Proof JSON показывает браузер, Node, закреплённый image, theme, crop и состояние до/после.
Если screenshot comparison завершился ошибкой, cleanup всё равно возобновляет реальные
анимации; ошибка baseline не должна скрыть отдельно обнаруженную ошибку lifecycle.

## Ограничения и архитектурное решение

Управление временем является только тестовым. Это не доказательство производительности,
поведения в настоящем фоне или чтения VoiceOver/NVDA. Оба режима reduce, фокус, AX-дерево
и axe в середине движения относятся к B-04 и проверяются отдельно.

Новый ADR для B-03 не требуется: runtime поведение не меняется, достаточно MOTION.md и
методики. Track O просит описывать необходимость ADR, **сам ADR здесь не создаётся**.
Если измерения B-01 потребуют мгновенного режима по объёму либо автоматической подсказки
reduce-motion, понадобится отдельное решение о поведении продукта и ADR с реальными
порогами/замерами; это не входит в midpoint-тесты.
