# ADR-0035 — Движение: ядро `motion/mini` + пружина ленивым чанком за обёрткой `src/motion.ts`; без `motion/react`

**Статус:** Accepted
**Дата:** 2026-10-13 (решение владельца); технический спайк и прототип — 2026-10-12
**Supplements:** ADR-0015 (не заменяет его: CSS-состояния, View Transitions навигации и нативный DnD остаются как есть)

## Контекст

Владелец хочет менее примитивное движение: пружины, FLIP-перестановку карточек доски, появление/уход строк списка,
тостов и окон, «перелетающий» индикатор вкладок, счётчики чисел. ADR-0015 (25.09.2026) решил «без библиотеки» и оставил
оговорку: сложная хореография — новый ADR с замером бюджета. Ограничения на 12.10.2026:

- **CSP — жёсткое ограничение** (`nginx.conf`, ADR-0010): `style-src 'self'; style-src-attr 'none'`, без nonce.
  CSSOM-записи (`el.style.x`, `setProperty`, WAAPI `el.animate`) разрешены; `style=""` в разметке,
  `setAttribute('style')` и `<style>` — запрещены. `src/secure-jsx` превращает проп `style` из **нашего** JSX в класс
  в `public/dynamic.css`.
- Размер бандла владелец жёстким не считает (парк i5/i7, VDI-пользователи уже живут с Jira), но бюджет
  `scripts/bundle-budget.json` и `npm run bundle:check` действуют; входной чанк ≈ 95 КБ gzip при допуске база + 40 КБ.
- Правила движения ТЗ 5.13 проверяет `npm run motion:check` (`scripts/check-motion.mjs`): длительности — токены
  `--dur-1…5`, не дольше 450 мс, двигающие анимации переопределены под `prefers-reduced-motion`.
- Уже есть `src/motion.ts` (`viewTransition`, `flipFrom` на WAAPI с `cubic-bezier`), `ds/Presence.tsx` для ухода окон,
  CSS-анимации `anim-*` / `ds*`.

### Как проверяли

`scripts/motion-spike/` — тем же методом, что `csp-spike` (ADR-0010), и на его сервере: `csp-spike/server.mjs` читает
строку CSP из `nginx.conf` и отдаёт страницу с этим заголовком (серверу добавлен параметр `root` — каталог страницы).
`run.mjs` собирает пробы esbuild'ом (JSX — с `jsxImportSource: "#secure-jsx"`, как в `vite.config.js`; React из
`node_modules` репозитория, production-сборка), открывает страницу в Chromium 141 через Playwright (браузер
`@playwright/test` 1.56.1) и печатает таблицу: применился ли эффект (покадровая выборка `getComputedStyle` /
`getBoundingClientRect`), какие `securitypolicyviolation` пришли, рост числа CSS-правил и `<style>`. Два прохода:
обычный и с эмуляцией `prefers-reduced-motion: reduce`. Контроли (`style=""` в разметке, вставка `<style>`) обязаны не
сработать — сработали бы, отчёт помечается недостоверным. Сам спайк ставит `motion` во временный
каталог (`SPIKE_NODE_MODULES`, команда — в шапке `run.mjs`); для прототипа на тестовом стенде `motion` затем добавлен
в `package.json` точной версией (см. «Состояние прототипа»), а спайк перезапущен на установленных `motion` 13.4.4 +
`framer-motion` 13.5.1 — результат тот же. Версия — `motion@13.4.4` (25.09.2026; последняя, которой
на день спайка не меньше двух недель). Размеры — `scripts/motion-spike/size.mjs`.

### Результаты: API × CSP (Chromium 141, motion 13.4.4)

