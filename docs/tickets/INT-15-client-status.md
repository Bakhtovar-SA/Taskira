# INT-15 — Клиент: экран «Состояние системы»

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0031, 0013 · **Зависит от:** INT-14 · **Блокирует:** INT-16

## Цель

Администратор с одного экрана видит, что в порядке, что требует внимания и куда идти чинить.

## Файлы

Изменить:
- `src/components/settings/OrgSettings.tsx` — функция `Health()` заменяется компонентом из нового файла.
- `src/api/index.ts` — `adminApi.status()`, `adminApi.opsRuns(kind)`.
- `src/i18n/ru.ts`, `en.ts` — `status.check.*` (11), `status.state.*` (5), `status.fact.*`, `status.action.*`,
  `status.ops.*`. Обновить `settings.desc.health`.

Создать:
- `src/components/settings/SystemStatus.tsx`, `src/components/settings/SystemStatus.test.tsx`.

## Задание

1. Заголовок раздела прежний («Состояние системы», `/admin/health`). Под ним строка-сводка:
   - «Всё в порядке», если нет `fail` и `warn»;
   - иначе «Сбоев: N · Требует внимания: M» через `tn`.

   Справа «Обновить» и время проверки (`checkedAt`), версия.
2. Карточки проверок: сначала `fail`, затем `warn`, `unknown`, `ok`, `off`. В карточке:
   - название;
   - тег состояния **с текстом** (тоны: `fail` — red, `warn` — amber, `ok` — green, `off`/`unknown` — нейтральный);
   - 1–3 факта, отформатированных по словарю (относительное время, размеры через `Intl.NumberFormat`, числа);
   - ссылка-действие.

   Действия:

   | Проверка | Действие |
   |---|---|
   | `jobs`, `mail` | «Обслуживание» → `/admin/maintenance` |
   | `license` | «Лицензия» → `/admin/license` |
   | `ldap` | «LDAP» → `/admin/ldap` |
   | `webhooks` | список проектов с отключёнными подписками нет в ответе — ссылка «Справка: вебхуки» (`/help#webhooks`) |
   | `recurring` | «Справка: повторяющиеся задачи» |
   | `backup`, `restoreDrill` | раскрывающийся список последних 5 запусков (`opsRuns`) и ссылка «Как настроить таймер» на `/help#backup` |
   | `search`, `database`, `storage` | текст предупреждения и ссылка на справку |

   Предупреждения поиска и неприменённые миграции, которые раньше показывал этот экран, переходят в факты проверок
   `search` и `database`. Ничего из старого экрана не теряется.
3. Загрузка — `SkeletonCard` × 4. Ошибка всего запроса — `Failed` с повтором. Проверка `unknown` — «Не удалось
   проверить» без деталей ошибки.
4. Без автообновления и без опроса.
5. Доступность: карточки — список `<ul>`, состояние в тексте тега, раскрывающиеся списки — `<details>`/`<summary>` или
   кнопка с `aria-expanded`.

## Тесты (`SystemStatus.test.tsx`, мок `adminApi.status` по форме `SystemStatusDto`)

- Порядок карточек: `fail` раньше `warn` раньше `ok`.
- Сводка «Сбоев: 1 · Требует внимания: 2» и «Всё в порядке» — RU и EN.
- `backup` с `lastResult: "interrupted"` → текст «прервано».
- Раскрытие `backup` вызывает `opsRuns("backup")` один раз.
- `unknown` → «Не удалось проверить».
- Ссылка `jobs` ведёт на `/admin/maintenance`.
- `cyrillicGuard.test.ts` проходит.

## Критерии приёмки

- В корне `npm run typecheck && npm test && npm run build && npm run bundle:check && npm run colors:check &&
  npm run contrast:check && npm run antilist:check` — зелёно.
- `npm run test:ui`: снимок экрана с набором из `ok`/`warn`/`fail` в обеих темах, axe без нарушений.

## Не входит

История состояний, графики, оповещения.

## Риски и откат

Регресс раздела «Состояние системы»: прежние предупреждения должны остаться видны (тест на `search`). Откат —
revert к прежнему `Health()`.
