# INT-12 — Клиент: раздел «Повторяющиеся задачи» в настройках проекта

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0030 · **Зависит от:** INT-11 · **Блокирует:** INT-16

## Цель

Менеджер настраивает правило, видит ближайшие запуски и историю. Участник видит то же только для чтения.

## Файлы

Создать:
- `src/components/settings/ProjectRecurring.tsx` (ленивый), `src/components/settings/RecurringRuleForm.tsx`;
- `src/recurrenceText.ts` — человекочитаемое описание расписания через словарь: «Каждый понедельник в 09:00»,
  «Каждые 2 недели: пн, ср», «Последний день каждого месяца»;
- `src/recurrenceText.test.ts`, `src/components/settings/ProjectRecurring.test.tsx`.

Изменить:
- `src/settings/sections.ts` — `projectSettings` += `"recurring"` после `"templates"`; `src/settings/access.ts` —
  `READY`.
- `src/components/settings/ProjectSettings.tsx`, `SettingsView.tsx` — страница, иконка (`IcCalendar` или `IcUndo` из
  набора).
- `src/api/index.ts` — `recurringApi` (`config`, `list`, `create`, `update`, `remove`, `pause`, `resume`, `runNow`,
  `preview`, `runs`).
- `src/i18n/ru.ts`, `en.ts` — `settings.section.recurring`, `settings.desc.recurring`, `recurring.*`,
  `recurring.schedule.*`, `recurring.result.*`, `recurring.paused.*`.
- `src/components/WorkflowView.tsx` (раздел «Шаблоны задач») — ошибка `TEMPLATE_IN_USE` через `errText` при удалении
  шаблона.

## Задание

1. **Список правил**:
   - имя;
   - шаблон;
   - расписание текстом (`recurrenceText`);
   - «Следующий запуск» в поясе правила с подписью пояса, если он отличается от пояса браузера;
   - последний результат тегом с текстом;
   - состояние — «Пауза: вручную» или «Пауза: у владельца больше нет доступа — сохраните правило заново».

   Действия в `Menu` «⋯»: «Изменить», «Запустить сейчас», «Пауза» / «Возобновить», «История», «Удалить». Без
   `manageRecurring` — только «История». Проверка через `can("manageRecurring")`; в списке прав доступа проекта право
   отображается из матрицы автоматически.
2. **Форма** (`Dialog`, `RecurringRuleForm`), поля по треку L §7:
   - шаблон — нативный `<select>` в стиле `WorkflowView.tsx`; пусто — ссылка «Создайте шаблон задачи» в раздел
     «Шаблоны»;
   - расписание — `Tabs` «Ежедневно / Еженедельно / Ежемесячно»;
   - «каждые N» — числовой `Input` с пределами схемы;
   - дни недели — 7 кнопок с `aria-pressed`, первый день — понедельник, подписи из словаря;
   - день месяца — числовой `Input` 1–31 или флажок «Последний день»;
   - время — `Input type="time"`;
   - пояс — `Combobox` по `Intl.supportedValuesOf("timeZone")`, по умолчанию `config.defaultTimeZone`;
   - дата начала — `DatePicker`;
   - исполнители — `Combobox` над `usersApi.pickable`, до 10;
   - «Срок через N дней» — пусто = без срока;
   - `Checkbox` «Не создавать, если предыдущая задача ещё открыта»;
   - название с подсказкой «`{date}` заменится датой запуска».

   Под формой — «Ближайшие запуски»: `recurringApi.preview` с debounce 300 мс, 5 дат в поясе правила. При ошибке
   валидации — текст ошибки вместо списка, без тоста.
3. **История** — `SidePanel`: запуски (`runs`), дата наступления, результат, ключ задачи (открывает задачу панелью),
   «пропущено N» при `missedCount > 0`, выпавшие исполнители.
4. Пусто: «Правил пока нет. Правило создаёт задачу из шаблона по расписанию» + кнопка (если есть право).
   `config.enabled === false` → предупреждение с тегом `env` `RECURRING_ENABLED`.
5. Событие истории задачи `created` с `ruleName` показывается как «создал(а) задачу по расписанию «X»» —
   `activityText.ts`, ключ `activity.createdByRule` (добавлен в INT-11; здесь проверить отображение).

## Тесты

- `recurrenceText.test.ts`: daily every 1 и 3; weekly будни, выходные, каждые 2 недели; monthly 15 и последний день;
  RU и EN, плюралы через `tn`.
- `ProjectRecurring.test.tsx` (моки `./api`):
  - без права — нет кнопки создания и пунктов правки;
  - создание → `create` с телом по схеме (дни недели как числа 1–7);
  - смена расписания вызывает `preview` один раз после паузы (fake timers);
  - пауза из-за владельца показывает объяснение;
  - `TEMPLATE_IN_USE` при удалении шаблона — текст из словаря.
- `cyrillicGuard.test.ts` проходит.

## Критерии приёмки

- В корне `npm run typecheck && npm test && npm run build && npm run bundle:check && npm run colors:check &&
  npm run antilist:check` — зелёно.
- `npm run test:ui`: снимок раздела и формы в обеих темах, axe без нарушений.

## Не входит

Расчёт расписания на клиенте (его делает только сервер — `preview`); правила вне настроек проекта.

## Риски и откат

Путаница с поясом. Защиты: пояс всегда подписан у дат, если отличается от браузерного; предпросмотр считается на
сервере. Откат — revert.