| API | эффект | нарушения CSP | как пишет стили |
|---|---|---|---|
| Контроль: `style=""` в разметке | не применён (как и должно) | `style-src-attr` | — |
| Контроль: вставка `<style>` | не применён (как и должно) | `style-src-elem` | — |
| `motion/mini` `animate`: opacity, transform, CSS-переменная (`@property`) | работает | 0 | WAAPI `el.animate` |
| `motion/mini` `animate` + `spring` | работает: easing `linear(…)`, перелёт 109 % → 100 % | 0 | WAAPI, пружина — строка `linear()` |
| `motion` (hybrid) `animate`: opacity, `x` + spring, незарегистрированная `--переменная`, `stagger` | работает | 0 | WAAPI или кадры main thread → `element.style` (CSSOM) |
| `motion` (hybrid) `animate(0, 100, { onUpdate })` — счётчик | работает | 0 | стилей нет (`textContent`) |
| `motion` `animateView` (обёртка View Transitions) | переход идёт, но **правила не применены** | `style-src-elem` ×4 | вставляет `<style id="motion-view">` |
| `<m.div>` + `LazyMotion(domAnimation)`: initial → animate, spring | работает | 0 | React `style` внутри motion → CSSOM; `secure-jsx` не участвует |
| `<motion.div animate={{ "--x": … }}>` | работает | 0 | CSSOM |
| `<motion.div style={{ x: motionValue }}>` из нашего JSX | **не работает** (x = 0) | 0 | `secure-jsx` перехватывает `style`, MotionValue теряется |
| `<motion.div style={{ opacity: 0.5 }}>` из нашего JSX | работает | 0 | правило `taskira-dyn-N` в `dynamic.css` (+1 правило на значение) |
| `<AnimatePresence mode="sync" \| "wait">` — exit | работает | 0 | CSSOM |
| `<AnimatePresence mode="popLayout">` — exit | анимация идёт, **фиксация размеров не применена** | `style-src-elem` | `PopChild` вставляет `<style>` (nonce у нас нет) |
| `<motion.li layout>` — перестановка (FLIP motion) | работает | 0 | CSSOM `transform` на каждый кадр (main thread) |
| `layoutId` — индикатор вкладки | работает (если элемент прожил хотя бы кадр до переключения) | 0 | CSSOM, main thread |
| Прототип обёртки: `flipSnapshot()` / `enter()` / `exit()` на `motion/mini` + `spring` | работает | 0 | WAAPI |
| reduced-motion: `motion/mini` и hybrid `animate` без защиты | **анимируют** — `prefers-reduced-motion` сами не учитывают | 0 | — |
| reduced-motion: `MotionGlobalConfig.skipAnimations = true` | мгновенно | 0 | — |
| reduced-motion: `<MotionConfig reducedMotion="user">` | при reduce `x` мгновенно, opacity анимирует; без reduce — анимирует | 0 | — |
| reduced-motion: прототип обёртки (системный reduce или выключатель) | мгновенно, `exit()` сразу резолвится | 0 | — |

Итог: из проверенного нарушают CSP ровно два места — **`animateView`** и **`AnimatePresence mode="popLayout"`** (оба
вставляют `<style>`). Всё остальное — 0 нарушений и 0 новых правил; единственный рост `dynamic.css` — статический
`style` из нашего JSX на `motion.*`, то есть тот же механизм, что у любого другого элемента. Плюс одна поломка без
нарушения: MotionValue в `style` из нашего JSX не доходит до motion (`secure-jsx`).

### Размеры (gzip, `node:zlib` по умолчанию — как `bundle:check`; React вынесен — он уже в приложении)

| что | min, КБ | gzip, КБ |
|---|---|---|
| `motion/mini` `animate` | 8.2 | 3.3 |
| `motion/mini` `animate` + `spring` (ленивый чанк прототипа) | 12.3 | **5.0** |
| `motion` hybrid `animate` (+ `spring`, `stagger` — 20.1) | 53.9 | 19.9 |
| `motion/react` `m` + `LazyMotion` (без фич) | 13.4 | 5.5 |
| `motion/react` `domAnimation` (фичи) | 66.9 | 24.0 |
| `motion/react` `domMax` (фичи + layout) | 114.6 | 37.9 |
| `m` + `LazyMotion` + `domAnimation` + `AnimatePresence` + `MotionConfig` | 80.1 | 28.8 |
| `m` + `LazyMotion` + `domMax` + `AnimatePresence` + `MotionConfig` | 127.3 | 42.6 |
| полный `motion` компонент (+ `AnimatePresence`, `LayoutGroup`, `MotionConfig` — 42.8) | 122.2 | 40.6 |
| синхронная часть обёртки (без чанка) | 1.2 | 0.6 |

