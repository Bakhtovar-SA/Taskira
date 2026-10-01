# Библиотека компонентов — `src/ds/`

ТЗ 5.7, решение об основе — [ADR-0014](../adr/0014-component-library-native-primitives.md). Витрина всех
состояний — `/dev/ui` (только `npm run dev`). Визуальная регрессия и axe — `npm run test:ui`
(`e2e/ui.visual.pw.ts`, эталоны в `e2e/__screenshots__`; CI — `.github/workflows/ui-visual.yml`, только на PR,
затрагивающих компоненты).

## Правила

- Экраны строятся только из `src/ds` (`import { Button } from "../ds"`). Новое поведение сначала появляется здесь,
  на `/dev/ui` и в тесте, потом на экране.
- Стили компонентов — CSS-классы `ds-*` в `src/ds/ds.css` (слой `components`): утилиты Tailwind у потребителя
  задают только раскладку (отступы, ширину), не внешний вид.
- Состояния: обычное, `:hover`, `:focus-visible` (одно кольцо на всю библиотеку — `outline`), `:active`,
  недоступное (`aria-disabled` + причина подсказкой), загрузка (`data-loading`). `data-force` — только для
  `/dev/ui` и снимков.
- Плотность — `data-density="comfortable|compact"` на `<html>`; размеры — токены `--ctl-h-*`, `--ctl-px-*`,
  `--row-h`. Переключатель появится в «Личных настройках» (ТЗ 5.9).
- Непрерывные значения (прогресс, размеры скелетона) — кастомным свойством через CSSOM (ADR-0010), не `style`.
- Поверхности верхнего слоя — Popover API и `<dialog>`. Окно, которое закрывается с анимацией, родитель держит в
  `Presence` (`<Presence show={x}>{(open) => <Окно open={open} />}</Presence>`).

## Карта «старый → новый» — миграция завершена (треки G и H, 01.10.2026)

Экраны переведены на `src/ds` в треках G (ядро задач: доска, список, карточка, окна, палитра —
[TRACK-G-DS-CORE.md](../tracks/TRACK-G-DS-CORE.md)) и H (настройки и обзорные экраны —
[TRACK-H-DS-SCREENS.md](../tracks/TRACK-H-DS-SCREENS.md)). Старые компоненты удалены из `src/ui.tsx` в G6.

| Было (`src/ui.tsx` и разметка экранов) | Стало | Как сделано |
|---|---|---|
| `className="btn-primary …"`, самодельные кнопки | `Button` (`primary` / `secondary` / `ghost` / `danger`, `sm/md/lg`) | `disabled` — строка-причина вместо `Tip` поверх кнопки |
| кнопки-иконки `h-7 w-7 … title=` | `IconButton` (`label` обязателен) | подсказку и `aria-label` даёт компонент |
| `Tip` | `Tooltip` | верхний слой; дополняет ref и обработчики ребёнка, а не подменяет (G5) |
| `Dropdown` + `MenuItem`, `DROPDOWN_OPEN_EVT` | `Menu` (действия) или `Popover` (форма, фильтр) | клавиатура APG; меню «переместить» на карточке доски (`M`) — `Menu` с управляемым `open` (G2). В модулях входного чанка — ленивые обёртки из `ds/LazyOverlay.tsx` |
| `Modal` (`variant="center"`) | `Dialog` | нативный `<dialog>`; закрытие с анимацией — `Presence` у родителя (G1) |
| `Modal` (`variant="panel"`), карточка задачи | `SidePanel` (`headless`, `size="xl"`) | адрес `?issue=KEY`, режим «страница», `J`/`K` сохранены (G4) |
| `Modal` (`variant="palette"`) | `PaletteDialog` | тот же `<dialog>` у верхней трети экрана, стекло; поле поиска — `data-autofocus` (G5) |
| `Segmented`, вкладки в `Topbar`, чипы фокуса | `Tabs` (`segmented` / `line`) | roving tabindex |
| `Switch` (`ui.tsx`) | `Switch` (`ds`) | |
| `<input type="checkbox">` с классами | `Checkbox` | `indeterminate` у «выбрать все» в списке; `labelHidden` в строках |
| радиокнопки | `RadioGroup` | |
| поля `<input>`/`<textarea>` с классами | `Input` / `Textarea` | подпись, подсказка, ошибка, счётчик символов |
| `UserSearchPicker`, `IssueSearchBox` | `Combobox` (`load(q)`) | направление и родитель в карточке — `Popover` вокруг прежнего `IssueSearchBox` (поиск на сервере) |
| `<input type="date">` | `DatePicker` | ввод словами; `min`/`max` (G6); `block` — во всю ширину узкой колонки. В «Отчётах» и спринтах пока нативные даты — перевести можно, границы теперь есть |
| `Avatar`, `AvatarStack` | `UserAvatar` / `UserAvatarGroup` (`src/components/UserAvatar.tsx`) | ds-аватар, тон по имени, фото, карточка человека в `Popover`, «не назначен» (G3) |
| `Chip`, `.meta-pill`, `Lozenge`, `RoleBadge` | `Tag` (`tone`, `dot`, `strong`) | тоны `tk-tone-*`; тон статуса — `statusTone()` (`workflowStatus.ts`) |
| `Kbd` (`ui.tsx`) | `Kbd` (`ds`) | |
| `Empty` | `EmptyState` | |
| полосы прогресса | `Progress`, `ProgressRing` | |
| `SkeletonRow`, `SkeletonCard`, `SkeletonColumn` | `Skeleton.Line/Block/Circle` | свои скелетоны экранов: `ListSkeletonRow`, `BoardSkeletonCard`, `ScreenSkeletonRow` |
| `LockedField` | `disabled="причина"` у поля; в карточке задачи — текст с замком и причиной подсказкой | |

### Что осталось в `src/ui.tsx` — намеренно

Своей пары в `ds` у этого нет: это не элементы управления, а знание о данных приложения.

- `ProjectMark`, `projectTone` — знак проекта (иконка и тон из настроек проекта, ТЗ 5.10).
- `labelTone`, `directionColor`, `catColor` — тон по тексту метки, цвет направления на таймлайне, цвета категории статуса.
- `Toasts` — очередь тостов из внешнего стора (`useToasts()`, ADR-0011).
- `BOARD_COLUMN_SHELL`, `BOARD_COLUMN_BODY` — классы колонки доски, общие для колонки и её скелетона.
- Реэкспорт `UserCardBody`, `useAvatarSrc` из `components/UserAvatar.tsx` — карточка человека с правкой профиля и
  загрузка фото.

## Концепции — утверждены владельцем 27.09.2026

Новое относительно прежнего интерфейса; на `/dev/ui` — раздел «Концепции». Показаны 26.09, владелец принял все шесть
(«давай делай» в ответ на «если согласен с концепциями, заложу их»). Новые экраны (настройки ТЗ 5.9) уже на них.

1. **Клавиша в кнопке** — `Button kbd="C"`.
2. **Недоступно с причиной** — `aria-disabled` + подсказка вместо серой немой кнопки.
3. **Срок словами** — «завтра», «пт», «+3», «через 2 недели», «15 окт» + пресеты (`src/ds/dateParse.ts`).
4. **Тост с таймером и «Отменить»** — полоса оставшегося времени, пауза при наведении.
5. **Метка: тон + точка** — цвет только у фона, кольца и точки; текст основным цветом.
6. **Мягкий аватар** — тонированный фон и инициалы тоном по имени, без цвета из базы.
