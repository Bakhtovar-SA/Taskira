# Трек G — переход ядра задач на новые компоненты (`src/ds`): окна, меню, доска, список, карточка задачи

**Исполнитель:** Claude. **Параллельно идёт трек H (Codex): тот же переход для настроек, шапки, справки и обзорных
экранов** — `docs/tracks/TRACK-H-DS-SCREENS.md`. Файлы не пересекаются.

## Зачем

Владелец (30.09.2026, видео) увидел, что окна и анимации ведут себя по-разному. Окна на новом `<dialog>` (часть F) уже
закрываются плавно, а большинство — создание задачи, карточка, импорт, массовые действия — всё ещё на старом `Modal` из
`ui.tsx`: без анимации закрытия, с самодельной ловушкой фокуса. Меню на старом `Dropdown` с ручным
`DROPDOWN_OPEN_EVT`. Трек G переводит на `src/ds` ядро работы с задачами, где эти окна и меню живут.

## Файлы трека G

| Файл | Что переводится |
|---|---|
| `src/components/CreateIssueModal.tsx` | `Modal` → `Dialog`; `Chip` → `Tag`; `AvatarStack` → `UserAvatarGroup`; поля → `Input`/`Textarea`/`DatePicker` |
| `src/components/ImportModal.tsx` | `Modal` → `Dialog`; флажок «включая закрытые» → `Checkbox` |
| `src/components/BulkBar.tsx` | `Dropdown`/`MenuItem` → `Menu`; `Modal` подтверждения → `Dialog` |
| `src/components/Board.tsx` | меню «переместить» на карточке (клавиша `M`) → `Menu` с управляемым `open`; `Dropdown` → `Menu`; `AvatarStack` → `UserAvatarGroup`; `SkeletonCard` → `ds` |
| `src/components/Backlog.tsx` | `MenuItem`/`Dropdown` → `Menu`/`Popover`; `Chip`/`Lozenge` → `Tag`; флажки → `Checkbox` (`indeterminate` у «выбрать все»); `SkeletonRow` → `Skeleton` |
| `src/components/IssueModal.tsx` | `Modal variant="panel"` → `SidePanel` (последним: свой адрес и `J`/`K`, ADR-0013 §3); `LockedField` → `disabled="причина"`; `UserSearchPicker`/`IssueSearchBox` → `Combobox`; срок → `DatePicker`; `Chip`/`Lozenge` → `Tag`; меню → `Menu` |
| `src/components/CommandPalette.tsx` | `Modal variant="palette"` → свой `<dialog>` (без шапки `Dialog`: у палитры своя клавиатура) |
| `src/ds/*` | чего не хватает экранам обоих треков (раздел «Нужно в ds» трека H) |

## Порядок

1. **G1 — окна:** `CreateIssueModal`, `ImportModal`, `BulkBar` → `Dialog`. Сверить: Esc, фокус внутрь и назад, клик по
   подложке, плавное закрытие; характеризационные тесты (`backlog.characterize`, `store.importIssues`) зелёные.
2. **G2 — меню:** `Board` (включая `M`), `BulkBar`, `Backlog` → `Menu`/`Popover`; `DROPDOWN_OPEN_EVT` у этих мест уходит.
3. **G3 — содержимое доски и списка:** `Tag`, `Checkbox`, `Skeleton`; аватары людей — `UserAvatar`/`UserAvatarGroup`
   (`src/components/UserAvatar.tsx`: ds-аватар + фото, карточка пользователя в `Popover`, «не назначен»). Старые
   `Avatar`/`AvatarStack` в `ui.tsx` с G3 — обёртки над ними, так что вид сменился во всём приложении сразу.
4. **G4 — карточка задачи:** поля, `Combobox`, `DatePicker`, затем `SidePanel` с сохранением адреса `?issue=KEY`, режима
   «страница» и `J`/`K` (`issueModal.characterize.test.tsx` — зелёный, утверждения не ослаблять).
5. **G5 — палитра** на свой `<dialog>`.
6. **G6 — уборка после слияния трека H:** удалить из `ui.tsx` всё, что больше никем не используется (`Modal`,
   `Dropdown`, `MenuItem`, `Tip`, `Switch`, `Chip`, `Lozenge`, `RoleBadge`, `Kbd`, `Empty`, `LockedField`, `Skeleton*`,
   `SkeletonCard`, `Avatar`, `AvatarStack`, `DROPDOWN_OPEN_EVT`, если не осталось подписчиков); обновить `COMPONENTS.md` (строки карты — «сделано») и `CLAUDE.md`
   (раздел про `<Dropdown>` и `<Modal>` в «Gotchas» описывает старые компоненты).

## Готово, когда

- В файлах трека G нет импортов старых компонентов из `../ui`. Остаются в `ui.tsx` намеренно — у них нет пары в `ds`, и
  ими пользуются и другие экраны: `ProjectMark`, `projectTone`, `directionColor`, `catColor`, `Toasts`, `UserSearchPicker`
  (последний уходит, когда его заменит `Combobox` в G4).
- Замер открытия и закрытия окон (скрипт кадров из PR части F) — не хуже, чем у `Dialog` в части F.
- `typecheck`, `test`, `build`, `bundle:check`, `colors`, `contrast`, `motion`, `antilist`, `test:ui` — зелёные.
- Ручная проверка — `docs/MANUAL-CHECK-TRACK-G.md`.

## Как не мешать друг другу

**Запросы трека H в `ds`** (раздел «Нужно в ds» в файле трека H) G разбирает в начале каждого своего шага и в тот же день
отвечает в том же разделе: «сделано в PR …» или «не будет — чем заменить». Пока ответа нет, экран H остаётся на старом
компоненте, а не ждёт.

То же, что в треке H, с другой стороны: не трогать файлы трека H; новые ключи словаря — блоком `// трек G` в конце
`ru.ts`/`en.ts`; `COMPONENTS.md`, `CLAUDE.md` и удаление старого из `ui.tsx` — только в G6, после слияния обоих.