Таблица — esbuild 0.28 `--minify`. Сверка сборкой Vite 8 (rolldown), каждый вариант — единственный `import()` в
отдельном проекте, сумма ленивых чанков: mini + spring 4.7, hybrid 18.6, `m` + `domAnimation` + `AnimatePresence`
27.0, полный `motion` 40.4 КБ gzip. Во всех вариантах это **ленивый** чанк: входной чанк растёт только на обёртку
(≈ 0.6 КБ), так что лимит `entry` (+40 КБ) не задет; растут `js` и `total` — а у них запаса почти нет (см. п. 5
решения).

### Длительность пружины против правила «≤ 450 мс»

Пружина задаётся «видимой» длительностью (`visualDuration`), а успокаивается дольше (по генератору `spring()` motion):

| visualDuration | bounce 0 | 0.15 | 0.25 | 0.4 |
|---|---|---|---|---|
| 200 мс (`--dur-3`) | 400 | 400 | 350 | 450 |
| 300 мс (`--dur-4`) | 550 | 500 | 500 | 650 |
| 450 мс (`--dur-5`) | 750 | 700 | 750 | 950 |

Хвост после `visualDuration` — доли пикселя; глазом это конец движения, но число в `linear()` / `duration` больше 450.

## Решение

Принято владельцем 13.10.2026. Внедрение — на ветке стенда `stand/motion`; перенос в `main` — отдельным решением:

1. **Подключить `motion`, но только подмножество `motion/mini` `animate` + `spring`**, как ленивый чанк
   (≈ 5 КБ gzip). Весь вывод — WAAPI: те же разрешённые CSP записи, что ADR-0010/0015 уже используют; WAAPI-анимации
   transform/opacity браузер может вести вне main thread (в спайке не измерялось).
2. **Единственная точка входа — существующий `src/motion.ts`** (обёртка; прототип — `scripts/motion-spike/probes/
   motion-wrapper.mjs`, проверен спайком). Импортировать `motion` где-либо ещё нельзя. Поверхность:
   - `preloadMotion()` — `import("./motionEngine")` на простое после первого экрана; пока чанк не загружен —
     мгновенно (без «догоняющих» анимаций);
   - `flipSnapshot(container, selector = "[data-flip]")` → `play()`: снимок `getBoundingClientRect` до изменения DOM,
     проигрыш после (в React — из `useLayoutEffect`); позиция берётся с учётом текущего transform, поэтому прерванная
     анимация продолжается с видимого места; `flipFrom` переходит на пружину;
   - `enter(el)` — opacity + подъём на пружине; `exit(el): Promise<void>` — 200 мс без пружины, узел снимает
     вызывающий (для списков — по образцу `ds/Presence`);
   - `countTo(el, from, to)` — счётчик: кадры `requestAnimationFrame` + генератор `spring()` из того же чанка
     (hybrid `animate` ради этого не тянем; в спайке не прототипирован — hybrid-счётчик проверен, (a));
   - `setReducedMotion(on)` / `motionReduced()` — системный `prefers-reduced-motion` **или** личный выключатель
     «Уменьшить движение». Каждая функция обёртки проверяет его сама: библиотека reduce **не учитывает** (спайк, (d)).
   - пружины — только именованные пресеты в обёртке: `SPRING = { visualDuration: 0.2–0.3, bounce ≤ 0.15 }`.
3. **Не использовать:** `motion/react` (`motion.*`, `m`, `LazyMotion`, `AnimatePresence`, `layout`, `layoutId`) —
   29–43 КБ, layout-анимации считаются на main thread, MotionValue в `style` ломается о `secure-jsx`, а `popLayout`
   нарушает CSP; hybrid `animate` (20 КБ, пружины `x/y` — кадры main thread); `animateView` (нарушает CSP; свой
   `viewTransition` в `src/motion.ts` остаётся).
4. **Первые места применения** (каждое — отдельный PR с замером `perf-board` на эталоне):
   1. доска: FLIP карточки после переноса/перестановки в колонке (`Board.tsx` → `flipFrom`/`flipSnapshot`), пружина
      вместо `cubic-bezier`; перетаскивание — нативный DnD, как в ADR-0007;
   2. тосты: `enter` при появлении, `exit` + FLIP соседей при уходе (`ui.tsx` `Toasts`);
   3. строки списка/Inbox при появлении/удалении (`enter`/`exit` + `flipSnapshot` на контейнере);
   4. индикатор вкладок `ds/Tabs.tsx`: FLIP одного элемента-подчёркивания между вкладками (вместо `layoutId`);
   5. `Dialog`/`SidePanel`: пружина появления через `enter`, уход остаётся CSS (`dsDialogOut`) + `Presence`.
   Счётчики — `countTo` в виджетах дашборда/отчётов.
