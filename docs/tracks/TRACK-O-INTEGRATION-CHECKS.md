# Трек O — локальная интеграция, 18.10.2026

Работа, зависимости, dist, кэш и временные артефакты находятся на D:. GitHub main повторно проверен18.10: ff9c8ff0b0eca2f23c456b6e340cfb1794d16fea, новых коммитов нет. Общая интеграция остаётся локальной; публикуются отдельные темы. Слияния в main нет.

## Проверенный состав и результаты

Все ранее проверенные темы и C10, D15, D13, D14, D16, D04, D08а собраны вместе. Полный unit-прогон на b242748:128 файлов /1124 теста PASS, maxWorkers1,274.54с. После найденного landmark-исправления toast дополнительно10 unit в2 файлах PASS; клиентский typecheck на187926d PASS.

Первый итоговый production Chromium прогон:73/77 PASS,4 календарных axe-проверки обнаружили toast portal вне landmarks. Исправлен именованным локализованным region без изменения announcer status. Повтор затронутых calendar/Undo/success/toast:20/20 PASS за1.6мин, включая все4 прежних axe. Это совокупное покрытие77 сценариев, не заявление о едином чистом повторе всех77 после исправления. Сохраняются normal/system/personal reduce, точные geometry/scroll assertions и настоящий production CSP.

DEV Stand после согласования C07/C08 видимости:6/6 PASS за55.9с. Cap-сцена сохраняет7 строк после удаления7, чтобы scroll clip не обрезал кандидатов; ожидает ровно6 ghosts и полную видимость7 кандидатов. Frozen Counter запускается в viewport. Реальный ToastScene сохранён, удалён только неиспользуемый primitive enter(toast).

CI #214 выявил раннее измерение заголовка длинной колонки. A06 settle/settleScroll применены без изменения0.1px допуска; точный production-сценарий10/10 повторов PASS, исправление отправлено в #198 и #214. Последний известный CI #214 зелёный.

Undo: первоначальные101 server test в9 файлах PASS на отдельном PostgreSQL17.11. После полного CI обновлены точные additive bulk-response assertions: activity, integrationOutbox, access/crossProject и issuesUndo —160/160 PASS в4 файлах18.10. Собственный loopback PostgreSQL3545 остановлен. Runtime после landmark-исправления не менялся.

Production build после landmark исправления: total440678, JS401688, CSS38990, entry99617, initial JS201250 байт gzip. W0 #193 budget PASS; базу и допуски продуктовые темы не меняют. Последующие коммиты затрагивают DEV/test/docs, production runtime соответствует bd72dc0. Motion AST1176 CSS /28 keyframes /201 JS PASS; spring/docs/map guards PASS,125 записей карты.

## Публикация

Прямое разрешение владельца «отправляй и продолжай» получено17.10; прежний отказ автоматической проверки публикации разрешён этим указанием. Созданы draft PR:

| PR | Пункт O |
|---|---|
| [209](https://github.com/Bakhtovar-SA/Taskira/pull/209) | C06 реестр MOTION, зависит от #196 |
| [210](https://github.com/Bakhtovar-SA/Taskira/pull/210) | C08 cap видимых CountUp |
| [211](https://github.com/Bakhtovar-SA/Taskira/pull/211) | D03 skeleton→content |
| [212](https://github.com/Bakhtovar-SA/Taskira/pull/212) | D06 pending и одобренный черновик |
| [213](https://github.com/Bakhtovar-SA/Taskira/pull/213) | D07 одобренный Undo; W0 #193 |
| [214](https://github.com/Bakhtovar-SA/Taskira/pull/214) | C10 небольшие исправления; A06 #198 |
| [215](https://github.com/Bakhtovar-SA/Taskira/pull/215) | D15 спринты; C07 #205 и W0 #193 |
| [216](https://github.com/Bakhtovar-SA/Taskira/pull/216) | D13 сводка фильтров |
| [217](https://github.com/Bakhtovar-SA/Taskira/pull/217) | D14 даты роудмапа |
| [218](https://github.com/Bakhtovar-SA/Taskira/pull/218) | D16 success/checklist |
| [219](https://github.com/Bakhtovar-SA/Taskira/pull/219) | D04 календарь после native/focus spike |
| [220](https://github.com/Bakhtovar-SA/Taskira/pull/220) | D08а старые закрытые; C07 #205 и W0 #193 |

На18.10 CI #209–220 зелёный, включая полный PostgreSQL14–17 matrix Undo и календарный ui-visual. Не заменять фактический CI статус этим снимком.

## Открыто

- B01: инструмент с настоящими performance/RAF прошёл self-tests и технические smoke; полный тройной прогон трёх профилей ещё впереди. Fake-clock числа отклонены. S6/40 widgets превышает реальный лимит24, S8/30s polling отсутствует: эти варианты остаются unmeasured, замены явно supplemental.
- C03: решение по сайдбару после S3 на трёх профилях. C04: custom autoscroll только после ручной отрицательной проверки хотя бы одного движка; такой проверки пока нет.
- D05: отдельный изолированный прототип,50 unit,10 native CSP/focus/fallback и3 React Stand PASS, normal build не содержит issue-hero. В общую интеграцию/продукт не включён; Safari18/Firefox144 и внешняя приёмка остаются gate. ADR не создавался.
- D10 ожидает ответа владельца про updatedBy/нейтральный highlight. Неподтверждённое продуктовое решение не реализовано.
- B02 ручные Safari/Firefox/reader/VDI/RDP/touch, B03 Linux goldens и QA владельца открыты. Windows goldens не обновлялись. Прежний мобильный layout-дефект спринтов воспроизведён до D15 и отдельно указан в его отчёте.

Предыдущий контрольный снимок93c4d4c:1086 unit и47 production PASS. Новый отчёт уточняет более позднюю проверку и не объявляет весь O завершённым.


## Дополнение: проверки18.10

- #221 — отдельный D05 прототип; CI нашёл7 падений из-за двойного h1 отчётов/дашбордов в D17. Удалены только синтетические fallback h1 для этих двух видов в #208 (6a40411), зависимость #221 обновлена766bca9. Повтор CI идёт; локальная измеряемая Integration не менялась.
- #222 — B01 инструмент f457fa3: native clocks, подготовка при CPU1× и запрошенный throttle до измеряемого действия, строгие маршруты API, инкрементальные raw и штатная остановка между сценариями. Полная матрица171 попытка идёт на неизменённой production Integration; прежние fake-clock и незавершённые результаты не являются итогом.
- #223 — B03, десять midpoint-снимков. Linux goldens и браузерная QA ещё открыты; Windows goldens не создаются. QA сохраняет native Animation/finished, считает delay+activeDuration/2 и прилагает состояние до/после снимка.
- #224 — B04, подготовленные live board/Inbox и DEV axe/focus/reduce/AX-tree проверки. CI выполняется; это не заявление о пройденной доступности. Ручные readers/другие движки остаются открыты.
- C03 contain:layout эксперимент8135eb0 сохранён в отдельном D worktree. Не собран, не измерен и не включён в Integration; существующий card content-visibility сохранён.
