# Трек H — переход экранов на новые компоненты (`src/ds`): настройки, шапка, справка, обзорные экраны

**Исполнитель:** Codex. **Параллельно идёт трек G (Claude): тот же переход для ядра задач** — доска, список, карточка
задачи, создание, массовые действия, импорт, палитра. Файлы двух треков не пересекаются — см. «Как не мешать друг
другу» внизу.

## Зачем

У Taskira две библиотеки интерфейса. Старая — `src/ui.tsx` (самодельные `Modal`, `Dropdown`, `Switch`, `Chip`, `Tip`…).
Новая — `src/ds/` на нативных `<dialog>` и Popover API: клавиатура по APG, верхний слой, плавные анимации, единые
состояния (ADR-0014). Экраны до сих пор собраны из старой, поэтому окна и меню ведут себя по-разному, а у старых нет
плавного закрытия и правильной клавиатуры. Нужно перевести экраны на `src/ds` и в конце удалить дубли из `ui.tsx`.

## Прочитать перед началом

1. `CLAUDE.md` — правила репозитория. Особенно разделы «Component library», «Theming / design tokens», «Dynamic style
   values under the CSP», «Client i18n». Он обязателен и для этого трека.
2. `docs/design/COMPONENTS.md` — **карта «старый → новый»**. Это и есть задание: каждая строка карты применяется к файлам
   ниже.
3. `src/ds/index.ts` и сами компоненты (`Button.tsx`, `Field.tsx`, `Overlay.tsx`, `Dialog.tsx`, `Display.tsx`, `Tabs.tsx`,
   `Combobox.tsx`, `DatePicker.tsx`) — их API. Витрина всех состояний — `/dev/ui` в dev-сборке (`npm run dev`).
4. `docs/adr/0014-component-library-native-primitives.md` и `docs/adr/0023-glass-without-backdrop-blur.md`.

## Файлы трека H (только эти)

| Файл | Что там из старого (по состоянию на 30.09.2026) |
|---|---|
| `src/components/settings/PersonalSettings.tsx` | `Switch`, `Avatar`, радиокнопки «Оформления», поля ввода, самодельные кнопки |
| `src/components/settings/ProjectSettings.tsx` | `Switch`, поля ввода, кнопки (в файле уже есть `Dialog` из `ds` — образец) |
| `src/components/settings/OrgSettings.tsx` | `Switch`, `Avatar`, поля, кнопки |
| `src/components/settings/*.tsx` остальные (`SettingsView`, `parts`, `Setup`, `ProjectRoadmap`) | кнопки, поля |
| `src/components/ProjectWizard.tsx` | `Switch`, `Avatar`, поля, кнопки |
| `src/components/PermissionsView.tsx` | `RoleBadge`, `Avatar`, `<select>`/кнопки |
| `src/components/WorkflowView.tsx` | `Lozenge`, кнопки, поля |
| `src/components/DocsView.tsx` | `Kbd`, `RoleBadge` |
| `src/components/Topbar.tsx` | `Tip`, `RoleBadge`, `Avatar` |
| `src/components/Sidebar.tsx` | `Kbd`, `Avatar` |
| `src/components/InboxView.tsx`, `src/components/HomeView.tsx` | `Avatar`, кнопки |
| `src/components/TimelineView.tsx` | `Lozenge`, `SkeletonRow` |
| `src/components/SprintsView.tsx` | `Modal`, `AvatarStack`, `SkeletonRow`, поля дат |
| `src/dashboards/widgets.tsx` | `Empty`, `Avatar` |
| `src/components/AdminView.tsx`, `src/components/ReportsView.tsx`, `src/components/SoloView.tsx` | кнопки, поля, `Avatar` — если есть |

Сопоставление — строго по карте `COMPONENTS.md`:

- `Modal` (`variant="center"`) → `Dialog`; `Switch` из `ui.tsx` → `Switch` из `ds`; радиокнопки → `RadioGroup`;
  `<input type="checkbox">` → `Checkbox`; поля `<input>`/`<textarea>` с классами → `Input`/`Textarea` (подпись, подсказка,
  ошибка, счётчик по `LIMITS` из `validation.ts`); `<input type="date">` → `DatePicker`.
- `Chip`, `Lozenge`, `RoleBadge` → `Tag` (`tone` — только `tk-tone-*`, никаких цветов из данных); `Kbd` → `Kbd` из `ds`;
  `Empty` → `EmptyState`; `Avatar`/`AvatarStack` → `Avatar`/`AvatarGroup`; `SkeletonRow` → примитивы `Skeleton`.
- `Tip` → `Tooltip`; самодельные кнопки (`btn-primary`, `bg-accent`, `hover:bg-hover`, иконки `h-7 w-7 … title=`) →
  `Button` / `IconButton` (у `IconButton` `label` обязателен, `title` убрать).
- Выключенное с причиной — `disabled="причина"` у `Button`/`Input`/`Switch`, а не `Tip` поверх.