5. **`motion:check`** расширить до подключения (иначе пружины ему невидимы, а `duration: 1` в секундах motion сейчас
   проходит как «1 мс»):
   - запрет `from "motion"` / `"motion/*"` вне `src/motionEngine.ts`, и `animate(` из motion вне `src/motion.ts`;
   - в обёртке `duration` читается в секундах (`0.2` = 200 мс) и сверяется с токенами;
   - пружина: `visualDuration` — из токенов `--dur-1…4`, полное время успокоения (скрипт считает его тем же
     `spring()`) — не дольше 500 мс; правило «≤ 450 мс» остаётся для `duration`;
   - каждая экспортируемая функция обёртки начинается с проверки `motionReduced()` (простая проверка текста).
   Сам `bundle:check` менять не нужно (ленивый чанк он уже считает в `js`/`total`), но **допуск — нужен**: на
   12.10.2026 (`npm run build && npm run bundle:check` на 747c494) запас всего ≈ 1 КБ — `js` +188.04 из +189 КБ,
   `total` +211.00 из +212 КБ; входной чанк 95.06 КБ, запас ≈ 24 КБ. Подключение `motion/mini` + `spring` требует
   согласовать **+6 КБ** `js` и `total` (чанк ≈ 5 КБ + обёртка и вызовы); `motion/react` потребовал бы +30…45 КБ.

Зависимость `motion` добавляется в `package.json` (точная версия, не младше двух недель) PR'ом первого потребителя
после принятия этого ADR; сейчас в репозитории её нет.

## Последствия

- Пружины, FLIP с прерыванием, появление/уход и счётчики — за ≈ 5 КБ gzip ленивого JS и 0.6 КБ во входном чанке
  (нужен новый допуск +6 КБ `js`/`total`, решение владельца);
  CSP не ослабляется, `dynamic.css` не растёт.
- Нет «бесплатного» `AnimatePresence`/`layout`: уход элементов из React-списков и общий элемент вкладок пишем сами
  (по образцу `Presence` и `flipFrom`). Это и есть цена отказа от `motion/react`.
- **Reduced-motion** — обязанность обёртки, библиотека его не учитывает; личный выключатель добавляется в
  «Оформление»/личные настройки (localStorage, как тема) и применяется и к CSS (`data-motion="reduce"` на `<html>` в
  тех же правилах, что `@media (prefers-reduced-motion: reduce)`).
- **VDI / без GPU:** WAAPI transform/opacity без GPU-композитинга рисуются программно; на VDI это кадры по сети.
  Пружина длиннее кривой (500 мс против 300) — больше кадров. Меры: только transform/opacity, FLIP — только видимым
  (не сотням карточек сразу: порог, выше — мгновенно), замер `perf-board` на эталоне до включения по умолчанию;
  выключатель «Уменьшить движение» — ответ для VDI-пользователя без системной настройки. **Не измерено** в этом спайке.
- `linear()` easing — Chrome 113, Firefox 112, Safari 17.2 (по документации, не проверено в браузере); в Safari
  17.0–17.1 из матрицы `BROWSERS.md` пружина деградирует (поведение фолбэка motion там не проверено).
- Альтернатива без зависимости, если владелец откажется от `motion`: 2–3 пресета пружины как статические токены
  `linear(…)` в `tokens.css`, сгенерированные один раз тем же `spring()`, + свой FLIP/`Presence`. Теряются пружина с
  параметрами на вызов и генератор для счётчиков; выигрыш — ≈ 5 КБ.
- Вне области: перетаскивание остаётся нативным HTML5 DnD (ADR-0007), «физика» перетаскивания не возвращается;
  навигационные переходы — свой `viewTransition` (ADR-0015); заставка; анимации в `src/dev/`.

## Источники

