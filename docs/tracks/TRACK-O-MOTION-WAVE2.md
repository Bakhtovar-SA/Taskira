# Трек O — движение, вторая волна: стабильность, проверки, производительность, новые возможности

**Дата:** 2026-10-14. **База:** `main` на `197281d` (после PR #185–#191). **Исполнитель:** Sol (GPT).
**Источник:** чтение кода `main`, прогоны в контейнере разработки (Linux, 4 vCPU Xeon 2.1 ГГц, Chromium 141 из
`@playwright/test` 1.56.1, программная отрисовка SwiftShader) и данные GitHub Actions (`tests`, `ui visual`) за 12–14.10.2026.
Документ самодостаточен. Трек N (`docs/tracks/TRACK-N-MOTION-NEXT.md`) — предыдущий. Из него сюда перенесены только
незакрытые пункты, со ссылкой вида «N:FIX-05». Повторно их здесь не расписываем.

## 0. Как читать

**Метки доказательств** (у каждого утверждения):

- **[код]** — подтверждено чтением кода, указан `файл:строка` на `197281d`;
- **[запуск]** — подтверждено командой, тестом или данными CI; команда и результат указаны рядом или в приложении;
- **[гипотеза]** — правдоподобно, но не доказано; рядом сказано, как проверить.

**Идентификаторы:** `A-` — исправления и инфраструктура, `B-` — проверки, `C-` — улучшения существующего, `D-` — новые
возможности, `E-` — «не делать». Пункты трека N — `N:FIX-…`, `N:IMP-…`, `N:NEW-…`.

**Приоритеты:**

- **P0** — ломает CI, функцию или доступность; делать первым;
- **P1** — заметный дефект, риск для VDI или недостающая проверка;
- **P2** — полировка.

**Бюджет** — оценка gzip в КиБ для `scripts/bundle-budget.json`. Оценки помечены [гипотеза — оценка]. Ориентир для
калибровки — чанки, которые уже есть [запуск: `npm run build && npm run bundle:check`]:

| чанк | размер gzip |
|---|---|
| `listEnter` | 0.22 КиБ |
| `CountUp` | 0.41 КиБ |
| `EnterScope` | 0.50 КиБ |
| `Flash` | 0.26 КиБ |
| `motionEngine` | 4.68 КиБ |

### Состояние `main` на `197281d` [запуск]

После `npm ci`:

- `npm run typecheck` — ок;
- `npx vitest run` — 115 файлов, 970 тестов, все зелёные;
- `npm run motion:check` — ок (1095 правил CSS, 27 keyframes);
- `npm run colors:check` — ок;
- `npm run docs:check` — ок;
- `npm run build && npm run bundle:check` — ок, цифры ниже.

| метрика | рост от базы | допуск | запас |
|---|---|---|---|
| JS + CSS (`total`) | +225.65 КиБ | +228 | **2.35 КиБ** |
| JS, все чанки | +201.41 КиБ | +203 | **1.59 КиБ** |
| CSS | +24.24 КиБ | +26 | 1.76 КиБ |
| вход (`index.js`, 97.51 КиБ) | +18.38 КиБ | +40 | 21.62 КиБ |

В постановке было «+224.98, запас < 3.1». На `197281d` (после #189/#190) рост уже +225.65. Любое число в этом треке
пересчитывать от свежего `main`.

---

## 1. Что уже есть — не делать заново

| Что | Где | Состояние |
|---|---|---|
| Обёртка движения | `src/motion.ts` | `flipFrom`, `enter` (`rise`/`dialog`/`panel`/`toast`/`pop`), `exit`, `countTo`, `flash`, `glideWidth`, `glideTo`, `viewTransition`, `stopMotion`, `preloadMotion(Idle)`, `motionReduced`/`setReducedMotion`/`userReducedMotion`. Пресеты `SPRING` (500 мс успокоения), `SPRING_ENTER` (350), `SPRING_POP` (450), `EXIT` (0.2 с) [запуск: `spring.applyToOptions`, см. А.3] |
| Снятие inline-кадра | `motion.ts:113-138` (`track(el, c, clear)`) | N:FIX-01 закрыт (PR #187) |
| Личный выключатель | `motion.ts:22-60`, правило `html[data-motion="reduce"]` в `index.css:1108`, `public/theme-init.js` | N:FIX-02 закрыт |
| Ленивый чанк | `src/motionEngine.ts` (`motion/mini` `animate` + `spring`) | импорт `motion` только здесь [запуск: `grep -rn 'from "motion' src` → только `motionEngine.ts:4-5`] |
| Доска | `src/boardFlip.ts` | снимок → FLIP (`playBoardFlip`, `Board.tsx:346`), перелёт копии (`fly`), волна массовой смены (`WAVE_STEP_MS = 45`, `WAVE_TOTAL_MS = 220`), `MAX_ANIMATED = 40`, `TTL_MS = 3000`, `RENEW_AHEAD_MS = 7000`, возврат фокуса (`restoreCardFocus`), «перенос отправлен» (`markPending`, `PENDING_DELAY_MS = 150`, `index.css:374`) |
| Списки | `src/listEnter.ts` (`LIST_ENTER_CAP = 8`), `src/listExit.ts` (`MAX_TRACKED = 200`, `MAX_GHOSTS = 6`) | вход — список задач и «Входящие» (`InboxView.tsx:66`); уход — только список задач (`Backlog.tsx:507`) |
| Дашборд | `src/dashboards/gridFlip.ts` (`MAX_TRACKED = 40`) | FLIP соседей в режиме правки (NEW-05) |
| Счётчики | `src/CountUp.tsx`, `countTo` (`motion.ts:233-255`), CSS `index.css:189-208` | «Главная» (`HomeView.tsx:93`) и виджет count; не в «Отчётах» (COV-01) |
| Карточка задачи | `EnterScope.tsx`; `IssueModal.tsx:260` (чек-лист), `:1067` (лента); `Flash` `:696`, `:742` | подзадачи и связи — без входа (N:NEW-03 открыт) |
| Пульс счётчиков | `usePulse.ts`; `Sidebar.tsx:164-165`, `Topbar.tsx:379`, `Board.tsx:480` | есть |
| Окна, тосты, вкладки, сайдбар | `ds/Dialog.tsx:56`, `ui.tsx:72-115`, `ds/Tabs.tsx:28-65`, `Sidebar.tsx:191` | есть |
| Прогресс | `.ds-progress > span { transition: width var(--dur-4) }` (`ds/ds.css:953-960`), `.timeline-bar-fill` (`index.css` ≈ 950) | плавное изменение уже есть, делать не нужно |
| Полосы таймлайна | `.timeline-bar` — transition `transform` и `width` (`index.css:926-929`) | есть; reduce — `index.css:1011-1012` и личный выключатель [код] |
| Тема | `theme.ts:133-155` — круг через View Transitions, `root.animate(..., { duration: 420 })` | единственный «сырой» `el.animate` вне `motion.ts` [запуск: `grep -rn '\.animate(' src`] |
| Проверки | `scripts/check-motion.mjs` (только CSS + классы Tailwind + `duration: N` ≤ 450), `scripts/check-bundle-size.mjs`, `scripts/perf-board/run.mjs` (сломан, см. A-05), `scripts/motion-spike/` | — |
| e2e движения | `e2e/motion-cleanup.pw.ts`, `e2e/count-up.pw.ts`, `e2e/dashboard-flip.pw.ts` | ожидание конца анимаций каждый пишет сам (`motion-cleanup.pw.ts:8`) |
| Документы | `docs/design/MOTION.md` (живой), ADR-0035 (не править) | — |

**Из трека N ещё открыто [код]:**

| пункт | что открыто | где видно |
|---|---|---|
| N:FIX-05 | у ухода строк нет потолка видимых | `listExit.ts:77-82` |
| N:FIX-06 | чтения и записи в FLIP чередуются | `boardFlip.ts:116-147` |
| N:FIX-07 | замер ширины сайдбара не делался | — |
| N:FIX-08 | у перелёта нет вспышки | `fly()` без подсветки в `land()` |
| N:FIX-10 | гонка `vt-nav` | `motion.ts:158-161` |
| N:FIX-11 | зависимости индикатора вкладок | `ds/Tabs.tsx:65` — `[selected, variant]` |
| N:FIX-13 | `hintIn` до `max-height: 48px` | `index.css:513-526` |
| N:FIX-14 | ручной `requestIdleCallback` в доске | `Board.tsx:645-650` |
| N:FIX-14 | `ENTER_FRAMES.toast` не используется | `motion.ts:205` |
| N:FIX-14 | комментарий «--dur-2, 200 мс» | `ds/Presence.tsx:4` |
| N:IMP-01, -02, -06, -07 | не сделаны | — |

Здесь они распределены по блокам A и C.

---

## 2. Волны, границы PR и правила

### 2.1 Волны

| Волна | Состав | Параллельно | Нужно решение владельца | Готово, когда |
|---|---|---|---|---|
| **W0 — бюджет** | §8: новый потолок (только `bundle-budget.json` + `PERF-BUDGET.md` + строка в `MOTION.md`) | — | **да**: число из §8 | `bundle:check` зелёный с новым запасом; запись датой в обоих файлах |
| **W1 — CI и тесты** | A-01 (роудмап), A-02 (доска — закрытие), A-03 (пути в CI), A-04 (`motion:check` для JS), A-05 (`perf-board`), A-06 (помощники e2e) | всё независимо; A-03 — отдельный PR | A-03: какие проверки обязательны | `ui-visual` и `tests` зелёные 3 прогона подряд; 0 падений A-01 в 50 прогонах (B-01 в приложении Б) |
| **W2 — инструменты и замеры** | A-07 (карта анимаций), A-08 (`/dev/motion`), B-01 (производительность), B-03 (снимки середины), B-04 (a11y), B-05 (утечки), B-06 (скрытая вкладка, reduce на лету) | A-07 ‖ A-08 ‖ B-01 | B-01: пороги | пороги записаны в `docs/PERFORMANCE.md`; стенд открывается в dev и не попадает в сборку |
| **W3 — улучшения** | C-01…C-12 (в т. ч. N:FIX-05/06/07/08/10/11/13/14) | по одному PR на пункт | C-03 (вид сайдбара), C-08 (где `CountUp`) | CHK-список §2.3; строка в `MOTION.md` |
| **W4 — новое** | D-01…D-17 по итоговой таблице блока D (§6) | по одному PR | D-05, D-07, D-08 — продуктовые | то же + ручной чек-лист затронутых экранов (приложение В) |
| **Владелец, параллельно** | B-02 ручной прогон | — | — | `docs/MANUAL-CHECK-TRACK-O.md` заполнен |

Порядок жёсткий только в двух местах:

- W0 идёт **первым PR**, до любой фичи;
- A-06 (помощники e2e) — до новых e2e в W3/W4.

Остальное можно вести параллельно.

### 2.2 Границы PR

Один PR — одна тема: один ID или тесно связанная пара (например, A-04 + мутационный самотест скрипта). Нельзя смешивать:

- поднятие бюджета и фичу;
- правку CI (`.github/`) и продуктовый код;
- новую зависимость и что-то ещё (новая зависимость — только с ADR).

### 2.3 Проверки до push (каждый PR)

```bash
npm ci                       # после каждого pull/merge
npm run typecheck
npx vitest run               # все; новые тесты — рядом с кодом
npm run motion:check
npm run colors:check
npm run contrast:check
npm run antilist:check
npm run docs:check
npm run build && npm run bundle:check     # записать в PR рост total/js/css/entry «до → после»
# затронутые e2e в настоящем Chromium (порт — любой свободный):
CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome PLAYWRIGHT_PORT=3517 npx playwright test e2e/<файл>.pw.ts
git status --short           # снимки в docs/ не должны появиться; если появились — git checkout docs/design
```

Только после этого — `push`. Если PR меняет `src/`, CI запустит `ui visual` (`npm run test:ui` +
`npm run test:ui:production`). Если меняет `server/`, `shared/`, `scripts/` или `.github/` — полный `tests` (A-03).

### 2.4 Правила для исполнителя

1. Ветка — от свежего `origin/main`. PR — **черновик** в `main`. Описание — по-русски, коротко:
   - что сделано;
   - ID пунктов;
   - команды и результаты;
   - бюджет «до → после».
2. **Не сливать** без явной команды владельца. Auto-merge не включать.
3. Замечания ревью: ответ в одну-две строки (что исправлено, коммит) и исправление. Обсуждения молча не закрывать.
4. Падение CI:
   1. прочитать лог упавшей джобы (`gh run view --log-failed` или артефакт `ui-visual-diff`);
   2. если это известная нестабильность, сделать **один** перезапуск;
   3. оставить в PR комментарий: что упало, почему, ссылка на прогон.

   Повторное падение — дефект, а не «невезение».
5. `Update branch` — только при конфликте с `main`. После merge `main` — `npm ci` и проверки §2.3 заново.
6. Не писать PNG в `docs/`. Снимки — в `test.info().outputPath()` или `test-results/`. `UPDATE_DOC_SCREENSHOTS=1` — только по
   просьбе владельца (`e2e/roadmap-connections.pw.ts:6`).
7. CSP:
   - без `style=""` и `setAttribute("style")`;
   - без вставки `<style>`;
   - динамика — только CSSOM/WAAPI (ADR-0010);
   - непрерывные значения — через `cssVars` и статическое правило.
8. Без сырых цветов (`colors:check`). Кадры WAAPI — через `var(--…)` и `color-mix`.
9. Без новых зависимостей, если нет нового ADR. `motion` импортируется только в `src/motionEngine.ts`.
10. Всё движение — через функции `src/motion.ts`. Каждая проверяет `motionReduced()` (системная настройка или личный
    выключатель). Для групп элементов нужен потолок. Двигать можно только transform/opacity (и цвет фона для подсветки).
    Вход экранов — только прозрачность.
11. Строки интерфейса — ключи в `src/i18n/ru.ts` и `en.ts` (страж `cyrillicGuard.test.ts`). В UI «команда», не «отдел».
12. `docs/design/MOTION.md` обновлять **в каждом PR**, который меняет движение: строка в «Где применено» или «Сознательно
    не анимируется» и строка в журнале с датой и номером PR. ADR не править (`docs/adr/README.md`).
13. Сгенерированные файлы руками не трогать: `docs/PERMISSIONS.md`, `docs/MIGRATION-LIST.md`, `docs/API-SCHEMAS.md`,
    `*permissions.matrix.ts`.

---

## 3. Блок A — исправления и инфраструктура

### A-01 · P0 · `roadmap-connections` на 1280 px: ручка связи исчезает после `hover()`

**Симптом [запуск: лог CI, прогон 38549650841]:** `roadmap-connections.pw.ts:15` (сейчас строка 18) падает по таймауту
30 с. Падает `locator.boundingBox` на `.roadmap-connect` **после** успешного `hover()`, лог: «waiting for locator(…
.roadmap-connect)». Элемента в DOM нет: hover прошёл, затем ручка размонтировалась.

**Корень [код + запуск]:**

1. Ручка рисуется, только если полоса проекта в горизонтальном окне (`RoadmapView.tsx:179`, `:186`):
   `before = x(span.from) + width < viewport.x + 16`, `after = x(span.from) > viewport.x + viewport.w - 16`. При
   `before || after` вместо ручки рисуется `.roadmap-return`. Сама ручка стоит на правом конце полосы
   (`--connect-x`, `RoadmapView.tsx:187`).
2. Playwright при неудачной попытке действия (элемент «не стабилен» или «точку перехватывает другой элемент»)
   повторяет её с принудительной прокруткой. Варианты идут по кругу: `undefined → {block,inline: "end"} → "center" →
   "start"` [код: `node_modules/playwright-core/lib/coreBundle.js:20199-20210`]. На четвёртой попытке
   `scrollIntoView({inline: "start"})` ставит ручку к левому краю окна. Правый конец полосы оказывается левее
   `viewport.x + 16`, срабатывает `before`, и React заменяет ручку на `.roadmap-return`. Hover уже отправил событие
   мыши до перерисовки, поэтому сам `hover()` успешен, а следующий `boundingBox` ждёт исчезнувший элемент. Порядок
   «событие мыши раньше перерисовки» — **[гипотеза]**, но итог воспроизведён (п. 3).
3. Подтверждение механизма [запуск: `e2e-scratch` из приложения Б, 1280×1080]:
   - `scrollIntoView` ручки с `inline: "start"` → ручки нет, есть `.roadmap-return`, `scrollLeft = 310`;
   - с `nearest`, `center`, `end` ручка на месте;
   - если на 400–900 мс накрыть ручку помехой (Playwright уходит в повторы), то в 4 из 4 прогонов `boundingBox` теряет
     элемент, `scrollLeft = 310`; `hover()` при этом успешен в 3 из 4 — ровно как в CI;
   - помеха на 150 мс (один повтор) — 2 из 2 ок.
4. Что вызывало первые повторы в CI. Оба упавших прогона (`roadmap`, `board-layout`) шли на коммитах **без** N:FIX-09:
   `7bc40d28` и `1d8db5fc` [запуск: `git merge-base --is-ancestor 5566cfe <sha>` → нет]. У них обёртка экрана ещё была
   `anim-fadeup` — `translateY(4px) → 0` под нагрузкой (`App.tsx:317` до PR #187). Ручка двигалась вместе с обёрткой, и
   проверка «стабилен» в Playwright не проходила. **[гипотеза]:** это и было источником повторов. Проверка — критерий
   закрытия в приложении Б: 50 прогонов на эталонном образе.

**Статистика CI [запуск: GitHub API, `ui visual`, 100 последних прогонов, 12–14.10.2026]:**

| прогоны | всего | неуспешных |
|---|---|---|
| с N:FIX-09 (PR #187, `5566cfe`) | 24 | **0** |
| без N:FIX-09, с 06:00 14.10 | 8 | 2 (оба — эти тесты) |

Локально на `197281d` [запуск]: `board-layout "selection preserves"` × 4 и `roadmap "pointer preview"` × 3, по 15
повторов, `--workers=4` — **105 из 105**.

**Что сделать (тест):**

- в `e2e/roadmap-connections.pw.ts:22-26`, после возможного клика по `.roadmap-return`, ждать конца плавной прокрутки
  (`returnToProject` прокручивает `behavior: "smooth"`, `RoadmapView.tsx:95`): `await settleScroll(pane)` из A-06;
- `hover()` вызывать с `{ position }` от `boundingBox()`, снятого после `settleScroll`;
- затем проверять, что ручка всё ещё в DOM (`toHaveCount(1)`), до `boundingBox`.

**Что сделать (продукт, P1):** гистерезис для ручки. Сейчас ручка пропадает, когда её **видно** (у левого края). Это
мешает и человеку: прокрутил так, что конец полосы у левого края, — вместо ручки появляется «вернуться». Условие
`before` сравнивать с концом ручки, а не полосы: `x(span.from) + width + 28 < viewport.x` (28 — ширина ручки,
`styles/roadmap.css:76`). Проверить, что `.roadmap-return` не перекрывает ручку в зазоре
(`--return-x = viewport.x + 12`). Если перекрывает — сдвинуть «вернуться» правее ручки или прятать ручку только под
кнопкой.

**Проверка:**

- юнит не нужен;
- новый e2e в том же файле: прокрутить так, чтобы ручка стояла у левого края (`scrollIntoView({inline:"start"})`) →
  ручка остаётся;
- приложение Б (помеха 900 мс) → `boundingBox` ок.

Критерий закрытия — 0 падений в 50 прогонах файла на образе `mcr.microsoft.com/playwright:v1.56.1-noble`.

**Риск:** низкий. Поменяются снимки `dependency-*` в `test-results/` (в `docs/` не пишутся). **Бюджет:** 0 (тест), < 0.01
КиБ (условие).

### A-02 · P1 · `board-layout.pw.ts:74` — закрыть как исправленное N:FIX-09 и предотвратить возврат

**Факты [запуск: лог CI, прогон 38547730601, задача 115797834251]:**

- `selection preserves short and empty column backgrounds (light, 1460)`, `column 0: y`;
- ожидалось 175.4310302734375 (первый замер, «до»), получено 175.375 (после), разница 0.0560 при допуске 0.005;
- 175.375 = 11224/64 — значение раскладки Blink (кратно 1/64 px); 175.4310… не кратно 1/64. Значит, первый замер снят
  под дробным transform предка. CSS zoom на 1460 у колонки нет [запуск: `currentCSSZoom = 1`, в цепочке предков zoom ≠ 1
  нет].

**Корень [запуск: данные CI] + [гипотеза: локально не воспроизведён]:** коммит прогона `1d8db5fc` — без N:FIX-09. Обёртка экрана там — `anim-fadeup`
(`translateY(4px) → 0`, `fill: both`), см. `git show 1d8db5fc:src/App.tsx` строка 317. Хвост ease-out даёт доли пикселя.
Трек N видел то же со значением 0.0093. Попытка воспроизвести локально с временно возвращённым
`anim-fadeup` (`--repeat-each=40 --workers=12`, 160 прогонов) — 0 геометрических падений, 1 таймаут `toBeVisible` от
перегрузки [запуск]. Значит, в контейнере окно между `toBeVisible` и первым замером короче хвоста анимации; в CI под
нагрузкой — длиннее.

**Отвергнутые гипотезы** (для честности; все проверены зондами в `e2e-scratch-o/`, удалены):

| гипотеза | эксперимент | результат |
|---|---|---|
| подмена шрифта (`font-display: swap`) | задержка `*.woff2` на 1.5 с | y до и после загрузки шрифтов — 175.375 |
| заглушка «…» счётчика просроченных (`WorkspaceControls.tsx:23`) | `/issues/counts` держится до замера | высота кнопки 32, y 175.375 до и после |
| поздние ленивые модули и CSS | задержка `Overlay.tsx`, `LazyTooltip.tsx`, `IssueAutomationControls.tsx`, `issue-automation.css` (приходит после первой карточки: 1193 мс против 1168 мс), `motionEngine` на 2.5 с | y не меняется |
| анимации от первого кадра | покадровая запись y и всех `getAnimations()` от первого кадра при CPU 1× и 6× | y колонки не меняется ни разу; запускаются `viewIn` (прозрачность), `skeletonLate`, `dsShimmer`, `splashOut` — без влияния на y |
| нагрузка | 160 прогонов (`--repeat-each=40`, `--workers=10`) зонда «y при первой карточке vs через 800 мс» на `197281d` | 0 расхождений |

**Что сделать (предотвратить возврат):**

- (а) правило в A-04: обёртки экранов и их предки не анимируют transform. В CSS — запрет `transform` в keyframes у
  классов `anim-view`, `anim-stagger`, `.ds-empty`; в TS — запрет `anim-fadeup` в `App.tsx`;
- (б) геометрические e2e снимают «до» после `settle(page)` (A-06), а не сразу после `toBeVisible`;
- (в) снять с `anim-fadeup` два оставшихся «больших» применения — `QuickCreateIssue.tsx:31`, `TimelineView.tsx:275`. Это
  формы и панели, не обёртки экрана. Они двигают своё содержимое, но не соседей. **[гипотеза]:** e2e их не меряют — проверить
  `grep -n "quick-create\|timeline" e2e/*.pw.ts` перед правкой.

**Проверка:** 50 прогонов (приложение Б) на эталонном образе — 0 падений. **Бюджет:** 0.

### A-03 · P1 · CI: `tests` целиком на каждый PR — разнести по путям, сохранив стабильные имена проверок

**Факты [запуск: GitHub API, прогон 38556464101 — PR #191, изменены только `docs/design/MOTION.md` и `CLAUDE.md`]:**

- 20 джоб, **44.6 минут раннера** в сумме, ≈ 16 минут от старта до конца;
- что заняло время:

| джоба | минут |
|---|---|
| `server (postgres 14…17)` | 5.0 + 5.6 + 5.6 + 6.8 = 23 |
| `offline upgrade and rollback` | 5.0 |
| `rootless Podman` | 3.8 |
| `backup, destroy volumes, and restore` | 3.3 |
| `upgrade from snapshot` × 3 | 2.3 |
| `client` | 1.8 |
| `storage-s3` | 1.7 |
| `security` | 1.2 |
| `ldap`, `mail` | по 0.6 |
| остальные | < 1 |

**Дефект в существующем отборе путей [код + запуск]:** джоба `upgrade-procedure` уже умеет пропускать тяжёлый шаг, если
не менялись нужные пути (`test.yml:204-235`). На PR #191 она всё равно шла 5 минут. Причина:

- `git diff "$BASE_SHA"...HEAD`, где `BASE_SHA = github.event.pull_request.base.sha` = `edfd443` (база на момент
  события);
- `HEAD` — это `refs/pull/N/merge`, слияние с **текущим** `main`. За это время в `main` влили #189/#190;
- `git diff --name-only edfd443 1d7e7e8` даёт `src/CountUp.tsx`, `src/components/HomeView.tsx`, `e2e/…`, хотя PR их
  не трогал.

Исправление — сравнивать с первым родителем слияния: `git diff --name-only HEAD^1 HEAD` (на `refs/pull/N/merge`
`HEAD^1` — база, с которой реально слито).

**Защиты веток нет [код: `docs/tickets/CI-01-no-required-checks.md`, `UI-02-required-typecheck-check.md`]:** на текущем
тарифе обязательных проверок нет вообще. Значит, отсутствие проверки ничего не блокирует. Схема ниже всё равно
**сохраняет стабильные имена** — на будущее, когда CI-01 решат.

**Что сделать:**

1. **Не** использовать `paths-ignore` на уровне workflow. Если workflow не запущен, проверки висят «ожидается», и
   будущая required-проверка никогда не станет зелёной. Нужен отбор по путям **внутри** workflow.
2. Новая лёгкая джоба `changes` (без сторонних actions — `dorny/paths-filter` была бы новой зависимостью цепочки
   поставки):
   - шаги: `checkout` с `fetch-depth: 2` и `git diff --name-only HEAD^1 HEAD`;
   - на `push` в `main` все флаги = `true`;
   - выходы: `server`, `client`, `ops`, `docs_only`.
3. Тяжёлые джобы получают `needs: changes` и `if: needs.changes.outputs.<x> == 'true'`. Для матриц —
   итоговая джоба со стабильным именем по образцу `server-summary` (`test.yml:395-409`): `if: always()`, проходит при
   `success` **или** `skipped`.
4. Сопоставление путей (предложение; проверить чтением, что именно запускает каждая джоба):

| флаг | пути | джобы |
|---|---|---|
| `server` | `server/**`, `shared/**`, `src/permissions*.ts`, `src/validation.ts` (их читает `server/test/permissions-sync.test.ts`), `fixtures/**`, `.github/workflows/test.yml`, `.github/actions/**` | `server ×4`, `ldap`, `storage-s3`, `mail`, `upgrade-from-snapshot` |
| `ops` | `Dockerfile*`, `**/Dockerfile*`, `docker-compose*.yml`, `compose*.yml`, `deploy/**`, `scripts/*.sh`, `nginx.conf`, `server/migrations/**`, `package*.json`, `server/package*.json`, `.github/**` | `backup-restore`, `podman-rootless`, `upgrade-procedure` (её шаг уже отбирает сам — заменить его `BASE_SHA` на `HEAD^1`) |
| `client` | `src/**`, `public/**`, `index.html`, `vite.config.*`, `tsconfig*.json`, `scripts/**`, `e2e/**`, `package*.json`, `server/src/contract.ts` (клиентские типы из него) | `client` |
| всегда | — | `security` (сканирует образы и `npm audit`; дешёвая), `secrets-scan`, `migration-policy`, `types` (включает `docs:check` и `permissions:check`), `snapshot-list` |

5. Документ-PR (`docs/**`, `*.md` вне `src/`) — только «всегда»-джобы.

**Оценка экономии [гипотеза — оценка по прогону 38556464101]:**

| тип PR | сейчас, мин раннера | после, мин раннера | экономия |
|---|---|---|---|
| только документы | 44.6 | ≈ 2.2 (`security` 1.2, `types` 0.8, `secrets-scan` 0.1, `migration-policy` 0.1, `snapshot-list` 0.1) | ≈ 95 % |
| только клиент (`src/**`) | 44.6 | ≈ 9–10 (`client`, `security`, `types` и т. п., `upgrade-procedure` 5.0) | ≈ 75–80 %. `ui visual` идёт отдельно, ≈ 9–11 мин, как сейчас |

**Риски:**

- (1) пропустить связь, которую таблица не знает. Пример — `permissions-sync` читает `src/`; `apiErrors.test.ts` клиента
  сканирует `server/src`, и это в `client` тоже нужно добавить (`server/src/**` → `client`);
- (2) ночной прогон `main` закрывает остальное: на `push` в `main` и в `upgrade-nightly.yml` всё идёт полностью;
- (3) правка `test.yml` запускает всё (флаг `server`/`ops` включает `.github/**`).

**Проверка:**

- PR с правкой только `docs/` → в списке проверок тяжёлые джобы «skipped», итоговые зелёные;
- PR с правкой `src/permissions.ts` → `server` идёт;
- самотест скрипта отбора — `bash scripts/test-ci-changes.sh` по образцу `scripts/test-migration-policy.sh`, запуск в
  `migration-policy`.

**Отдельным PR, только `.github/` и `scripts/`.** Нужно решение владельца: какие джобы он считает обязательными.
**Бюджет:** 0.

### A-04 · P1 · `motion:check` видит JS (ADR-0035 п. 5) и CSS-переходы

Сейчас скрипт проверяет [код: `scripts/check-motion.mjs`]:

- CSS `animation` и `transition`: длительность-литерал запрещена;
- обязательную reduce-ветку — только для `animation` (`:107-111`);
- Tailwind `duration-N` (`:122-125`);
- WAAPI `duration: N` — только порог 450 (`:126-127`).

Чего не видит:

| что | пример [код/запуск] |
|---|---|
| импорт `motion` вне `motionEngine.ts` | сейчас нарушений нет [запуск], но правила нет |
| вызовы `el.animate(` вне `motion.ts` | `theme.ts:150` — `duration: 420` (не токен: 100/150/200/300/450) |
| `duration` в секундах в объектах движка | `EXIT = { duration: 0.2 }` (`motion.ts:68`) скрипт читает как «0» и пропускает |
| время успокоения пружин ≤ 500 мс | сейчас проверяет только `motion.test.ts` |
| экспортируемая функция `motion.ts` без `motionReduced()` | сейчас все анимирующие проверяют [код: `:171, :211, :220, :235, :261, :277, :291, :322`]; правила нет |
| `transition` двигающих свойств без reduce-ветки | сейчас найденные места покрыты вручную: `.timeline-bar` (`index.css:1011`), `.side-drawer`, `.board-member-filter` (`workspace.css:711-717`, FIX-03 трека N). Но правила в скрипте нет, и новое нарушение пройдёт [код] |
| задержка + длительность > 450 мс | `anim-stagger` сейчас ≤ 150 + 300 = 450 (`index.css` после `:1075`) — в норме, но не проверяется |

**Реализация (в том же файле, без новых зависимостей):**

1. **Импорты.** Обойти `src/**/*.{ts,tsx}`. Найти `from "motion…"`, `import("motion…")`, `require("motion…")` — разрешено
   только в `src/motionEngine.ts`. Найти `\.animate\(` — разрешено только в `src/motion.ts`. Исключения — список
   `ALLOW_RAW_ANIMATE` с причиной: `src/theme.ts` (круг темы: псевдоэлемент View Transition, обёртка его не умеет).
   Длительность там — из токенов: 420 → 450 (`--dur-5`) или 300.
2. **Длительности в JS** — по AST, не регэкспом: `typescript` уже есть в devDependencies,
   `ts.createSourceFile` + обход узлов.
   - Свойство `duration` в объектном литерале в файлах `src/motion.ts`, `src/theme.ts` и в любом объекте, переданном
     вторым аргументом `.animate(`.
   - Значение < 10 трактовать как секунды (motion), ≥ 10 — как мс (WAAPI).
   - Сверять с множеством {100, 150, 200, 300, 450}. Именованные константы (`COUNT_MS`) разрешать до числа в том же
     файле.
   - То же для `delay`, плюс правило «задержка + длительность ≤ 450».
3. **Пружины.** Найти в `motion.ts` экспортированные `const SPRING*` с литералом `{ visualDuration, bounce }`.
   - Скрипт импортирует `spring` из `motion` (это devDependency-путь для скрипта, не бандл) и считает
     `spring.applyToOptions(o).duration`.
   - Правила: ≤ 500 мс; `visualDuration × 1000` ∈ {100, 150, 200, 250, 300}. 250 уже используется (`SPRING_ENTER`,
     `SPRING_POP`) — записать как допустимое значение «между `--dur-3` и `--dur-4`» в `MOTION.md`.
   - Сейчас: `SPRING` 500, `SPRING_ENTER` 350, `SPRING_POP` 450 — проходят [запуск: А.3].
4. **reduce в обёртке.** Для каждой `export function` в `motion.ts`, у которой в теле есть `.animate(`, `track(`,
   `requestAnimationFrame(` или `startViewTransition` — в теле до первого такого вызова должно встретиться
   `motionReduced()`.
   - Список `NON_ANIMATING` с причиной: `setReducedMotion`, `userReducedMotion`, `motionReduced`, `reducedMotion`,
     `cssZoom`, `stopMotion`, `__resetMotionForTests`, `preloadMotion`.
   - Для `glideTo` проверка стоит после установки места (`motion.ts:322`) — допустимо: место ставится всегда, движение — нет.
5. **CSS-переходы.** Правило из N:IMP-02 п. 5:
   - `transition` с двигающими свойствами (`MOVING` + `all`) и Tailwind `transition-transform`,
     `transition-[…transform…]`, `hover:scale-*`, `hover:-?translate-*` требуют reduce-ветку;
   - reduce-ветка — переопределение под `@media (prefers-reduced-motion: reduce)`, `motion-reduce:` или правило
     личного выключателя;
   - по известным местам нарушений нет (см. таблицу выше), но первый прогон может найти неизвестные. Чинить код
     (добавить строки в существующий блок `@media (prefers-reduced-motion: reduce)`), не ослаблять правило.
6. **Защита обёрток экрана** (A-02 а): keyframes, на которые ссылаются `.anim-view`, `.anim-stagger > *`, `.ds-empty`, не
   содержат `transform`/`translate`/`scale`.
7. **Самотест.** `node scripts/check-motion.mjs --self-test`: временные копии с мутациями в `os.tmpdir()` → каждая
   обязана упасть. Мутации:
   - `import { animate } from "motion"` в компоненте;
   - `duration: 0.5`;
   - `SPRING = {visualDuration: 0.45, bounce: 0.4}`;
   - функция без `motionReduced`;
   - `transition: transform 300ms` без reduce;
   - `transform` в `viewIn`.

   Запуск самотеста — в CI-джобе `client` рядом с `motion:check`.

**Проверка:** `npm run motion:check` зелёный после правок кода; `--self-test` зелёный; время скрипта < 2 с.
**Риск:** ложные срабатывания — исключения только списком с причиной. **Бюджет:** 0 (скрипт); `theme.ts` 420 → 450 — 0.

### A-05 · P1 · `scripts/perf-board/run.mjs` не работает на `main`

**Факт [запуск]:** `CHROMIUM_PATH=… THROTTLE=1,4 node scripts/perf-board/run.mjs` → `page.waitForFunction: Timeout 60000ms
exceeded` в `run.mjs:218`: на странице 0 карточек, `body.innerText` пуст.

**Корень [запуск]:** в моках нет `/api/issues/assigned-to-me`. Обработчик `unknown` отдаёт `{}`, приложение при загрузке
падает: пустая страница, то есть та же форма регрессии, что описана в `CLAUDE.md` про `assignedToMe`. С моком
`{ items: [], truncated: false, limit: 200 }` во временной копии скрипта — 300 карточек, замер проходит (цифры — B-01).

**Что сделать:**

- добавить мок рядом с `/api/projects` (`run.mjs:≈88`);
- неизвестный путь — не `{}`, а **падение скрипта** с перечнем путей (`unknown` уже собирается, но печатается только в
  конце);
- побочная находка для отдельной задачи (не движение): ответ `{}` на `assigned-to-me` даёт пустой экран без
  `ErrorBoundary`. **[гипотеза]:** при сбое настоящего API то же. Проверить — e2e с `route.fulfill({ json: {} })` для этого
  пути. Если подтвердится — тикет владельцу.

**Бюджет:** 0.

### A-06 · P1 · Общие помощники e2e: `settle()`, `settleScroll()`, `loadMotion()`

Сейчас каждый тест ждёт по-своему:

- `motion-cleanup.pw.ts:8` — свой `finite()`;
- `dashboard-flip.pw.ts:26` — свой фильтр transform-анимаций;
- `roadmap-connections` — ничего.

**Новый файл `e2e/motion-helpers.ts`:**

```ts
/** Ждать, пока не останется конечных анимаций (бесконечные индикаторы — спиннер, блик скелетона — не в счёт) и прокрутка
 *  не встанет на два кадра. Вызывать перед геометрическими замерами «до» и «после». */
export async function settle(page: Page, timeout = 5_000): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.getAnimations()
    .filter(a => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity).length), { timeout }).toBe(0);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
/** Плавная прокрутка контейнера закончилась: scrollLeft/Top не меняются 4 кадра подряд. */
export async function settleScroll(el: Locator): Promise<void> { /* как в приложении Б */ }
/** Чанк движения загружен (первая анимация — уже пружина, а не мгновенно). */
export async function loadMotion(page: Page): Promise<void> { /* см. ниже */ }
```

**`loadMotion` — важное ограничение [запуск]:**

- **Под `boardFixture` Resource Timing пуст.** `performance.getEntriesByType("resource").length === 0` в
  production-сборке на доске. **[гипотеза]:** `page.clock.setFixedTime` (`e2e/board-fixture.ts:6`) подменяет `performance`
  вместе с часами. Приём из приложения А трека N (`getEntriesByType("resource")`) работает только без фикстуры часов.
- Надёжно: `page.waitForResponse(r => /motionEngine/.test(r.url()))` **до** действия, которое грузит чанк. Такие
  действия:
  - первый перенос карточки (`snapshotBoard` → `preloadMotion`, `boardFlip.ts:56`);
  - открытие окна (`ds/Dialog.tsx:56` → `enter` → `ready()`).
- Под `clock.setFixedTime` `requestIdleCallback` не срабатывает за разумное время (трек N, CHK-04), поэтому
  `preloadMotionIdle` в e2e не полагать.
- Альтернатива — DEV-хук `window.__taskiraMotion = { preload: preloadMotion }` под `import.meta.env.DEV`. Не попадает
  в сборку, но e2e production его не увидит — для `test:ui:production` только `waitForResponse`.

**Применение:**

- `board-layout.pw.ts:87` (перед `before`);
- `roadmap-connections.pw.ts:22-26` (A-01);
- `motion-cleanup.pw.ts`, `dashboard-flip.pw.ts`, `count-up.pw.ts` — заменить свои ожидания;
- все новые e2e трека — только через помощники.

**Бюджет:** 0.

### A-07 · P2 · Отчёт «карта анимаций» (`npm run motion:map`)

**Зачем:** в `MOTION.md` таблица «где применено» ведётся руками и уже отстаёт. Например, `.timeline-bar` (transition)
и `theme.ts` в ней не названы.

**Скрипт `scripts/motion-map.mjs`** (переиспользует разбор из `check-motion.mjs`: вынести общий модуль
`scripts/motion-lib.mjs`). Печатает таблицу:

- источник (файл:строка);
- тип (`css-animation` / `css-transition` / `waapi-wrapper` / `waapi-raw` / `view-transition`);
- что двигает (свойства keyframes или переход);
- длительность (токен);
- reduce-статус: `@media` / `личный выключатель` / `обёртка motionReduced` / **нет**;
- где применено (классы → файлы TSX по `grep`).

Режимы:

- `--md` пишет раздел в `docs/design/MOTION-MAP.md` (сгенерированный, как `docs/PERMISSIONS.md`);
- `--check` — для CI (`docs:check` или отдельной строкой в `client`).

Динамическая часть (в браузере) — на стенде A-08: e2e обходит сценарии и собирает `document.getAnimations()` с
`animationName`/`transitionProperty`/целью. Сверяет со статической картой: анимация в браузере, которой нет в карте,
— падение.

**Проверка:** `npm run motion:map -- --check` зелёный; мутация (новый `@keyframes` без reduce) видна в отчёте как «нет».
**Бюджет:** 0.

### A-08 · P2 · Стенд `/dev/motion` (только DEV)

По образцу `/dev/ui` (`main.tsx:19-21`, `src/dev/DevUI.tsx`): ветка в `main.tsx` под `import.meta.env.DEV` и
`location.pathname === "/dev/motion"`. В production-сборке условие — константа, код вырезается. Проверка — `grep -c "dev/motion"
dist/assets/*.js` = 0.

**Состав стенда** (каждый сценарий — секция с кнопкой «проиграть» и `data-scenario`):

1. мини-доска на настоящем `boardFlip.ts`: перенос, перестановка, массовая (3 и 41 карточка), создание;
2. список на `listEnter`/`listExit`: добавить, удалить, удалить 7 (больше `MAX_GHOSTS`), 201 строка (больше `MAX_TRACKED`);
3. `enter` всех видов; `exit`; `flash`; `glideTo` (вкладки); `glideWidth`; `countTo` (лево/центр/право, рост, убывание);
4. `Dialog`/`SidePanel` открыть/закрыть, быстрые повторы;
5. тосты: очередь из 3;
6. сетка дашборда (`gridFlip`) с клавиатурным сдвигом;
7. переключатели: системный reduce (подсказка: эмуляция в DevTools), личный выключатель, «замедлить ×5»
   (`document.getAnimations().forEach(a => a.playbackRate = 0.2)` по кнопке), «пауза на 50 %» (для B-03).

**e2e `e2e/motion-stand.pw.ts`** проходит все сценарии в трёх режимах (обычный, системный reduce, личный выключатель).
Проверяет:

- (а) под reduce после действия нет конечных `running` анимаций;
- (б) после `settle()` нет inline `transform`/`opacity`/`width` (кроме `glideTo`);
- (в) нет `securitypolicyviolation`. Dev-сервер без CSP, поэтому (в) — только как подсказка; настоящая проверка CSP —
  `test:ui:production`.

**Бюджет:** 0 в сборке (только DEV). **Риск:** стенд расходится с продуктом. Поэтому сценарии вызывают **настоящие**
модули (`boardFlip.ts`, `listExit.ts`, `gridFlip.ts`), а не копии.

---

## 4. Блок B — проверки

### B-01 · P1 · Производительность на слабой машине / VDI: методика, сценарии, пороги

**Что уже измерено в этом треке [запуск]** — production-сборка под production CSP (`scripts/preview-production.mjs`),
программная отрисовка SwiftShader (`gpu_compositing: disabled_software` — как VDI без GPU). Скрипт — приложение А, доска
1600×1000.

`scripts/perf-board/run.mjs` с исправлением A-05, 300 карточек, 1 прогон:

| CPU | загрузка доски | FPS при перетаскивании | первое открытие задачи с данными |
|---|---|---|---|
| 1× | 726 мс | 60 | 142 мс |
| 4× | 1912 мс | 60 | 661 мс |
| 6× | 3322 мс | 43 | 977 мс |

Новый зонд движения (приложение А), 208 карточек на экране, по 3 прогона. В ячейке: p95 кадра / худший кадр / самое
длинное событие ввода / пик одновременно идущих анимаций.

| CPU | перенос `M` в другую колонку | свёртка сайдбара `[` |
|---|---|---|
| 1× | 16–17 / 17–25 мс / 56–72 мс / 8 | 21–73 / 79–112 мс / 80–88 мс / 4 |
| 4× | 29–35 / 60–93 мс / 120–128 мс / 6–8 | 24–45 / 60–94 мс / 176–184 мс / 2–3 |
| 6× | 36–62 / 65–96 мс / 184–240 мс / 5 | 27–95 / 107–142 мс / 176–272 мс / 1–2 |

**Вывод [запуск + гипотеза]:**

- Перенос держит p95 ≤ 35 мс до CPU 4×. При 6× худший кадр ~ 100 мс, а событие ввода доходит до 240 мс — за порогом
  INP 200.
- **Свёртка сайдбара дорогая уже при CPU 1×:** кадры 79–112 мс. Это подтверждает гипотезу N:FIX-07: WAAPI по `width`
  даёт полную раскладку всей рабочей области на каждом кадре.
- Тонкость метода: в headless метка времени rAF идёт ровно по 16.7 мс даже при длинных задачах. Кадры надо мерить
  `performance.now()` внутри обратного вызова (в приложении А так и сделано). Первая версия зонда с меткой rAF показывала
  «все кадры 16 мс» при длинных задачах до 208 мс — ловушка.

**Методика (закрепить в `scripts/perf-motion/run.mjs`, по образцу `perf-board`, вывод JSON):**

- Сборка: `npm run build`, сервер — `scripts/preview-production.mjs` (production CSP), API — `page.route`.
- Профили:

| профиль | CPU | окно | масштаб | отрисовка |
|---|---|---|---|---|
| «офис» | 1× | 1920×1080 | 1.0 | по умолчанию |
| «слабый» | 4× | 1440×900 | 1.25 | по умолчанию |
| «VDI» | 6× | 1280×720 | 1.25 | `--disable-gpu --disable-gpu-compositing` |

  CPU — `Emulation.setCPUThrottlingRate`, масштаб — `deviceScaleFactor`.
- Повторы: 3 прогона на профиль; в отчёт — медиана и худший.
- Метрики (на действие):
  - `p95` и `max` длительности кадра (Δ `performance.now()` в rAF) в окне 900 мс после действия;
  - число кадров > 50 мс;
  - `longtask` (число и максимум);
  - Event Timing (`type: "event"`, `durationThreshold: 16`) — максимум как кандидат INP;
  - пик `document.getAnimations()` в состоянии `running`;
  - для FLIP — число принудительных пересчётов раскладки: `Tracing.start` с категорией `devtools.timeline`, события
    `Layout` с `stackTrace` внутри обработчика.

**Сценарии:**

| # | сценарий | данные |
|---|---|---|
| S1 | перенос карточки `M` в другую колонку | 200, 500 карточек (4 колонки) |
| S2 | массовая смена статуса | 40 и 41 карточка (порог `MAX_ANIMATED`) |
| S3 | свёртка/развёртка сайдбара на доске | 200 карточек |
| S4 | удаление строки в списке | 50, 200, 201 строка (`MAX_TRACKED`) |
| S5 | открытие/закрытие карточки задачи (панель) | — |
| S6 | правка дашборда: сдвиг виджета клавиатурой | 12 и 40 виджетов |
| S7 | смена вида 1→2→3→4→5 подряд | View Transition + `anim-view` |
| S8 | рост 6 счётчиков `CountUp` одновременно (опрос 30 с) | — |
| S9 | прокрутка доски во время пружины | снимок гасится — проверить отсутствие скачка |

**Пороги (предложение; утверждает владелец, записать в `docs/PERFORMANCE.md`, раздел «Движение»):**

| показатель | ок | плохо (нужно действие) |
|---|---|---|
| p95 кадра на «слабом» (4×) | ≤ 33 мс | > 50 мс |
| худший кадр на «VDI» (6×) | ≤ 100 мс | > 150 мс |
| событие ввода (кандидат INP) на 4× | ≤ 200 мс | > 200 мс |
| кадров > 50 мс за действие на 4× | ≤ 1 | ≥ 3 |
| пик идущих анимаций | ≤ `MAX_ANIMATED` (40) | > 40 |
| принудительных пересчётов раскладки на коммит FLIP | ≤ 2 | > 2 (N:FIX-06) |

**Что делать при превышении** — по порядку, каждый шаг отдельным PR с замером «до/после»:

1. **Потолки:** уменьшить порог для группы (`MAX_ANIMATED` 40 → 24) и анимировать только видимое (N:FIX-05 для списка).
2. **Мгновенный режим по объёму:** если на экране больше N элементов (предложение: 300 карточек доски, 150 строк
   списка), движение групп мгновенно. Вход окон и тосты остаются. Реализация — в `motion.ts`:
   `setMotionBudget(n)` / `motionHeavy()`, вызывается из доски и списка. Числа — из замера S1/S4.
3. **Свёртка сайдбара (S3)** — уже сейчас хуже порога при 1× по худшему кадру. Варианты:
   - (а) мгновенно при доске/списке с > N элементов;
   - (б) анимировать «корпус» (`clip-path`/`transform` на подложке), а ширину раскладки менять один раз в конце — см. C-03.
4. **Автоматика** (только с решением владельца): `PerformanceObserver("longtask")` в первые 30 с сессии; если > 3 задач
   > 200 мс — предложить в тосте включить «Уменьшить движение». Не включать молча.

**Проверка в CI:** не включать — время и шум раннеров. Только ручной запуск и запись в `docs/PERFORMANCE.md` с сырыми данными
`docs/PERFORMANCE.motion-YYYY-MM-DD.raw.json`. **Бюджет:** 0 (скрипт); шаг 2 — ≈ 0.1 КиБ входа.

### B-02 · P1 · Ручной чек-лист для владельца

Полный список — **приложение В**. Итог прогона — `docs/MANUAL-CHECK-TRACK-O.md` по образцу `MANUAL-CHECK-TRACK-K.md`:
экран, профиль, «ок/дефект», видео при дефекте.

В контейнере разработки проверить нельзя:

- скринридер (NVDA, VoiceOver);
- Safari 17.0–17.3 (пол по `docs/design/BROWSERS.md`);
- Firefox ESR;
- мобильные Safari и Chrome;
- нативный DnD дашборда и растягивание за угол **мышью** (e2e эмулирует указатель, но не системный DnD-курсор).

### B-03 · P2 · Визуальная регрессия середины анимации

Сейчас снимки — `animations: "disabled"` (`playwright.config.ts:14`), середина движения не проверяется.

**Метод [гипотеза — проверить на стенде A-08]:**

1. На стенде — действие.
2. Сразу — `document.getAnimations().forEach(a => { a.pause(); a.currentTime = a.effect.getComputedTiming().duration * 0.5 })`.
3. Затем `toHaveScreenshot({ animations: "allow" })`.

WAAPI-анимации motion — нативные (`NativeAnimation`), поэтому `pause()`/`currentTime` на них действуют. Проверить:

- (1) что после паузы motion по `onfinish` ничего не пишет (анимация не завершается);
- (2) что `finished` не резолвится и `track()` не снимает стиль.

**Сценарии:**

- перелёт карточки (копия в `.flip-flight`);
- призрак строки;
- `enter("dialog")`;
- `countTo` на 50 % (`::after` с промежуточным числом);
- индикатор вкладок.

Эталоны — только в образе `mcr.microsoft.com/playwright:v1.56.1-noble` (`ui-visual.yml`), файл `e2e/motion-stand.visual.pw.ts`,
эталоны в `e2e/__screenshots__/motion-*`. **Риск:** нестабильность растеризации SwiftShader на полупрозрачных кадрах. Допуск — тот
же `maxDiffPixelRatio: 0.002`; если не держится — снимать только opacity 0/1 кадры. **Бюджет:** 0.

### B-04 · P1 · Доступность: axe + reduce + фокус

Новый `e2e/motion-a11y.pw.ts`:

1. **axe** (`@axe-core/playwright`, уже в devDependencies) на стенде A-08 и на доске/списке **в середине** движения
   (пауза как в B-03). Призраки и копии полёта обязаны быть `aria-hidden`/`inert`: копия — `boardFlip.ts:166, 172`, призрак —
   `listExit.ts:67-68`. axe не должен видеть дубли `id` (копия их снимает — `boardFlip.ts:169-170`).
2. **reduce:** `page.emulateMedia({ reducedMotion: "reduce" })` и отдельно личный выключатель (`localStorage
   taskira.reduceMotion = "1"` до загрузки) → после каждого действия из S1–S8 нет конечных `running` анимаций, кроме
   разрешённых: `dsSpin`, `dsIndet` и блик скелетона под системной настройкой (`ALLOW_LOOPS`).
3. **Фокус:**
   - после `M`-переноса — на кнопке карточки (есть в `motion-cleanup.pw.ts`, расширить на массовую смену);
   - после ухода строки списка — на соседней строке, не на `body`. **[гипотеза]:** сейчас уходит на `body`, проверить;
   - после закрытия окна во время анимации ухода — на открывающем элементе;
   - после смены вида (View Transition) — фокус не теряется (D-17).
4. **Читатель экрана — без промежуточных чисел:** у `CountUp` во время счёта `textContent` = итог
   (`index.css:189-208`). Тест есть в `count-up.pw.ts`, дополнить `page.accessibility.snapshot()` — в дереве итоговое
   число, не кадр.

**Бюджет:** 0.

### B-05 · P2 · Память и утечки при размонтировании

Что держит ссылки [код]:

| что | где | чем грозит |
|---|---|---|
| `running` (WeakMap) | `motion.ts:113` | не держит элемент |
| `flights` (WeakMap) и страховочный таймер 1 с | `boardFlip.ts:159, 196` | таймер переживёт размонтирование доски на ≤ 1.2 с — допустимо |
| слушатель `scroll` на `document` | `boardFlip.ts:67-74` | вешается один раз на модуль (`scrollWatch`) и не снимается; держит только `snap` |
| `snap` | `boardFlip.ts:24` | держит `root` доски до `TTL_MS` или следующего снимка. После ухода с доски снимок с отсоединённым `root` живёт до следующего `playBoardFlip`, который проверяет `isConnected` (`:109`) |
| `countTo` | `motion.ts:234-255` | rAF отменяется возвратом; `CountUp` вызывает его в cleanup |
| `restoreCardFocus` | `boardFlip.ts:206-227` | таймеры до 1.2 с, отмена возвращается |

**Проверка:**

- e2e: открыть доску → перенос → сразу уйти на «Список» → через 2 с
  `queryObjects` (CDP `Runtime.queryObjects` для прототипа `HTMLElement` с классом `board-card`) или проще —
  `performance.memory` недоступна в headless стабильно;
- надёжнее юнит в jsdom: после `unmount()` нет активных таймеров (`vi.getTimerCount()` под фейковыми таймерами) для
  `CountUp`, `usePulse`, `EnterScope`, `restoreCardFocus`.

**Что сделать, если найдётся:** `snap = null`, если `root` отсоединён (на `cancel`), и отписка слушателя `scroll` при
`snap = null`. **Бюджет:** < 0.05 КиБ.

### B-06 · P2 · Скрытая вкладка и смена reduce на лету

- **Скрытая вкладка [код]:**
  - `viewTransition` при `visibilityState !== "visible"` — мгновенно (`motion.ts:152`). Остальные функции этого не
    проверяют. В скрытой вкладке rAF не идёт, WAAPI-анимации ставятся на паузу. Обещания `finished` резолвятся по
    возвращении — **[гипотеза]**.
  - Риски: `exit()` в скрытой вкладке держит призрак строки или тост до возвращения пользователя; `fly()` спасает
    страховочный таймер 1 с — **но** `setTimeout` в фоне троттлится до ≥ 1 с, и карточка может остаться скрытой
    дольше.
  - Проверка: e2e с `page.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "hidden" }))` и
    `dispatchEvent(new Event("visibilitychange"))` — это эмуляция, не настоящий фон. Настоящий фон — CDP
    `Page.setWebLifecycleState({ state: "frozen" })`.
  - Ожидание: после возврата нет висящих призраков и скрытых карточек.
  - Исправление при дефекте: в `enter/exit/flipFrom/fly` при `document.hidden` — мгновенный итог.
- **reduce на лету [код]:** `motionReduced()` читает `matchMedia` при каждом вызове (`motion.ts:14-20`), личный — из
  памяти. Значит, новые анимации учитывают смену сразу. Уже идущие — нет: доигрывают до конца, что допустимо.
  - CSS под `@media` браузер применяет сразу.
  - Проверка: e2e — начать перенос, на середине `emulateMedia({reducedMotion: "reduce"})` → следующий перенос мгновенный.
  - **Не** требовать остановки идущей (≤ 500 мс).

---

## 5. Блок C — улучшения существующего

### C-01 · P1 · Доска: несколько снимков вместо одного слота (N:IMP-06)

**Сейчас [код]:**

- один `snap` на модуль (`boardFlip.ts:24`): новый перенос до ответа сервера на предыдущий затирает снимок;
- `cancelBoardFlip` удаляет только свой (`:81-83`);
- при двух быстрых переносах (`M`, `M` по разным карточкам при задержке сервера 300+ мс) полностью, с подъёмом и точкой
  броска, анимируется последний; первая карточка появляется через `enter`, если её снимка нет, или прыжком
  (`MOTION.md`, «Открыто»).

**Сделать:**

- `snaps: Set<Snap>`, у каждого свой `lifted`, `landing`, `at`, `renewed`;
- `flipPending(id)` — любой живой снимок содержит `id`;
- `playBoardFlip`:
  - один обход карточек;
  - для каждой карточки «прежнее место» — из **самого раннего** живого снимка, где она есть: она видна там с тех пор;
  - `lifted`/`landing` — из снимка, где карточка была переносимой;
- истёкшие и мёртвые снимки удалять;
- потолок — 4 живых снимка (больше — старейший удаляется).

**Проверка:**

- `boardFlip.test.ts` — два снимка, ответы в обратном порядке → обе карточки летят от своих мест;
- отмена первого не трогает второй;
- e2e: два `M`-переноса с задержкой `transition` 600 мс (`route` с `setTimeout`) → у обеих карточек во время полёта
  есть `.flip-flight`.

**Риск:** средний (прерывания пружин; `boardFlip.test.ts` должен остаться зелёным). **Бюджет:** ≈ 0.2 КиБ входа
[гипотеза — оценка].

### C-02 · P1 · Доска: один проигрыш за коммит, сначала чтения, потом записи (N:FIX-06)

`playBoardFlip` висит на layout-эффекте **каждой** колонки (`Board.tsx:346`). Пока снимок жив, каждая колонка обходит
**все** карточки (`boardFlip.ts:116`), а `fly()` между чтениями вставляет узлы (`:163-175`).

Сделать:

- флаг «проиграно в этом коммите» — сброс через `queueMicrotask`;
- `flipFrom(el, l, t, { last })` с уже измеренным положением;
- сначала собрать все `getBoundingClientRect`, затем все `fly`/`flipFrom`.

Проверка — B-01, S1: «принудительных пересчётов ≤ 2 на коммит» на 500 карточках. Объединить с C-01 нельзя — разные PR,
C-02 первым (меньше). **Бюджет:** ≈ 0.1 КиБ входа.

### C-03 · P1 · Сайдбар: свёртка без раскладки на каждом кадре (N:FIX-07)

**Замер B-01 [запуск]:** худший кадр 79–112 мс при CPU 1×, 107–142 мс при 6×; событие ввода до 272 мс. Порог «плохо»
превышен.

**Варианты:**

- (а) **мгновенно**, если в рабочей области доска или список с > 150 элементами. Внешний вид не меняется, решение
  инженерное;
- (б) **«корпус»:** `aside` сразу получает конечную ширину (одна раскладка), а видимая подложка панели анимируется
  `clip-path: inset(0 X 0 0)` от прежней ширины к новой. `clip-path` анимируется композитором в Chromium **[гипотеза —
  проверить в DevTools Performance: «Composite only»]**. Содержимое рабочей области прыгает сразу, без анимации.
  Меняет ощущение — **решение владельца** (N:FIX-07 б, «менять, только если станет лучше»);
- (в) оставить ширину, но `contain: layout` на листе и `content-visibility: auto` на карточках вне экрана —
  **[гипотеза]**: уменьшит стоимость раскладки доски. Проверить замером S3.

Порядок: (в) → замер → если плохо, (а). (б) — только с согласия владельца, показать видео.

**Проверка:** S3 на трёх профилях; `e2e/sidebar-resize.pw.ts` и `motion-cleanup.pw.ts` зелёные. **Бюджет:** (а) ≈ 0.05,
(б) ≈ 0.15 КиБ.

### C-04 · P2 · Автопрокрутка при перетаскивании (доска, дашборд)

**[код]** своей автопрокрутки нет: в `Board.tsx:211, :525` и `DashboardGrid.tsx:58` есть только `onDragOver` без
`scrollBy`. Chromium сам прокручивает прокручиваемый контейнер, когда курсор при нативном DnD у его края
**[гипотеза — проверить вручную]**. Firefox и Safari ведут себя иначе (B-02).

**Сделать, только если ручная проверка покажет, что автопрокрутки нет хотя бы в одном движке матрицы:**

- в `dragover` у края контейнера (≤ 48 px) — `requestAnimationFrame`-цикл `el.scrollBy(0, v)`, скорость растёт к краю;
- стоп на `dragleave`/`drop`/`dragend`;
- под reduce — шаг больше, без плавности (прокрутка — не украшение, её не отключать);
- функция `autoScroll(el)` в новом `src/dragScroll.ts`; это не `motion.ts`, потому что не анимация.

Риск: прокрутка гасит снимок FLIP (`boardFlip.ts:67-74`) — правильно, положения устаревают. **Бюджет:** ≈ 0.2 КиБ.

### C-05 · P2 · `glideWidth` и прерывания: продолжение с видимой ширины

`glideWidth(el, from, to)` берёт `from` у вызывающего (`Sidebar.tsx:191`). При быстром `[`, `[` вторая пружина стартует
с прежней конечной ширины, а не с видимой: скачок **[гипотеза — проверить на стенде A-08 «замедлить ×5»]**.

Сделать по образцу `glideTo` (`motion.ts:307-316`): если на элементе идёт анимация, `from` = текущая вычисленная ширина
(`getBoundingClientRect().width / cssZoom`). Тест — юнит с фейковым движком. **Бюджет:** < 0.05 КиБ.

### C-06 · P2 · Пресеты пружин — на токены (N:IMP-01)

Один реестр в `motion.ts`: `MOTION = { spring: {...}, enter: {...}, pop: {...}, exit: {...}, flash: 300, count: 300 }`.
Скрипт `scripts/generate-motion-tokens.mjs` пишет `--ease-spring` (`styles/tokens.css`, строка `linear(…)`, сейчас
«когда-то вручную») из того же `spring()`. Режим `--check` — в `docs:check`. A-04 читает пресеты из реестра. **Бюджет:** 0.

### C-07 · P2 · Единые пороги групп

Сейчас пороги разбросаны [код]:

| порог | значение | где |
|---|---|---|
| `MAX_ANIMATED` | 40 | `boardFlip.ts:15` |
| `MAX_TRACKED` (дашборд) | 40 | `gridFlip.ts:12` |
| `MAX_TRACKED` (список) | 200, только отслеживание; анимировать может до 199 | `listExit.ts:11` |
| `MAX_GHOSTS` | 6 | `listExit.ts:12` |
| `LIST_ENTER_CAP` | 8 | `listEnter.ts:7` |

Сделать:

- вынести в `motion.ts`: `export const MOTION_CAPS = { flip: 40, ghosts: 6, enter: 8, track: 200 }`;
- в `listExit` добавить фильтр видимости и потолок `flip` (N:FIX-05);
- тест на каждый порог (ветка «больше порога — мгновенно» для доски сейчас не покрыта — N:CHK-02).

После B-01 пороги можно уменьшить. **Бюджет:** ≈ 0.05 КиБ.

### C-08 · P2 · `CountUp` в других местах — правило и кандидаты

**Правило (записать в `MOTION.md`):** `CountUp` — только для числа, которое **растёт по обновлению данных** (опрос
30 с, WebSocket, своё действие), и только если на экране **одновременно растут не больше 3 чисел**. Не применять:

- там, где фильтр, период или метрика меняют все числа разом («Отчёты» — решение COV-01);
- при первом показе (`resetKey`);
- в убывание.

**Кандидаты [код]:**

- счётчик колонки доски (`Board.tsx:480`, уже `usePulse`) — **нет**: переносы меняют два счётчика сразу, плюс пульс;
  хватит пульса;
- бейдж непрочитанных (`Sidebar.tsx:164`) — **нет**: однозначные числа, пульса достаточно;
- «Отчёты» — **нет** (COV-01);
- виджеты портфеля дашборда (`projects`, `projectHealth`) — **да**, если число в одной карточке (как `count`), с
  `resetKey` = период + проекты;
- «Входящие» — счётчик непрочитанных в заголовке вкладки — **да**, при росте по WebSocket `notify`.

**Выравнивание [код + гипотеза]:** `::after` с `inset: 0; text-align: inherit` (`index.css:203-208`). Число
выравнивается как итог, и ширина держится невидимым текстом. Проверить в браузере три случая (стенд A-08, секция
`countTo`): `text-align: right` в ячейке таблицы, `center` в виджете, `left` в заголовке. Ожидание — промежуточное число
не прыгает по горизонтали при смене количества цифр (9 → 10): ширина задана итогом (10), `tabular-nums`. Снимок середины —
B-03.

**Safari 17.0–17.3 [код: комментарий `index.css:189-195`]:** вторая строка `content: … / ""` там не работает, и
промежуточное число может быть озвучено. Это B-02, ручная проверка VoiceOver. **Бюджет:** ≈ 0.02 КиБ на место.

### C-09 · P2 · Вспышка после перелёта (N:FIX-08)

В `land()` (`boardFlip.ts:185-192`) запускать `flash(el)`, только цвет фона, на настоящей карточке. Сейчас CSS-вспышка
`anim-drop*` идёт, пока карточка скрыта. **Бюджет:** < 0.05 КиБ входа.

### C-10 · P2 · Мелочи из трека N

Каждая — свой маленький PR или вместе с соседним по файлу:

| пункт | что сделать | бюджет |
|---|---|---|
| N:FIX-10 | счётчик переходов `vt-nav` | ≈ 0 |
| N:FIX-11 | зависимости индикатора вкладок: подпись набора `items.map(i => i.id).join()` | ≈ 0 |
| N:FIX-13 | `hintIn` через `grid-template-rows` | CSS ≈ 0.05 |
| N:FIX-14 | `preloadMotionIdle()` вместо ручного кода в `Board.tsx:643-652`; убрать `ENTER_FRAMES.toast`; поправить комментарий `Presence` | −0.05 |

### C-11 · P2 · Прерывание и возобновление — единая политика

Записать в `MOTION.md` и проверить тестами:

- новая анимация того же элемента продолжает с видимого места: `flipFrom` — да (`boardFlip.ts:123-125` и `listExit.ts:43`
  через `isMoving`), `glideTo` — да, `glideWidth` — C-05, `enter` — **нет**: повторный `enter` во время входа начнёт с
  `opacity 0` **[гипотеза]**;
- уход прерывает вход (`stopMotion` в `Dialog`).

Для `enter`: если элемент уже анимируется, не перезапускать. **Бюджет:** < 0.05 КиБ.

### C-12 · P2 · Матрица браузеров для движения (N:IMP-07)

Дописать в `docs/design/BROWSERS.md` строки (по документации, отметить «не проверено в браузере» до B-02):

| возможность | что важно |
|---|---|
| `linear()` | Safari 17.2 |
| `@starting-style` | Safari 17.5, Firefox 129 (нет в ESR 128 — если заказчик на нём) |
| `transition-behavior: allow-discrete` | — |
| `::details-content` | Chromium 131+ |
| `Element.currentCSSZoom` | Chrome 128 / Firefox 126 / Safari 18.2, фолбэк 1 в `motion.ts:191` |
| `content: … / ""` | Safari 17.4+ |
| `requestIdleCallback` | нет в Safari, фолбэк `setTimeout` в `motion.ts:297` |
| View Transitions | Firefox 144+, Safari 18 |

---

## 6. Блок D — новые возможности

Для каждой идеи указаны:

- **ценность**;
- **стоимость** (КиБ gzip, [гипотеза — оценка] по калибровке §0);
- **риски** — CSP / a11y / e2e / VDI;
- **где** в коде;
- **тест**;
- **приоритет**.

Всё — через `motion.ts`, с reduce и потолком.

### D-01 · P1 · «Входящие»: уход строк (N:NEW-01)

- **Ценность:** средняя. В фильтре «Непрочитанные» прочитанное исчезает прыжком; вход уже есть (`InboxView.tsx:66`).
- **Как:** подключить `createRowMotion` (`listExit.ts`) рядом с `createEnterTracker`, как в `Backlog.tsx:500-511`.
  Сначала уход и сдвиг, потом вход. Хозяину списка нужен `position: relative` для призрака (`.list-row-ghost` —
  `workspace.css:710` описан только для `.list-table`; для Inbox — своё правило, ≈ 0.02 КиБ CSS).
- **Стоимость:** ≈ 0.1 JS (чанк `InboxView`) + 0.02 CSS.
- **Риски:**
  - e2e `navigation-*`, `InboxView.test.tsx`: призрак — копия строки с `aria-hidden`/`inert`, без `role`, поэтому
    `getByRole` его не видит, а `locator(".inbox-row")` — видит **[гипотеза]**. Проверить и при необходимости дать
    призраку иной класс;
  - VDI: ≤ 6 призраков.
- **Тест:**
  - `InboxView.test.tsx` — отметить прочитанным в фильтре «Непрочитанные» → `exit` вызван один раз;
  - e2e — строка уходит, фокус на соседней (B-04).

### D-02 · P2 · Карточка задачи: вход подзадач и связей (N:NEW-03)

- **Ценность:** низкая–средняя.
- **Как:** обернуть списки подзадач и связей в `EnterScope` (как чек-лист, `IssueModal.tsx:260`).
  `resetKey = issue.id`.
- **Стоимость:** ≈ 0.01 (компонент уже есть).
- **Риски:** `issue-relations.pw.ts` считает строки сразу после добавления. `enter` — прозрачность и подъём 8 px, счёт
  не меняется, но `boundingBox` в середине — да; добавить `settle()`.
- **Тест:** `IssueModal` компонентный — добавленная связь анимируется, первый показ — нет.

### D-03 · P1 · Плавная замена скелетона на контент (N:NEW-04)

- **Ценность:** средняя. При медленном ответе контент «выстреливает» поверх `skeleton-late`.
- **Как (только CSS):** контейнеру, который показал скелетон, по приходе данных — класс `anim-view` (только
  прозрачность, `viewIn`). Условие «скелетон был **показан**»: `skeletonLate` стартует с задержкой `--dur-3`, поэтому
  нужен признак, что задержка прошла. Без JS-таймера — `onAnimationStart` на скелетоне ставит `ref.current = true`, и
  контент получает класс, только если флаг стоит.
  - Где: `Board.tsx:354` (колонка), `Backlog.tsx:732` (список), скелетоны экранов.
- **Стоимость:** ≈ 0.05 JS + 0 CSS (класс есть).
- **Риски:**
  - e2e меряют раскладку сразу после контента — прозрачность раскладку не меняет (A-02);
  - VDI: одна анимация на контейнер.
- **Тест:** компонентный — без показанного скелетона класса нет; e2e с задержкой ответа 800 мс — класс есть, и
  `getAnimations()` пуст через 300 мс.

### D-04 · P2 · Календарь: смена месяца/недели — только после спайка (N:NEW-06)

**Факты [код]:** дни — `key={day}` (`CalendarView.tsx:149`), фокус ставится в rAF по `[data-day]` (`:111, :119`). При смене
месяца все ячейки перемонтируются. ADR-0035 отказался из-за фокуса.

**Спайк:** WAAPI на **стабильном** контейнере сетки (не на ячейках): `opacity 0.4 → 1` и `translateX(±12px) → 0` по
направлению (PageUp/PageDown). Новая функция в `motion.ts`: `slide(el, dir)` с reduce.

Критерии спайка:

- (1) `e2e/calendar.pw.ts:95` и все проверки `toBeFocused` зелёные в 20 прогонах;
- (2) фокус-кольцо не «едет» отдельно от ячейки — transform на предке двигает и его, это нормально;
- (3) DnD плашек во время 300 мс анимации попадает в правильный день **[гипотеза]**: `elementFromPoint` учитывает
  transform.

Не прошёл хоть один — отклонить, записать в «Сознательно не анимируется».

- **Стоимость:** ≈ 0.1 (`slide` во входном чанке; вызов — в ленивом календаре).
- **Риски:** VDI — один элемент.

### D-05 · P2 · Открытие карточки задачи «страницей»: общий элемент строка → заголовок — только как спайк

**Что есть [код]:**

- панель (`SidePanel`) — `enter(el, "panel")`, уход — CSS;
- «страница» открывается через `viewTransition` (перекрёстное затухание, `motion.ts:150-162`).

**Возможность:** общий элемент без `animateView` и без `<style>`. Перед `startViewTransition` присвоить
`el.style.viewTransitionName = "issue-hero"` строке-источнику через CSSOM (разрешено CSP — ADR-0010; `BROWSERS.md` уже
предусматривает `view-transition-name` «кастомным свойством через CSSOM»). Внутри `update()` — снять его со строки и
поставить на заголовок страницы. Правила `::view-transition-group(issue-hero)` — статический CSS.

**Ограничения:**

- только режим «страница» (Входящие, Мои задачи, поиск — `CLAUDE.md`);
- **для панели — отклонить**: `<dialog>` в верхнем слое. Как он участвует в снимке View Transition в Chromium 141 —
  **[гипотеза]**, а Safari 18 и Firefox 144 отличаются;
- у строки и заголовка разный размер и шрифт — морфинг текста растягивает растр. Поэтому `issue-hero` — только у **ключа
  задачи** (короткий моноширинный текст), не у заголовка.

**Спайк:**

- `scripts/motion-spike/` + стенд A-08, production CSP (`npm run csp:spike` как образец);
- 0 нарушений CSP; фокус после перехода на заголовке страницы (D-17);
- Firefox 144 и Safari 18 — вручную (B-02).

- **Стоимость:** ≈ 0.15 JS + 0.1 CSS.
- **Риски:** e2e `navigation-*` с полной страницей (`issue-fixture.ts`) — `animations: "disabled"` на снимках
  останавливает и VT **[гипотеза]**.
- **Приоритет:** P2. Без зелёного спайка не делать.

### D-06 · P1 · «Отправлено» для других мутаций (как NEW-02)

- **Ценность:** высокая для VDI. Доска уже показывает «перенос отправлен» через 150 мс (`markPending`).
- **Кандидаты:**

| мутация | где | что помечать |
|---|---|---|
| новый комментарий | `IssueModal` | поле ввода и кнопка «Отправить» → `aria-busy`, строка-черновик с `data-pending` до ответа |
| пункт чек-листа (добавить/отметить) | `IssueModal.tsx:260-282` | строка `data-pending` |
| назначение исполнителя | `AssigneePicker` | аватар `data-pending` |
| метка | `IssueModal` (подсказки меток) | чип `data-pending` |

- **Как:**
  - общий помощник `markPendingEl(el, delay = PENDING_DELAY_MS)`, вынесенный из `boardFlip.ts:235-250` в `motion.ts`
    или `pending.ts`;
  - стиль — то же правило, что `.board-card[data-pending]` (`index.css:374`), обобщить на `[data-pending]`: приглушение и
    курсор `progress`, **без анимации**;
  - откат при ошибке — снять отметку и вернуть прежнее значение (сейчас store делает «API, потом патч» — `CLAUDE.md`,
    Client data flow);
  - строка-черновик комментария — новая логика стора, **решение владельца**.
- **Стоимость:** ≈ 0.15 JS + 0.03 CSS (+ ≈ 0.2 JS за черновик комментария).
- **Риски:**
  - a11y: `aria-busy` на элементе, а не на всей карточке;
  - e2e: `employee-assignees.pw.ts`, `issue-relations.pw.ts` проверяют результат — `data-pending` им не мешает.
- **Тест:** юнит помощника (фейковые таймеры: быстрый ответ — без отметки); e2e с задержкой ответа 600 мс.

### D-07 · P2 · «Отменить» в тосте — продуктовая функция, движение вторично

**Факты [код]:**

- у `Toast` в сторе нет действия (`types.ts:238-242`: `id`, `kind`, `text`);
- `ds` `Toast` умеет `action` (`ds/Display.tsx:221`), а концепция «тост с таймером и Отменить» утверждена (`COMPONENTS.md`,
  «Концепции» п. 4);
- удаление задачи — настоящее удаление, отменить нечем.

**Можно:**

- перенос статуса на доске и в списке — отмена = переход обратно, если он есть в схеме переходов (иначе кнопки нет);
- массовая смена;
- снятие исполнителя или метки.

**Движение:** при отмене карточка летит обратно тем же FLIP (снимок перед отменой); тост уходит `exit`.

- **Стоимость:** ≈ 0.6–1.0 КиБ (стор, тип тоста, i18n RU/EN, кнопка).
- **Риски:**
  - гонки с опросом 30 с;
  - отмена «чужого» изменения, если задачу успели изменить: проверять `updatedAt`;
  - a11y: действие в тосте должно быть достижимо с клавиатуры, а тост не должен уйти, пока фокус в нём (пауза таймера
    при фокусе).
- **Приоритет:** P2. **Решение владельца** — это функция, не анимация.

### D-08 · P2 · Сворачивание: «Ранее закрыто» на доске

**Факты [код]:**

- сворачиваемых колонок доски нет: есть только «Ранее закрыто» в колонке «Готово», `Board.tsx:608`;
- сворачиваемых групп в списке не нашлось (`grep aria-expanded Backlog.tsx` — только меню строки).

**Сделать:**

- (а) раскрытие «Ранее закрыто» — высота через `grid-template-rows: 0fr → 1fr` (как N:FIX-13) + вход новых карточек
  через `createEnterTracker` с потолком 8;
- (б) сворачивание колонок доски как **функция** — не движение, а продукт: отдельная задача владельцу, вне трека.

- **Стоимость:** (а) ≈ 0.05 CSS + 0.02 JS.
- **Риски:** `board-refresh.pw.ts` считает карточки после раскрытия — `settle()`.

### D-09 · P2 · Счётчики колонок и прогресс-бары

Прогресс-бары **уже** плавные (`ds/ds.css:953-960`, `.timeline-bar-fill`). Счётчики колонок пульсируют
(`usePulse(total, "any")`).

**Новое:** ничего, кроме C-08 и A-04 п. 5 (reduce у переходов ширины). **Отклонено как отдельная задача.**

### D-10 · P2 · Подсветка «изменено другим» (опрос 30 с)

**Факты [код]:** WebSocket несёт только `notify` (`store.tsx:380-384`). Изменения задач приходят опросом
(`setInterval(tick, 30_000)`, `store.tsx:341`) и `issuesRevision` → `revalidate` (`issuePages.ts:303`). Значит, «пришло
по WebSocket» для карточек невозможно без серверной работы (`issue:upsert` не реализован — `CLAUDE.md`). Сделать можно
«изменено при обновлении».

**Как:**

- в `ColumnCards` и строках списка хранить `Map<id, updatedAt>` (без React-состояния, в ref);
- при revalidate карточке, у которой `updatedAt` вырос **и** последнее изменение сделал не текущий пользователь
  (нужен `updatedBy` — в DTO его нет **[код]**; без него подсвечивать любые чужие изменения нельзя), — `flash()`;
- потолок 8 за ревалидацию, только видимые, не при первой загрузке и не после собственного действия (окно 2 с после
  своей мутации).

- **Стоимость:** ≈ 0.15 JS. Без поля `updatedBy` (серверная правка — вне трека) — только «изменено с прошлой проверки».
- **Риски:** при смене фильтра «новые» строки подсвечиваться не должны — `resetKey` по фильтру, как у `CountUp`.
- **Приоритет:** P2. Начать с вопроса владельцу про `updatedBy`.

### D-11 · P2 · Бейджи и счётчики уведомлений

- **Есть:** `usePulse` на бейдже сайдбара и точке колокольчика (`Sidebar.tsx:164`, `Topbar.tsx:379`).
- **Добавить:** счётчик непрочитанных во вкладке «Входящие» (C-08) и отметку «новое» на только что пришедшей строке
  Inbox — это и есть D-01 (вход строк уже есть).
- **Стоимость:** ≈ 0.02.

### D-12 · Отклонить · Палитра команд и панель уведомлений: появление результатов

Результаты палитры пересчитываются на каждый символ: движение мешает чтению и нагружает VDI (трек N, «Поиск в шапке,
палитра» — не делать). Переходы между группами — тоже нет. Панель уведомлений — `anim-pop` уже есть (`Topbar.tsx:177`).

### D-13 · P2 · Вкладки и фильтры-чипы: появление и уход чипа сводки фильтров

- **Факты [код]:** порядок вкладок и чипов не меняется (перестановки нет). Меняется **набор**: чип сводки фильтров
  появляется и исчезает (`Board.tsx:940-946`), вкладка «Спринты» — при включении модуля (N:FIX-11).
- **Как:** `enter(chip, "pop")` при появлении сводки (≤ 1 элемент); соседи по строке инструментов — без FLIP (они
  справа и сдвигаются при `flex-wrap`, FLIP на строке инструментов рискован для `board-layout.pw.ts`, который меряет
  её высоту).
- **Стоимость:** ≈ 0.02.
- **Риски:** `board-layout` меряет `top` колонок после появления сводки (`:41-45`) — `pop` не меняет раскладку
  (transform), но `boundingBox` чипа в середине — да.

### D-14 · P2 · Таймлайн и роудмап: изменение полосы — только видимые строки

- **Факты [код]:**
  - полосы таймлайна уже переходят по transform и width (`index.css:926-929`, reduce — `:1011`);
  - роудмап виртуализирован (`visibleItems`, `RoadmapView.tsx:88`), позиции — в днях × `--ppd` (`CLAUDE.md`);
  - перерисовка всех строк стоила 250 мс.
- **Как:** после сохранения дат в «Сроки и вехи» — `flash()` на полосе **только этой** строки, если она в окне. Вход
  полос при прокрутке и смене масштаба — **не делать** (E).
- **Стоимость:** ≈ 0.02.

### D-15 · P2 · Перенос задачи между спринтом и бэклогом

- **Факты [код]:** `SprintsView` — только `anim-stagger` (`SprintsView.tsx:292`). Модуль выключен по умолчанию.
  Перемещение между проектами в коде не найдено (`grep moveToProject` — пусто).
- **Как:** `createRowMotion` + `createEnterTracker` на списках спринта и бэклога, как в списке задач. Перелёт между
  списками (как `fly` доски) — не делать: два независимых прокручиваемых списка, риск выше ценности.
- **Стоимость:** ≈ 0.08.
- **Приоритет:** P2, только если владелец подтвердит, что спринтами пользуются.

### D-16 · P2 · Пустые состояния и успех — ненавязчиво

- **Есть:** `.ds-empty` — `viewIn` (прозрачность).
- **Добавить:**
  - (а) «прорисовка» галочки в тосте успеха (`stroke-dashoffset`, как `drawLine`, `--dur-4`, один раз) — `ds/Display.tsx:211-212`;
  - (б) завершение чек-листа (все пункты отмечены) — `flash()` на счётчике «N/N».
- **Без конфетти, пульсаций и повторов.**
- **Стоимость:** ≈ 0.05 CSS + 0.01 JS.
- **Риски:** `motion:check` требует reduce для `stroke-dashoffset` (`MOVING` его включает) — добавить в существующий блок
  `@media`.

### D-17 · P1 · Смена экрана через View Transition — с сохранением фокуса

- **Факты [код]:** `viewTransition(update)` (`motion.ts:150-162`) меняет экран внутри `flushSync`. Куда уходит фокус после
  смены вида по `1`–`5` или `G` + буква — **[гипотеза]**: на `body`, если сфокусированный элемент размонтирован.
- **Как:**
  - после `finished` (или сразу, если VT нет) перевести фокус на заголовок нового экрана (`h1`/`[data-view-heading]`
    с `tabIndex = -1`), только если фокус потерян (`activeElement === body`);
  - не двигать фокус, если он внутри нового экрана;
  - `preventScroll: true`.
- **Стоимость:** ≈ 0.05 входа.
- **Риски:**
  - a11y-польза, но скринридер прочтёт заголовок при каждой смене вида — это ожидаемо для SPA;
  - e2e с клавиатурными проверками после смены вида (`workspace-*`).
- **Тест:** e2e — `1` → `2` → фокус на заголовке «Список задач»; с reduce — тоже.

### D-18 · Отклонить · Тактильные и звуковые сигналы

Vibration API на десктопе нет, на мобильных — только Android Chrome. Звук в корпоративном трекере мешает и требует
настроек громкости и отключения. Ценность ниже стоимости.

### Итоговая таблица блока D

| ID | идея | КиБ gzip [оценка] | волна | приоритет | решение владельца |
|---|---|---|---|---|---|
| D-01 | Inbox: уход строк | 0.12 | W4 | P1 | нет |
| D-03 | скелетон → контент | 0.05 | W4 | P1 | нет |
| D-06 | «отправлено» для 4 мутаций (без черновика комментария) | 0.18 | W4 | P1 | нет; черновик — да (+0.2) |
| D-17 | фокус после смены экрана | 0.05 | W4 | P1 | нет |
| D-02 | подзадачи/связи `EnterScope` | 0.01 | W4 | P2 | нет |
| D-04 | календарь (после спайка) | 0.10 | W4 | P2 | нет |
| D-05 | общий элемент «строка → страница» (после спайка) | 0.25 | W4 | P2 | да (вид) |
| D-07 | «Отменить» в тосте | 0.6–1.0 | W4 | P2 | **да** (функция) |
| D-08а | «Ранее закрыто»: раскрытие | 0.07 | W4 | P2 | нет |
| D-10 | «изменено с прошлой проверки» | 0.15 | W4 | P2 | да (`updatedBy`) |
| D-11 | счётчик Inbox | 0.02 | W4 | P2 | нет |
| D-13 | чип сводки фильтров | 0.02 | W4 | P2 | нет |
| D-14 | полоса роудмапа после правки | 0.02 | W4 | P2 | нет |
| D-15 | спринт ↔ бэклог | 0.08 | W4 | P2 | да (используется ли) |
| D-16 | галочка успеха, чек-лист готов | 0.06 | W4 | P2 | нет |
| D-09 | счётчики/прогресс | 0 | — | — | отклонено (уже есть) |
| D-12 | палитра, уведомления | 0 | — | — | отклонено |
| D-18 | тактильные/звук | 0 | — | — | отклонено |
| **итого D** | | **≈ 1.8 (без D-07) / ≈ 2.8 (с D-07 и черновиком)** | | | |

Улучшения блока C:

| ID | КиБ |
|---|---|
| C-01 | 0.2 |
| C-02 | 0.1 |
| C-03 | 0.05–0.15 |
| C-04 | 0.2 |
| C-05 | 0.05 |
| C-07 | 0.05 |
| C-08 | 0.04 |
| C-09 | 0.05 |
| C-10 | ≈ 0 |
| C-11 | 0.05 |
| **итого C** | **≈ 0.9** |

Блоки A и B — 0 в сборке; B-01 шаг 2 — +0.1. Всё вместе — **≈ 2.8–3.8 КиБ**.

---

## 7. Блок E — что не делать

| Что | Почему |
|---|---|
| `motion/react` (`motion.*`, `m`, `LazyMotion`, `AnimatePresence`, `layout`, `layoutId`) | ADR-0035 п. 3: 29–43 КиБ; `popLayout` вставляет `<style>` (CSP); MotionValue в `style` ломается о `secure-jsx`; layout-анимации — кадры main thread |
| `animateView` | вставляет `<style id="motion-view">` — нарушение `style-src-elem` (спайк ADR-0035). Свой `viewTransition` есть |
| hybrid `animate` из `motion` | 20 КиБ, пружины `x/y` по кадрам main thread |
| `backdrop-filter` на больших поверхностях, в т. ч. «ради глубины» перехода | ADR-0023/0027: −10…27 fps на 3440 px |
| бесконечные декоративные анимации (дыхание, пульсация «новинок», блики) | ТЗ 5.13, VDI, вестибулярные риски; разрешены только индикаторы процесса (`ALLOW_LOOPS`) |
| встряска полей и карточек при ошибке | вестибулярный риск, a11y; ошибка — текстом и тостом (`MOTION.md`) |
| параллакс, scroll-driven анимации | VDI, ценность ≈ 0, `prefers-reduced-motion` |
| «физика» перетаскивания (инерция, наклон под скоростью) | ADR-0007: нативный DnD; призрак `.drag-ghost` уже наклонён |
| анимации внутри виртуализированных полос таймлайна/роудмапа (вход при прокрутке, смена масштаба) | анимация повторялась бы при прокрутке; 250 мс на перерисовку всех строк (`CLAUDE.md`, «Time scale») |
| cross-document View Transitions | SPA, переходов между документами нет (`BROWSERS.md`) |
| FLIP доски на каждое обновление опроса | обход 200+ карточек на VDI на каждые 30 с; только D-10 с потолком и только подсветка |
| «язычок» активного пункта сайдбара | низкая ценность, риск для `sidebar-resize.pw.ts` и снимков (трек N) |
| анимация смены языка, темы интерфейса, плотности | смена раскладки целиком; тема уже имеет круг (`theme.ts`) |
| анимация ширины колонок, таблиц, `height: auto` через JS | раскладка на каждом кадре; для раскрытия — только `grid-template-rows` |
| IMP-03 трека N («убрать рантайм motion ради −4.68 КиБ») | **отклонено**: владелец одобрил рост бюджета (14.10.2026); теряются пружины с параметрами и генератор; чанк ленивый |
| движение в `src/dev/` в счёт бюджета | стенды — только `import.meta.env.DEV` |
| `retries` в Playwright и повышение допусков `toBeCloseTo` «чтобы прошло» | маскирует корни (A-01, A-02). Разрешено только после найденного корня и с обоснованием в PR |

---

## 8. Бюджет

**Решение владельца (14.10.2026):** бюджет можно увеличить, число не названо. IMP-03 трека N в связи с этим отклонён.

**Расчёт** (от замера `197281d`, §0):

| | сейчас | план C + D | итого после трека | **новый допуск** | запас после трека |
|---|---|---|---|---|---|
| total | +225.65 | ≈ +3.8 (с D-07) | ≈ +229.5 | **+236 КиБ** | ≈ 6.5 КиБ |
| js | +201.41 | ≈ +3.4 | ≈ +204.8 | **+210 КиБ** | ≈ 5.2 КиБ |
| css | +24.24 | ≈ +0.4 | ≈ +24.6 | **+28 КиБ** | ≈ 3.4 КиБ |
| entry | +18.38 | ≈ +0.5 (C-01, C-02, C-09, D-17, B-01 шаг 2) | ≈ +18.9 | **+40 КиБ** (без изменений) | ≈ 21 КиБ |

**Почему с запасом ~5–6 КиБ, а не впритык:**

- (1) оценки [гипотеза] — ошибка ×1.5 вероятна;
- (2) параллельные треки (не движение) тоже растут, и каждый PR трека не должен стоять в очереди за допуском;
- (3) в CI CSS на ≈ 0.03 КиБ больше локального (`PERF-BUDGET.md`, 12.10.2026).

Если владелец хочет меньше — минимум **+232 / +207 / +27**. Запас ≈ 2.5 КиБ, D-07 тогда только с отдельным согласованием.

**Порядок:**

1. **PR W0** (первый в треке, отдельный):
   - `scripts/bundle-budget.json`: `allowedGrowth.total = 241664` (236 × 1024), `js = 215040` (210 × 1024),
     `css = 28672` (28 × 1024); `entry` и `base` без изменений;
   - в конец `allowedGrowthNote` — фраза «14.10.2026 владелец разрешил поднять допуски для трека O (движение, вторая
     волна, `docs/tracks/TRACK-O-MOTION-WAVE2.md`): total +236 КиБ, JS +210 КиБ, CSS +28 КиБ (было +228/+203/+26). Замер
     перед поднятием: +225.65 / +201.41 / +24.24.»;
   - `docs/design/PERF-BUDGET.md` — тот же абзац в конец «Истории согласованных допусков»;
   - `docs/design/MOTION.md` — в «Открыто» ссылка на трек O вместо трека N.
2. Каждый PR фичи — в описании строка `bundle: total +X.XX → +Y.YY, js …, css …, entry …` из `npm run bundle:check`.
3. Если фактический рост пункта больше оценки в 2 раза — остановиться и написать владельцу до слияния.
4. **Мерить после каждого PR:**
   - `bundle:check`;
   - `JS до первого экрана` (справочная строка того же вывода) — не должен расти от ленивых фич;
   - для пунктов входного чанка (C-01, C-02, C-09, D-17) — `entry` отдельно.

**Нужен ли новый ADR — описание, сам ADR не писать:**

- **ADR «Пороги производительности движения и мгновенный режим»** — нужен, если B-01 приведёт к шагу 2 (мгновенный режим
  по объёму) или 4 (подсказка включить «Уменьшить движение»). Это решение о поведении продукта на слабых машинах. Что
  должно быть внутри:
  - профили и пороги из B-01 (таблица);
  - числа N для доски и списка с замером;
  - что гаснет и что остаётся (окна, тосты);
  - связь с личным выключателем;
  - как это видно пользователю (никак или тост);
  - статус по отношению к ADR-0035 — `Supplements`.
- **ADR на общий элемент через View Transitions (D-05)** — только если спайк зелёный. Это расширение ADR-0015/0035:
  `view-transition-name` через CSSOM, режим «страница», отказ для панели.
- Остальное (C, D без D-05) — в рамках ADR-0035, достаточно `MOTION.md`.

---

## 9. Риски и откат

| Риск | Где проявится | Мера |
|---|---|---|
| e2e меряют раскладку в середине движения | `board-layout`, `workspace-*`, `roadmap-*`, `issue-relations` | `settle()` (A-06) перед «до» и «после»; transform только на самих движущихся элементах, не на предках |
| Playwright-повторы с прокруткой `start` | любые элементы, которые прячутся по положению прокрутки | гистерезис (A-01); после плавной прокрутки — `settleScroll` |
| снимки `ui-visual` | любые изменения внешнего вида | `animations: "disabled"` уже в конфиге; эталоны — только в образе CI; новые снимки середины — только стенд (B-03) |
| фокус | `M`-перенос, уход строк, смена экрана, закрытие окна | B-04; каждый PR с движением по фокусу — e2e на `toBeFocused` |
| CSP | новые функции, D-05 | только CSSOM/WAAPI; `test:ui:production` и `npm run csp:spike` для D-05 |
| inline-стиль после анимации | новые функции в `motion.ts` | `track(el, c, clear)` обязательно; A-08 (б) |
| VDI | доска, сайдбар, списки | пороги, B-01; новое движение групп — только с потолком |
| рост CI-времени | новые e2e | см. ниже |

**Откат фичи.** Отдельного флага для каждой анимации не вводить: это код и тесты на каждую ветку. Механизмы:

- (1) **reduce** — у пользователя всегда есть «Уменьшить движение» (личный) и системная настройка. Это и есть
  выключатель для всех;
- (2) **ревёрт PR** — поэтому один PR на одну тему;
- (3) для D-05, D-07, D-10 (меняют поведение) — константа-флаг в коде `const ENABLE_… = true` на одну версию: выключение
  — однострочный PR без ревёрта логики. Удалить флаг после месяца без жалоб.

**Как не раздувать CI-время:**

- новые e2e движения собрать в 3 файла: `motion-stand`, `motion-a11y`, `motion-stand.visual`;
- не множить профили ширины без нужды: 1460 и 390 покрывают десктоп/телефон;
- B-01 в CI не включать;
- A-03 сокращает `tests` для документов и клиента.

`ui visual` сейчас ≈ 9–11 минут (385 тестов, лог прогона 38549650841: «370 passed (11.0m)»). Цель — не больше +2 минут
за трек. Замерить в каждом PR по логу.

---

## 10. Приложения

### Приложение А — замер движения (проверено запуском)

Файлы клались во временный каталог `e2e-scratch-o/` в корне рабочей копии (удалён). Для постоянного инструмента —
`scripts/perf-motion/` с собственным конфигом.

`pw.prod.config.ts`:

```ts
import { defineConfig } from "@playwright/test";
import base from "../playwright.config";
const port = process.env.PLAYWRIGHT_PORT || "3199";
export default defineConfig({ ...base, testDir: ".", testMatch: "perf-*.pw.ts", workers: 1,
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { command: "node scripts/preview-production.mjs", cwd: "..", url: `http://127.0.0.1:${port}`, reuseExistingServer: false } });
```

`perf-motion.pw.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { boardFixture } from "../e2e/board-fixture";
const RATES = (process.env.THROTTLE ?? "1,4,6").split(",").map(Number);
const EXTRA = Number(process.env.EXTRA ?? 200);
async function frames(page: Page, ms: number, act: () => Promise<void>) {
  await page.evaluate((ms) => {
    const w = window as any; w.__f = []; w.__lt = []; w.__peak = 0; w.__ev = [];
    try { new PerformanceObserver(l => w.__lt.push(...l.getEntries().map(e => e.duration))).observe({ type: "longtask" }); } catch {}
    try { new PerformanceObserver(l => w.__ev.push(...l.getEntries().map(e => e.duration))).observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit); } catch {}
    // performance.now() внутри кадра, а не метка rAF: в headless метки идут ровно по 16.7 мс даже при длинных задачах
    let last = performance.now(); const end = last + ms + 300;
    const tick = () => { const t = performance.now(); w.__f.push(t - last); last = t;
      w.__peak = Math.max(w.__peak, document.getAnimations().filter(a => a.playState === "running").length);
      if (t < end) requestAnimationFrame(tick); };
    setTimeout(() => requestAnimationFrame(tick), 300);
  }, ms);
  await page.waitForTimeout(300);
  await act();
  await page.waitForTimeout(ms + 100);
  const r = await page.evaluate(() => ({ f: (window as any).__f as number[], lt: (window as any).__lt as number[], peak: (window as any).__peak as number, ev: (window as any).__ev as number[] }));
  const f = r.f.slice(1).sort((a, b) => a - b);
  const p = (q: number) => Math.round(f[Math.min(f.length - 1, Math.floor(q * f.length))] ?? 0);
  return { frames: f.length, p50: p(0.5), p95: p(0.95), max: Math.round(f[f.length - 1] ?? 0), over50: f.filter(x => x > 50).length,
    longTasks: r.lt.length, longMax: Math.round(Math.max(0, ...r.lt)), peakAnims: r.peak, eventMax: Math.round(Math.max(0, ...r.ev)) };
}
for (const rate of RATES) test(`motion perf cpu ${rate}x`, async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const fx = await boardFixture(page, "light");
  for (let n = 0; n < EXTRA; n++) fx.issues.push({ ...fx.issues[1], id: `x${n}`, key: `CORP-${100 + n}`, title: `Задача ${n}: длинный заголовок, который переносится на вторую строку`, statusId: `s${1 + (n % 3)}`, rank: 10 + n, dueDate: null, doneAt: null });
  await page.route(/\/api\/projects\/p1\/issues\/[ix]\d+$/, r => r.fulfill({ json: { ...fx.issues.find(i => i.id === new URL(r.request().url()).pathname.split("/").at(-1)), attachments: [], links: [], checklist: [], customFieldValues: [], collaboratorIds: [] } }));
  await page.route("**/api/projects/p1/issues/*/transition", r => { const id = new URL(r.request().url()).pathname.split("/")[5]; const is = fx.issues.find(i => i.id === id)!; is.statusId = r.request().postDataJSON().statusId ?? "s2"; return r.fulfill({ json: is }); });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await page.goto("/p/CORP/board");
  await expect(page.locator("article[data-issue-id]")).toHaveCount(fx.issues.length - 1, { timeout: 60_000 }); // i9 — «Ранее закрыто», свёрнута
  const move = async (id: string) => { await page.locator(`article[data-issue-id="${id}"] .board-card-open`).focus(); await page.keyboard.press("m"); await page.getByRole("menuitem", { name: "В работе" }).click(); };
  await move("i1"); // прогрев: первый перенос грузит чанк движения
  await page.waitForTimeout(2000); // под boardFixture Resource Timing пуст (A-06) — ждём время, а не запись ресурса
  const moveR = await frames(page, 900, () => move("i2"));
  await page.waitForTimeout(1000);
  const side = await frames(page, 900, async () => { await page.locator("body").click({ position: { x: 5, y: 990 } }); await page.keyboard.press("BracketLeft"); });
  console.log("PERF", JSON.stringify({ rate, cards: fx.issues.length, move: moveR, sidebar: side }));
});
```

**Запуск** (после `npm run build`):

```bash
CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome PLAYWRIGHT_PORT=3519 \
  npx playwright test -c e2e-scratch-o/pw.prod.config.ts --repeat-each=3
```

Результат — 9 из 9 прогонов, цифры — таблица B-01. Окружение: Chromium 141.0.7390.37, SwiftShader, 4 × Xeon 2.1 ГГц.

**Ограничения:**

- `transition` мокается полем `statusId`, а настоящий клиент шлёт `to` (`motion-cleanup.pw.ts:15`). Карточка всё равно
  переезжает в «В работе» по умолчанию (`?? "s2"`). В постоянном скрипте брать `postDataJSON().to`;
- окно кадров начинается через 300 мс после установки наблюдателя;
- у сайдбара сначала идёт `click` по телу страницы — его длительность попадает в `eventMax`. В постоянном скрипте фокус
  ставить через `page.focus("body")` без клика.

**`perf-board` с исправлением A-05 [запуск]** (временная копия скрипта с одной строкой мока, удалена):

```bash
CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome THROTTLE=1,4,6 node scripts/perf-board/run.mjs
# в handle(): if (p === "/api/issues/assigned-to-me") return { items: [], truncated: false, limit: 200 };
```

### Приложение Б — воспроизведение A-01 и критерий закрытия A-01/A-02 (проверено запуском)

Механизм — помеха над ручкой уводит Playwright в повторы с `scrollIntoView({inline: "start"})`:

```ts
import { expect, test } from "@playwright/test";
import { roadmapFixture } from "../e2e/roadmap-fixture";
for (const ms of [150, 400, 900]) test(`intercept ${ms}ms`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1080 });
  await roadmapFixture(page, "dark");
  await page.goto("/roadmap"); await expect(page.locator(".roadmap-project-row")).toHaveCount(5);
  const source = page.locator(".roadmap-timeline-row[data-project-id=p1]");
  await expect(source.locator(".roadmap-connect")).toBeVisible();
  // помеха поверх ручки (CSSOM — тест, не продукт): Playwright уходит в повторы end → center → start
  await source.locator(".roadmap-connect").evaluate((el, ms) => { const r = el.getBoundingClientRect(); const d = document.createElement("div");
    Object.assign(d.style, { position: "fixed", left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px`, zIndex: "9999" });
    document.body.appendChild(d); setTimeout(() => d.remove(), ms); }, ms);
  let hoverOk = true; await source.locator(".roadmap-connect").hover({ timeout: 5000 }).catch(() => (hoverOk = false));
  const ok = await source.locator(".roadmap-connect").boundingBox({ timeout: 2000 }).then(() => true, () => false);
  console.log("INTERCEPT", ms, "hover", hoverOk, "bbox", ok ? "ok" : "LOST", "L", await page.locator(".roadmap-timeline").evaluate(el => el.scrollLeft));
});
```

**Результат** (`--repeat-each=2 --workers=3`, dev-сервер):

| помеха | hover | boundingBox | scrollLeft |
|---|---|---|---|
| 150 мс | ок | ок | 0 |
| 400 мс | ок, один раз не прошёл | LOST | 310 |
| 900 мс | ок | LOST | 310 |

После A-01 (гистерезис) ожидание: «bbox ok» во всех случаях.

Зонд выравнивания (`scrollIntoView` ручки):

| выравнивание | результат |
|---|---|
| `start` | `{L: 310, attached: false, ret: true}` |
| `nearest` | ручка на месте |
| `center` | ручка на месте |
| `end` | ручка на месте |

**Помощник `settleScroll`.** Прогон «увести полосу за край → `.roadmap-return` → сразу `hover`» при CPU 4× (15 повторов) — 15 из 15 и с помощником, и **без** него. То есть локально падение этим путём не воспроизводится, а помощник — страховка, не доказанное исправление. Доказанный механизм — повторы Playwright (зонд выше):

```ts
export const settleScroll = (el: Locator) => el.evaluate(n => new Promise<void>(res => {
  let last = -1, still = 0;
  const t = () => { const v = n.scrollLeft + n.scrollTop * 1e6; if (v === last && ++still > 3) return res(); if (v !== last) still = 0; last = v; requestAnimationFrame(t); };
  t();
}));
```

**Критерий закрытия A-01/A-02.** На образе `mcr.microsoft.com/playwright:v1.56.1-noble` (как `ui-visual.yml`):

```bash
docker run --rm -v "$PWD":/w -w /w mcr.microsoft.com/playwright:v1.56.1-noble bash -lc \
  'npm ci && npx playwright test e2e/board-layout.pw.ts e2e/roadmap-connections.pw.ts --repeat-each=50'
git checkout docs/design   # на случай, если UPDATE_DOC_SCREENSHOTS был выставлен
```

Ожидание — 0 падений. **Не** запускать с `--workers` больше числа ядер. Локально при `--workers=8` на 4 vCPU
`roadmap … at 3440` падает 8 из 8 на `toHaveCount(5)` в `setup()` (`roadmap-connections.pw.ts:10`, 5 с) [запуск] —
dev-сервер не успевает отдать ленивый чанк. Это перегрузка, не дефект.

### Приложение В — ручной чек-лист для владельца

**Матрица:**

- RU и EN;
- светлая и тёмная темы;
- системный reduce вкл/выкл;
- личный выключатель («Профиль → Внешний вид») вкл/выкл;
- ширины 1920, 1460, 1024, 768, 390;
- масштаб Windows 100/125/150 %.

Отдельно — 2560 и 3440 (корневой zoom 1.1). Отмечать «ок / дефект + видео».

**Браузеры** (что нельзя проверить в контейнере):

| Браузер | Что пройти | На что смотреть |
|---|---|---|
| Safari 17.0–17.3 (macOS) | доска (перенос `M`, мышью, массовая смена), окно задачи, меню/поповеры, «Главная» со счётчиками, дашборд | `--ease-spring` = `linear()` недействителен до 17.2 → у `.ds-pop` отбрасывается весь `transition`: меню без анимации — **ок**, если открывается и закрывается. Счётчик `CountUp`: VoiceOver не должен читать промежуточные числа (до 17.4 не работает `content: … / ""` — C-08) |
| Safari 17.4+ / 18 | то же + смена вида (View Transitions с 18) | круг смены темы; перекрёстное затухание видов |
| Firefox ESR (текущий 153; если у заказчика 140/128 — отметить) | всё выше | `@starting-style` (с 129) — вход меню; View Transitions (с 144) — без перехода в ESR 140, это **ок** |
| Мобильный Safari (iPhone) и Chrome (Android) | доска 390 px (колонки вертикально), панель-выезд сайдбара, окно задачи, тосты | выезд панели — reduce; подсказка `board-move-touch-hint` (`hover: none`); нет «прыжков» прокрутки во время пружины |
| Chrome/Edge, Яндекс Браузер | полный прогон | эталон |

**Скринридер:**

| Сценарий | NVDA + Firefox/Chrome (Windows) | VoiceOver + Safari (macOS) |
|---|---|---|
| Перенос карточки `M` → «В работе» | фокус остаётся на карточке в новой колонке; объявляется название карточки, не «пусто» | то же |
| Массовая смена статуса 3 карточек | тост читается один раз; копии полёта не читаются | то же |
| Удаление строки в списке | призрак не читается; фокус на соседней строке (B-04) | то же |
| «Главная», рост счётчика (сменить задачу в другой вкладке, ждать 30 с) | читается итоговое число, не промежуточные | **Safari 17.0–17.3 — главный риск** |
| Окно задачи: открыть, Esc во время ухода | фокус на открывающем элементе | то же |
| «Перенос отправлен» (медленная сеть, DevTools → Slow 3G) | `aria-busy` не создаёт лишних объявлений | то же |

**Нативный DnD и указатель (только руками):**

| Сценарий | Что проверить |
|---|---|
| Дашборд, режим правки: перетащить виджет мышью (нативный DnD) | соседи доезжают плавно (NEW-05); тот, кого тащат, идёт за курсором; бросок у края экрана — автопрокрутка (C-04: есть ли вообще) |
| Дашборд: растянуть за угол мышью | соседи поджимаются плавно; угол не «отстаёт» |
| Доска: перетащить карточку в другую колонку, бросить у нижнего края длинной колонки | автопрокрутка колонки (C-04); перелёт из точки броска |
| Доска: быстро перетащить две карточки подряд (до ответа сервера, Slow 3G) | обе долетают (сейчас — только последняя; после C-01 — обе) |
| Сайдбар: `[` на доске с 200+ карточками, CPU 4× (DevTools → Performance → CPU) | нет рывка > 100 мс (C-03) |
| Роудмап 1280 px: прокрутить так, чтобы конец полосы был у левого края | ручка связи не исчезает (A-01) |

### Приложение Г — карта «область × движение × reduce × что добавить»

Обозначения reduce:

- **@m** — `@media (prefers-reduced-motion: reduce)`;
- **Л** — общее правило личного выключателя `html[data-motion="reduce"]`;
- **JS** — `motionReduced()` в обёртке.

Состояние — на `197281d` [код]. Двигающих мест без ветки под системной настройкой при этом обходе не найдено; полный перечень даст A-07.

| Область | Что движется | API | reduce | Что добавить (ID) |
|---|---|---|---|---|
| Доска | перенос, перелёт, волна, новая карточка, пульс счётчика, «отправлено», подсветка цели | `boardFlip.ts`, `enter`, `usePulse`, CSS `anim-drop*` | JS, @m, Л | C-01, C-02, C-09, D-03 |
| Список задач | вход и уход строк, подсветка статуса | `listEnter`, `listExit`, `Flash` | JS | C-07 (видимые), D-03 |
| Входящие | вход строк, `anim-stagger` | `listEnter` | JS, @m | D-01, D-11 |
| Мои задачи | `anim-stagger` групп | CSS | @m, Л | — |
| Главная | `anim-stagger`, `CountUp` | CSS, `countTo` | @m, JS | — |
| Карточка задачи | вход ленты и чек-листа, `Flash` статуса и приоритета, вход панели | `EnterScope`, `flash`, `enter("panel")` | JS | D-02, D-06 |
| Окна, палитра | вход пружиной, уход CSS | `enter("dialog")`, `Presence` | JS, @m | D-05 (только «страница») |
| Тосты | вход CSS, уход `exit`, сдвиг соседей | `ui.tsx`, `flipFrom` | JS, @m | D-07, D-16 |
| Вкладки | индикатор | `glideTo` | JS | C-10 (N:FIX-11), D-13 |
| Сайдбар | ширина | `glideWidth` | JS | C-03, C-05 |
| Сайдбар-выезд (< 1024) | transform 300 мс | Tailwind | @m (трек N, FIX-03) | — |
| Таймлайн | `.timeline-bar` transform/width, `anim-fadeup` панели | CSS transition | @m (`index.css:1011`), Л | D-14 |
| Роудмап | пунктир связи, «Сегодня» | CSS, `scrollTo` | @m, JS | A-01, D-14 |
| Календарь | — | — | — | D-04 (спайк) |
| Дашборды | `anim-stagger`, `drawLine`, FLIP в правке, `CountUp` | CSS, `gridFlip`, `countTo` | @m, JS | C-08 (портфель) |
| Отчёты | `anim-stagger`, столбцы `viewIn` | CSS | @m | нет (C-08: не `CountUp`) |
| Спринты | `anim-stagger` | CSS | @m | D-15 |
| Смена экрана | `anim-view`, View Transition | CSS, `viewTransition` | @m, JS | C-10 (N:FIX-10), D-17 |
| Тема | круг View Transition | `theme.ts` `root.animate` 420 мс | JS | A-04 (токен 450) |
| Фильтры (участники) | `.board-member-filter:hover` translateY | CSS transition | @m (`workspace.css:716-717`), Л | — |
| Подсказки | `hintIn` (max-height) | CSS | @m | C-10 (N:FIX-13) |
| Меню, поповеры | `.ds-pop`, `@starting-style`, `--ease-spring` | CSS | @m, Л | C-12 (Safari < 17.2) |
| Чекбоксы, радио, чек-лист | галочка, точка, зачёркивание | CSS | @m | D-16 (чек-лист готов) |
| Заставка | `splashDraw/Out/Lift` | CSS + `splash.ts` | `splash.ts:10` (обе настройки) | — |
| Скелетоны | `shimmer`, `dsShimmer`, `skeletonLate` | CSS | @m, Л (блик — статичен) | D-03 |
| Палитра (результаты) | — | — | — | отклонено (D-12) |
| Доступ, админка, справка | hover-переходы цвета | CSS | — | не нужно |
