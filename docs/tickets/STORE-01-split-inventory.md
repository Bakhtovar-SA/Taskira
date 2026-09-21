# STORE-01 — разрезание `src/store.tsx` по доменам (ТЗ 2.3): инвентаризация

**Статус: шаги 1–4 выполнены** (шаг 2: спринты и избранное+поиск — `src/store/sprints.ts`, `favoritesSearch.ts`, общий контекст
доменных хуков `ctx.ts`; `store.tsx` ~2 030 строк). Шаг 1: (чистые функции и типы вынесены в `src/store/mappers.ts`, `store.tsx` 2 535 → ~2 150 строк);
шаги 2–6 впереди. Инвентаризация снята 2026-09-21 на `main` @ `9c46bc1`. Из PERF-06 «половина работы» уже
сделана в части данных (частичный стор, `useIssueSet`/`useEpics` в `issuePages.ts`, `issueSearch.ts`,
`boardFilters.ts`), но сам `store.tsx` вырос до **2 535 строк** и остаётся одним файлом с одним компонентом
`StoreProvider` на ~1 930 строк (строки 600–2531) и **90 замыканиями**.

## Что в файле сейчас

| Блок | Строки | Что это | Хуки/состояние |
|---|---:|---|---|
| Чистые функции и типы | 1–599 | `mapIssue`, `mapUser`, мапперы вложений/чеклиста/связей/шаблонов/спринтов, `applyNotificationAction`, `buildCreatePayload`, `canTransition`/`statusById`/`assignableUsers`, `relTime`/`fmtDate`, чтение/запись `localStorage`, интерфейс `Api` | нет — можно выносить как есть |
| Ядро `StoreProvider` | 600–817 | `data`, `ui`, `toasts`, `bootStatus`, `solo`, refs, `toast`, `handleApiError`, `me`, `can`, `requirePerm`, `withIssue`, `resolveIssue` | общая инфраструктура всех доменов |
| Уведомления + аватар | 818–907 | 90 строк | использует `setData`, `toast`, `handleApiError` |
| Boot / сессия / навигация | 908–1160 | `bootstrap`, `switchProject`, `goHome`, `enterProject`, `logout`, `refreshAssignedToMe` (253) | самый связанный: `setBootStatus` ×13, `setUi`, 3 ref-а, `switchSeqRef` |
| Список / открытие задачи | 1161–1313 | `refreshIssues`, `ensureAllIssues`, `refreshCollaborations`, `openIssue` (153) | `allIssuesInFlight`, `pendingOpenIssueRef` |
| CRUD задач | 1314–1564 | `createIssue`, `importIssues`, `updateIssue`, `moveStatus` (251) | `requirePerm` ×8, `bumpIssues` ×6 |
| Подсущности задачи | 1565–1840 | комментарии, соавторы, связи, чеклист, значения полей, вложения (276) | `withIssue` ×14, `requirePerm` ×20 |
| `deleteIssue` | 1841–1879 | 39 | `resolveIssue`, `bumpIssues`, `bumpEpics` |
| Workflow, шаблоны, кастомные поля | 1880–2065 | 186 | `pid()` ×10, `requirePerm` ×18, **без** `dataRef` |
| Участники / департаменты / проекты / LDAP | 2066–2316 | 251 | `requirePerm` ×25 |
| Спринты | 2317–2394 | 78 | `requirePerm` ×8 |
| Избранное + поиск | 2395–2440 | 46 | минимум |
| `idx` и значение провайдера | 2441–2534 | 94 | — |

## Что реально общее (то, что нельзя размазать)

Замыкания, которые используют почти все домены: `setData`, `dataRef`, `pid()`, `toast`, `handleApiError`,
`requirePerm`, `withIssue`/`resolveIssue`, `local()` (RU/EN), `bumpIssues`/`bumpEpics`. Всё остальное — локально
внутри домена. Значит разрезание — это вынос **доменных групп действий** с явным контекстом-параметром, а не
разбиение состояния: состояние (`data`, `ui`, `toasts`, …) остаётся в одном провайдере.

## Потребители и ограничения

- 32 файла вызывают `useStore()`; чаще всего берут по 2–8 полей (`data`, `can`, действия домена). Публичный API
  (`Api`, 74 поля; «90» — число замыканий в провайдере) **не меняется** — иначе разрез становится переписыванием UI.