- `scripts/motion-spike/` (`run.mjs`, `size.mjs`, `page/`, `probes/`), `scripts/csp-spike/server.mjs` (параметр `root`).
- ADR-0007, ADR-0010, ADR-0015; `src/motion.ts`, `src/ds/Presence.tsx`, `scripts/check-motion.mjs`,
  `scripts/bundle-budget.json`, `docs/design/BROWSERS.md`, `docs/design/PERF-BUDGET.md`.

## Состояние прототипа

Тестовый стенд (ветка `claude/sharp-einstein-zj2cqs`, в `main` не идёт), 12.10.2026. Всё — через `src/motion.ts`
(`motion/mini` `animate` + `spring`, WAAPI/CSSOM); reduced-motion и незагруженный чанк — мгновенно; чанк грузится на
простое (`preloadMotionIdle` из `Toasts`, на доске — как раньше).

- **Микроанимации (13.10.2026)** — меню/поповеры (`.ds-pop`, CSS `--ease-spring` = `linear()` с перелётом ≈ 6 %,
  `transform-origin` по `data-side`), галочка чекбокса и точка радио (тот же токен), зачёркивание пункта чек-листа
  (`.cl-text`, цвет линии проявляется плавно, на каждой строке), «подпрыгивание» бейджа непрочитанных (только при росте числа) в сайдбаре и точки колокольчика
  (`usePulse` → `enter(el, "pop")`), появление нового комментария/события ленты и нового пункта чек-листа
  (`EnterScope`: первый непустой набор после показа — базовая линия, анимируется только добавленное позже).
- **Ещё микроанимации (13.10.2026, второй заход)** — уход строк списка задач (призрак на прежнем месте гаснет, нижние
  доезжают: `src/listExit.ts`), подсветка колонки-цели при перетаскивании (плавная заливка) и плашка «переход
  запрещён», плавное раскрытие `<details>` (`::details-content`, Chromium 131+), уход меню/поповеров (transition
  `display`/`overlay`, пружина на входе), «подпрыгивание» счётчиков (колонки доски, «Мои задачи»), появление карточек
  «Главной» с задержкой, подсветка поля при смене статуса/приоритета в задаче (`Flash`, `flash()`). Не сделано:
  «язычок» активного пункта сайдбара (пункты разнородны), плавная замена скелетона на контент.
- **Доска** — FLIP переноса/перестановки, перелёт между колонками, появление новой карточки (`src/boardFlip.ts`).
- **Тосты** (`ui.tsx` `Toasts`) — `enter(el, "toast")`; уход — `exit(el, "toast")`, снятый стором тост остаётся в
  DOM до конца ухода, соседи доезжают `flipFrom`. Стор и таймеры не менялись; CSS `toastIn`/`.anim-toast` удалены.
- **Dialog / SidePanel / палитра** (`ds/Dialog.tsx`) — появление `enter(el, "dialog" | "panel")` вместо CSS
  `dsDialogIn`/`dsPanelIn` (удалены); уход — прежний CSS `data-closing` + `Presence`. Попутно: правило `[open]` с
  `dsDialogIn` стояло в файле позже `[data-closing]` и перекрывало уход — закрытие анимировано не было (Chromium,
  замер `getAnimations()` до/после).
- **Вкладки** (`ds/Tabs.tsx`, все варианты, в т. ч. вкладки видов проекта) — один индикатор `glideTo()`: место по
  `getBoundingClientRect`, пружина `translate` + `scaleX`; `ResizeObserver` переставляет без движения.
- **Список задач и Входящие** (`src/listEnter.ts`) — `enter` только для строк, которых не было: первый показ, смена
  запроса/фильтра и догрузка страницы — без движения, больше 8 новых строк разом — мгновенно. Уход строк не сделан.
- Не сделано: счётчики `countTo`, уход строк списка, расширение `motion:check` (п. 5).
- Известные ограничения прототипа: снимок положений доски — один слот на модуль (`boardFlip.ts`), поэтому при нескольких
  одновременных переносах (в том числе пачкой) полностью, с подъёмом и точкой броска, анимируется последний; если сервер
  подтверждает перенос дольше `TTL_MS` (3 с), карточка проиграет вход и вспышку вместо посадки; при создании карточки
  первые ~100 мс уезжающие вниз соседи рисуются поверх неё. После сбоя загрузки чанка новая попытка — не раньше чем через 30 с.
