# INT-08 — Клиент: раздел «Интеграции» в настройках проекта

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0028, 0013 · **Зависит от:** INT-05 · **Блокирует:** INT-16

## Цель

Глобальный администратор в настройках проекта создаёт вебхук, один раз копирует секрет, проверяет связь, видит
журнал доставок и повторяет неудачные.

## Файлы

Создать:
- `src/components/settings/ProjectIntegrations.tsx` — ленивый чанк;
- `src/components/settings/WebhookDeliveries.tsx` — `SidePanel` журнала;
- `src/components/settings/SecretOnceDialog.tsx` — общий диалог «секрет один раз» (нужен и в INT-09);
- `src/components/settings/ProjectIntegrations.test.tsx`.

Изменить:
- `src/settings/sections.ts` — `projectSettings` += `"integrations"` после `"modules"`.
- `src/settings/access.ts` — `ADMIN_ONLY_PROJECT` += `"integrations"`; `READY.projectSettings` += `"integrations"`.
- `src/components/settings/ProjectSettings.tsx` / `SettingsView.tsx` — страница и иконка раздела (`IcLink` или
  существующая из `src/icons.tsx`; новую иконку не рисовать).
- `src/api/index.ts` — `webhooksApi` (`list`, `create`, `update`, `remove`, `rotateSecret`, `ping`, `deliveries`,
  `delivery`, `redeliver`, `redeliverFailed`), `integrationsApi.config`. Типы — `import type` из
  `server/src/contract`.
- `src/i18n/ru.ts`, `en.ts` — блок `// трек L`: `settings.section.integrations`, `settings.desc.integrations`,
  `integrations.*`, `webhook.event.*`, `webhook.state.*`, `webhook.error.*`, `secretOnce.*`.
- `src/router.test.ts` (или где проверяются адреса настроек) — `/p/KEY/settings/integrations`.

## Задание

1. **Выключено в env** (`config.webhooksEnabled === false`): карточка с объяснением, тег `env` и именами
   `WEBHOOKS_ENABLED`, `WEBHOOK_ALLOWED_TARGETS`, `WEBHOOK_SECRET_KEY`, ссылка на справку. Формы нет. Список
   существующих подписок показывается только для чтения.
2. **Список подписок** (`SettingsCard`): имя, `urlDisplay` (моноширинно, `--font-code`), события тегами, состояние
   тегом **с текстом**, для `disabled` — причина (`webhook.disabledReason.*`) и кнопка «Включить», «Последний
   успех» относительным временем. Действия в `Menu` «⋯»: «Изменить», «Проверить связь», «Журнал», «Сменить секрет»,
   «Пауза» / «Возобновить», «Удалить» (подтверждение `Dialog`).
3. **Форма** (`Dialog`):
   - название;
   - URL, с подсказкой «разрешённые адреса задаёт администратор сервера» и списком `allowedTargets`;
   - события — шесть флажков `Checkbox` с описанием каждого.
   Ошибка `WEBHOOK_TARGET_NOT_ALLOWED` показывается под полем URL через `errText`. При редактировании поле URL пустое
   с плейсхолдером `urlDisplay`: пустое значение — «не менять».
4. **SecretOnceDialog**: поле только для чтения, «Копировать» (`navigator.clipboard.writeText`, тост «Скопировано»),
   текст «Больше не покажем». Кнопка «Готово» активна только после галочки «Я сохранил(а) секрет». Escape и
   крестик требуют той же галочки (вызвать `preventDefault()` на Escape — см. Gotchas `CLAUDE.md`). Для смены
   секрета дополнительно: «Прежний секрет действует до {time}».
5. **Проверить связь**: `ping` → строка состояния под подпиской «Отправлено…» → опрос
   `GET …/deliveries/:id` раз в секунду до 15 с → «Доставлено, ответ 200 за 85 мс» или текст ошибки по
   `lastError`/`lastStatus`.
6. **Журнал** (`WebhookDeliveries`, `SidePanel` справа):
   - таблица: время, событие, задача (ключ-ссылка — открывает задачу панелью), состояние тегом, попытки, ответ;
   - фильтр по состоянию (`Tabs`: все / неудачные / в очереди);
   - «Показать ещё» по курсору;
   - строка раскрывается в детали: тело запроса JSON (`<pre>` с `--font-code`), выдержка ответа;
   - кнопка «Повторить» у каждой доставки, «Повторить неудачные за 24 ч» сверху (подтверждение с числом из ответа).
7. Состояния загрузки, ошибки и пусто — как в `OrgSettings` (`Loading`, `Failed`, строка-объяснение с кнопкой
   «Добавить вебхук»).
8. Без новых цветов. Теги — существующие тона `Tag`.

## Тесты (`ProjectIntegrations.test.tsx`, моки `./api` по форме ответов INT-05)

- `webhooksEnabled=false` → есть объяснение с `WEBHOOKS_ENABLED`, нет кнопки создания.
- Создание → открывается `SecretOnceDialog` с секретом. «Готово» заблокирована до галочки. Escape без галочки не
  закрывает.
- Ошибка `WEBHOOK_TARGET_NOT_ALLOWED` → текст под полем URL на RU и EN (через `I18nProvider`).
- Подписка `disabled/failing` → видна причина и кнопка «Включить» → вызывается `update({ state: "active" })`.
- Журнал: фильтр «неудачные» передаёт `state=failed`; «Повторить» вызывает `redeliver`.
- Раздел не виден в `allowedSections` не-администратору (юнит-тест `access.ts`).
- `cyrillicGuard.test.ts` проходит — русских строк вне словаря нет.

## Критерии приёмки

- В корне `npm run typecheck && npm test && npm run build && npm run bundle:check && npm run colors:check &&
  npm run antilist:check` — зелёно.
- `npm run test:ui`: снимок раздела в светлой и тёмной теме, axe без нарушений (добавить сценарий в `e2e/`).

## Не входит

Организационный обзор всех вебхуков (только экран состояния, INT-15); справка (INT-16).

## Риски и откат

Секрет может не попасть к пользователю, если диалог закрылся случайно. Защита — галочка и `preventDefault`. Если
секрет всё же потерян, его можно сменить. Откат — revert, сервер не затронут.