- Тесты на `StoreProvider`: `store.test.ts`, `store.bootstrap.test.tsx`, `store.openIssue.test.tsx`,
  `store.issueLookup.test.tsx`, `store.importIssues.test.tsx`, `store.favorites.test.tsx`, `store.sprints.test.tsx`,
  `store.subtasksUx.test.tsx`, `sprints.lazy.test.tsx` и др. — должны проходить **без правок**.
- Один общий `Context`: любое изменение `data` перерисовывает всех потребителей. Разрез файла это **не** лечит
  (и не должен: смена модели подписок — отдельная задача, не «перестановка»).
  **Известное ограничение с прицелом на Трек 5 (ТЗ 5.2/5.3):** если Доска на 50 000 задач или drag&drop будут
  упираться в лишние перерисовки, никакая визуальная полировка (тени, анимации) этого не скроет. Решение —
  расщепление Context по доменам или `useSyncExternalStore` с селекторами — отдельная задача; начинать с замера
  (React Profiler на Доске/Списке при типичных мутациях), а не с рефакторинга.

## Предлагаемый порядок (по возрастанию связанности; каждый шаг — отдельный PR, тесты не трогаются)

1. **`src/store/mappers.ts` — чистые функции и типы** (строки 1–484 без `Api`/refs): нулевой риск, покрыто
   `store.test.ts`; сразу убирает ~450 строк.
2. ~~**Спринты** (78) и **избранное + поиск** (46)~~ — **сделано**: `useSprintActions(ctx)`, `useFavoritesAndSearch(ctx)`;
   массивы зависимостей `useCallback` перенесены без изменений (идентичность колбэков для потребителей та же).
3. ~~**Workflow/шаблоны/кастомные поля** (186) и **участники/департаменты/проекты/LDAP** (251)~~ — **сделано**:
   `useMetaActions(ctx)` (`store/meta.ts`), `useOrgActions(ctx, { bootstrap })` (`store/org.ts`; `bootstrap` нужен
   `deleteProject`). До выноса эти 21 действие не покрывал ни один тест — добавлен `store.metaOrg.test.tsx`
   (проверен на коде ДО выноса и после; мутации ловит). `store.tsx` ~1 590 строк.
4. ~~**Подсущности задачи** (276) и **уведомления + аватар** (90)~~ — **сделано**: `useIssueSubActions(ctx, { withIssue,
   langRef })` (`store/issueSub.ts`), `useNotificationActions(ctx)` (`store/notifications.ts`; `storeCtx` пришлось создавать раньше —
   перед блоком уведомлений). Покрытие до выноса было только у `addComment`: добавлен `store.issueSub.test.tsx` (8 тестов,
   зелёные на коде ДО выноса и после; две мутации ловит). `store.tsx` ~1 210 строк.
5. **CRUD задач + `deleteIssue`** (290): `bumpIssues`/`bumpEpics`, оптимистичные правки.
6. **Boot/сессия/навигация + список/открытие задачи** (400): последними — тут `switchSeqRef`, гонки и
   `pendingOpenIssueRef` (см. пометки в CLAUDE.md про `upsertIssue` и `bootstrap`).

Приём: `type StoreCtx = { setData; dataRef; pid; toast; handleApiError; requirePerm; withIssue; resolveIssue; local;
bumpIssues; bumpEpics }` собирается один раз в ядре; `useXxxActions(ctx)` возвращает объект действий; провайдер
разворачивает их в `Api`. Файлы — `src/store/<domain>.ts`, `src/store.tsx` остаётся фасадом (`StoreProvider`,
`useStore`, реэкспорт прежних имён, чтобы импорты в 32 файлах не менялись).

## Как проверять каждый шаг

`npm run typecheck` + `npm test` + `npm run build`; плюс дешёвая защита от потери поля при переносе — `src/store.api.test.tsx`: ключи значения `useStore()`
сверяются с зафиксированным списком из 74 полей (добавлен в шаге 1; мутация «поле убрано из значения провайдера» валит
тест и typecheck). Мутационно:
убрать действие из вынесенного хука → падает typecheck (`Api`) и соответствующий store-тест.

## Не в скоупе

Смена модели подписок (селекторы/раздельные контексты), перенос состояния в reducer/внешнюю библиотеку, правка
поведения. Открыто: измерение стоимости перерисовок от общего контекста — только если появится жалоба на производительность UI.
