# Трек O — D-15: спринт и бэклог

Ветка codex/track-o-sprints от258809c (Inbox/C07 foundation). Это зависимый PR; отдельный diff — SprintsView и его проверки.

- Каждый SprintIssueList владеет RowMotion/EnterTracker, хранит координаты только собственного host.
- Уход/сдвиг — перед входом; incoming task не использует координаты другой колонки. После ухода любого ID entry-history этого списка перебазируется, включая пакетную замену с той же длиной; возврат тоже является локальным входом.
- Начальная загрузка, смена scope, reduce и caps40/6/8/200 — через общие helpers. Unmount вызывает dispose.
- Ghost остаётся внутри своего scroll clipping; live query — data-issue-id, призраки лишены его.
- Заголовок задачи — нативная кнопка для клавиатуры. Удаление фокусирует соседа, последнее — именованный group списка.
- API остаётся authoritative: до подтверждения row/фокус на месте; ошибка не меняет списки.

Проверки выполнены 17.10.2026, последовательно с одним worker.

- [x] sprints.lazy + store.sprints: 2 файла / 29 unit PASS; typecheck PASS. Включён net-neutral пакетный обмен и повторный возврат. Общие motion/caps ранее проверены в C07 и интеграции.
- [x] Production Chromium2/2: round-trip, delayed API, motion/reduce; отдельные scroll hosts, фокус соседа/пустого списка и cleanup. Drop для обратного пути синтетический: native DnD и C04 этим не проверяются.
- [x] Production с настоящим CSP header, build и motion/colors/contrast/antilist/docs/permissions guards PASS. Старый JS-budget превышен на351B; требуется отдельный W0 #193, бюджет продукта не меняется.
- [x] Impeccable static detector: `[]`; git diff --check.
- [x] Desktop/mobile screenshots просмотрены. Обнаружен прежний мобильный layout-дефект; он открыт, см. ниже.

Gzip (включая C07-базу): total434326, JS395712, CSS38614, entry99890, initial JS196221 байт. Это совместный размер, не изолированный инкремент D15.

Desktop screenshot просмотрен: соседний фокус и списки в порядке. На390px панель бэклога300px почти вытесняет спринт; это подтверждено production-сборкой93c4d4c до D15 на том же fixture: заголовок спринта x347, ширина42.09px. Baseline screenshot сохранён вне Git на D. Мобильный layout не объявляется исправным.