## Решения, которые уже приняты (не менять)

- **Поведение экранов не меняется.** Только замена компонентов. Те же права (`can()`), те же вызовы стора, те же тексты.
  Если новый компонент не умеет чего-то, что нужно экрану, — **не дописывать `src/ds` самому**: оставить старый кусок и
  записать это в конец этого файла, раздел «Нужно в ds» (что и где). Компоненты `ds` правит трек G.
- **Модули входного чанка** (`Sidebar`, `Topbar` и всё, что они тянут) импортируют компоненты из их файлов
  (`../ds/Button`, `../ds/Display`), **не из `../ds`** — иначе бочка тянет `Overlay` в `modulepreload`, и
  `npm run bundle:check` покажет рост входного чанка (CLAUDE.md, «Component library»). Остальные экраны — можно из `../ds`.
- **Никаких сырых цветов, `style=""`, капс-подписей, длительностей не из токенов** — `colors:check`, `antilist:check`,
  `motion:check`, CSP это ловят. Позиции/размеры из данных — через `cssVars` (ADR-0010).
- **Тексты — через словарь.** Новых строк почти не будет; если нужны — ключи в `src/i18n/ru.ts` и `en.ts` (см. ниже).
  `cyrillicGuard.test.ts` падает на русском тексте в коде вне словаря.
- **`src/ui.tsx` не трогать.** Старые компоненты удаляются из него в самом конце, после слияния обоих треков, одним
  коммитом трека G — иначе второй трек сломается на слиянии.

## Порядок работы

1. По одному экрану — один коммит («Настройки → личные: ds», «Шапка: ds», …). После каждого: `npm run typecheck`,
   `npm test`, глазами в `npm run dev` в светлой и тёмной теме.
2. Существующие тесты экранов должны остаться зелёными. Если тест опирался на старую разметку (класс, `title`), —
   поменять селектор на роль/подпись (`getByRole`, `getByLabelText`); **утверждения не удалять и не ослаблять**.
3. Для каждого переведённого окна/меню — клавиатура: Tab по порядку, Esc закрывает, фокус возвращается на кнопку, из
   которой открыли.

## Готово, когда

- В файлах трека H нет импортов старых компонентов из `../ui` (кроме тех, что записаны в «Нужно в ds», с причиной).
  Проверка: `grep -nE "from \"\\.\\./(\\.\\./)?ui\"" <файлы трека>`.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run bundle:check`, `npm run colors:check`,
  `npm run contrast:check`, `npm run motion:check`, `npm run antilist:check`, `npm run test:ui` — зелёные локально и в CI.
- Axe без serious/critical на переведённых экранах в обеих темах (как в `e2e/ui.visual.pw.ts`).
- Ручная проверка — `docs/MANUAL-CHECK-TRACK-H.md`: по каждому экрану, что проверить глазами и клавиатурой.
- PR — черновик, ветка `codex/ds-screens` от свежего `main`, коммиты по-русски.

## Как не мешать друг другу (трек G идёт параллельно)

- **Не трогать файлы трека G:** `Board.tsx`, `Backlog.tsx`, `IssueModal.tsx`, `CreateIssueModal.tsx`, `BulkBar.tsx`,
  `ImportModal.tsx`, `CommandPalette.tsx`, `src/ds/*`, `src/dev/DevUI.tsx`, `src/ui.tsx`, `src/index.css`,
  `src/styles/tokens.css`, `e2e/*`, `docs/design/COMPONENTS.md`.
- **Словари.** Новые ключи трека H — одним блоком в самом конце `ru.ts` и `en.ts` с комментарием `// трек H`; старые
  ключи не переименовывать. Трек G пишет свой блок отдельно — конфликт, если будет, один непрерывный кусок.
- **`CLAUDE.md` и `COMPONENTS.md`** не править — трек G обновит их в конце по итогам обоих треков. Итог трека H — в
  конце этого файла (раздел «Сделано»): какие экраны переведены, что осталось и почему.
- Перед PR — `git merge origin/main` (не rebase), если трек G уже влит.

## Нужно в ds

| Компонент / возможность | Что сохранено и почему | Где |
|---|---|---|
| `DatePicker`: корректная структура ARIA grid | При открытом календаре axe обнаруживает `aria-required-children` / `aria-required-parent`: gridcell без родительского row. В спринтах оставлены нативные даты внутри `Input`; миграцию календаря завершить после исправления в G. | `SprintsView`; уже существующий `ProjectRoadmap` использует общий DatePicker и также ждёт исправления. |
| `DatePicker`: min/max | Не поддерживает границы диапазона. Нативные даты отчёта сохраняют взаимные min/max, формат запроса и браузерную валидацию. | `ReportsView` |
| Select | В `ds` нет Select. Существующие нативные списки оставлены, вместе с подписями и обработчиками; async-поиск участника отдела переведён на Combobox. | `PermissionsView`, `WorkflowView`, `ProjectWizard`, `ProjectSettings`, `OrgSettings`, `ReportsView` |
| `AvatarGroup`: интерактивные карточки людей | Группа `ds` показывает только Tooltip. `AvatarStack interactive` в строке спринта сохранён: иначе пропадут карточки людей. Одиночные аватары экранов переведены через `PersonAvatar` на `ds/Avatar` + Popover, фото загружает прежний hook. | `SprintsView` |
| Карточка пользователя | `UserCardBody` — общий бизнес-компонент профиля с редактированием и загрузкой фото, равнозначного `ds`-компонента нет. Его содержимое сохранено внутри новых Popover. `useAvatarSrc` — hook API, а не старый визуальный компонент. | `settings/parts`, `Topbar`, `HomeView`, `PersonalSettings` |
| Знак проекта | Нет аналога `ProjectMark`, учитывающего проектную иконку и выбранный тон. Сохранён для идентичности проекта; это не Avatar пользователя. | `Sidebar`, `Topbar`, `HomeView`, `InboxView`, `AdminView`, `ProjectWizard`, `SettingsView`, `ProjectRoadmap`, `dashboards/widgets` |
| Очередь уведомлений | `Toasts` связывает внешний стор и жизненный цикл очереди; одиночный `ds/Toast` не заменяет эту бизнес-обвязку. Перенос общего диспетчера согласовать при финальном очищении `ui.tsx` в G. | `HomeView`, `SoloView` |
| Сложный поиск | Combobox не поддерживает заголовок-переключатель области поиска, управляемый URL-запрос и две серверные модели результатов. Панель результатов сохранена; поле, кнопки, Kbd и скелеты перенесены. | `Topbar/SearchBox` |
| Предпросмотр фона и интерактивные карточки | `BgSwatch` и карточки проектов не сводятся к кнопке с одной строкой: нужны миниатюры/раздельные действия. Shared `ProjectLookPicker` находится вне H; существующие карточки/превью сохранены. | `PersonalSettings`, `HomeView`, shared `ProjectLookPicker` |
| Нативные file/range | У `ds` нет пикера файлов/ползунка. Сохранены скрытые file-input с видимой кнопкой и нативный ползунок оттенка. | Профиль, бренд, оформление проекта, гостевые вложения |
| Цвет направления | `directionColor` — функция сопоставления идентичности дорожек, не Lozenge/Chip. Сохранена для непрерывной схемы таймлайна; статусы задач уже Tag. | `TimelineView` |

## Сделано

- Перенесены оставшиеся элементы в `PersonalSettings`, `ProjectSettings`, `OrgSettings`, `SettingsView`, `Setup`,
  `ProjectWizard`, `PermissionsView`, `WorkflowView`, `DocsView`, `Topbar`, `Sidebar`, `InboxView`, `HomeView`,
  `TimelineView`, `SprintsView`, `AdminView`, `SoloView`, `dashboards/widgets`. `parts` содержит адаптеры профиля,
  ролей и статусов; `ProjectRoadmap` и `ReportsView` уже использовали `ds` и проверены с оговорками выше.
- Вкладки шапки — `Tabs` с roving tabindex; панель уведомлений, профиль и переключатель проектов — нативные
  Popover. `ScreenPopover` загружает модуль только при первом открытии: Overlay не добавлен в modulepreload.
- Настройки темы, оттенка бренда и выбора шаблона проекта — `RadioGroup`; поля и кнопки — `Input`/`Textarea`,
  `Button`/`IconButton`; метки ролей и статусов — `Tag` с токенами; загрузка строк — `Skeleton`.
- Специальная форма выбора сотрудника отдела сохраняет отдельное подтверждение «Добавить»; fieldset блокирует
  контролы во время запроса. Новый ввод сбрасывает выбранного кандидата, как раньше; отдельная регрессия не
  допускает добавление прежнего человека после изменения запроса. LDAP-участники и заполненные отделы
  показывают прежнюю причину запрета.
- `SprintsView`: нативный `Dialog` остаётся смонтированным до завершения анимации закрытия; новое открытие очищает
  черновик. Две регрессии проверяют прежний API-пayload, отказ при пустом имени, отмену, фокус и сброс.
- Новые ключи словаря не понадобились. Файлы G, `src/ds`, `src/ui.tsx`, CSS, токены и эталоны не изменены.
- Добавлен [чек-лист](../MANUAL-CHECK-TRACK-H.md). Локально: typecheck; 553 теста (73 файла); build; bundle/colors/
  contrast/motion/antilist. Браузерные проверки описаны в чек-листе, включая ограничение Windows-снимков.
- CI `ui-visual` теперь реагирует на изменения экранов/виджетов; проверка библиотеки выполняется в Linux со
  штатными эталонами. Полный результат CI следует смотреть в черновом PR `codex/ds-screens`.
