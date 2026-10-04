# INT-09 — Клиент: «API-токены» в личных настройках, «Сервисные записи» в организации

**Трек:** [L](../tracks/TRACK-L-INTEGRATIONS.md) · **ADR:** 0029 · **Зависит от:** INT-07 (и `SecretOnceDialog` из INT-08 — если INT-08 ещё не влит, создать его здесь, INT-08 переиспользует) · **Блокирует:** INT-16

## Цель

Пользователь выпускает и отзывает свои токены. Администратор создаёт сервисные записи, выдаёт им доступ к проектам
и токены, видит и отзывает любые токены.

## Файлы

Создать:
- `src/components/settings/PersonalTokens.tsx`, `src/components/settings/ServiceAccounts.tsx` (ленивые);
- `src/components/settings/tokens.test.tsx`.

Изменить:
- `src/settings/sections.ts` — `settings` += `"tokens"`; `orgSettings` += `"service-accounts"` после `"users"`.
- `src/settings/access.ts` — `READY` для обоих. Раздел `tokens` скрыт, если текущий пользователь сервисный — на
  практике он не входит; правило всё равно записать.
- `src/components/settings/PersonalSettings.tsx`, `OrgSettings.tsx`, `SettingsView.tsx` — страницы и иконки.
- `src/api/index.ts` — `tokensApi` (`list`, `create`, `revoke`), `serviceAccountsApi` (`list`, `create`, `update`,
  `tokens`, `createToken`, `revokeToken`), `adminTokensApi` (`list`, `revoke`).
- `src/components/PermissionsView.tsx` — в выборе участника проекта для администратора `pickable` с
  `includeService=1`; сервисная запись в списке участников с тегом «сервис» (`tokens.serviceTag`).
- `src/components/UserAvatar.tsx` (или место, где показывается автор в истории и карточке) — метка «сервис» рядом с
  именем, если `authSource === "service"`.
- `src/i18n/ru.ts`, `en.ts` — `settings.section.tokens`, `settings.section.serviceAccounts`, `tokens.*`,
  `serviceAccounts.*`.

## Задание

1. **API-токены** (`/settings/tokens`):
   - таблица: название, префикс `tsk_xxxxxxxx…`, scope тегом («чтение» / «чтение и запись»), создан, истекает
     (с предупреждением, если меньше 7 дней), последнее использование;
   - кнопка «Отозвать» с подтверждением;
   - «Новый токен» (`Dialog`): название, scope (`RadioGroup`), срок — нативный `<select>` в стиле `WorkflowView.tsx` (в `ds` нет `Select`): 30 / 90 / 180 / 365 дней;
   - после создания — `SecretOnceDialog` с полной строкой и примером
     `curl -H "Authorization: Bearer <токен>" <origin>/api/projects`;
   - текст-объяснение: токен действует с вашими правами и не открывает администрирование.
2. **Сервисные записи** (`/admin/service-accounts`):
   - список: имя, логин, активна, проекты (ключи), число активных токенов;
   - «Создать» (`Dialog`: логин, имя);
   - карточка записи (`SidePanel`): проекты с ролями и ссылкой «Управлять доступом» в «Доступ» проекта, токены с
     созданием и отзывом (как в п. 1), переключатель «Активна» с подтверждением при выключении («все токены
     перестанут работать»);
   - вкладка «Все токены» (`Tabs`): таблица `adminTokensApi.list({ active: 1 })` с владельцем и кнопкой
     «Отозвать».
3. Загрузка, ошибка, пусто — как в остальных разделах настроек. Отзыв — оптимистично убрать строку, при ошибке
   вернуть и показать тост `errText`.
4. Проверка доступности: таблицы с заголовками колонок, кнопки-иконки с `aria-label`, фокус после закрытия
   диалога — на кнопке, которая его открыла.

## Тесты (`tokens.test.tsx`)

- Создание токена → `SecretOnceDialog` показывает строку из ответа; в списке после закрытия секрета нет.
- Предупреждение «истекает через N дней» при `expiresAt` < 7 дней (через `tn`).
- Отзыв → `revoke` вызван, строка исчезла; ошибка `NOT_FOUND` → строка вернулась, тост.
- Сервисная запись: выключение требует подтверждения, вызывает `update({ isActive: false })`.
- `allowedSections("orgSettings", { isAdmin: false })` не содержит `service-accounts`.
- `cyrillicGuard.test.ts` проходит.

## Критерии приёмки

- В корне `npm run typecheck && npm test && npm run build && npm run bundle:check && npm run colors:check &&
  npm run antilist:check` — зелёно.
- `npm run test:ui`: снимки двух разделов в обеих темах, axe без нарушений.

## Не входит

Права сервисной записи в проекте настраиваются существующим разделом «Доступ», без нового экрана.

## Риски и откат

Пользователь копирует токен в небезопасное место — объясняющий текст и короткий срок по умолчанию (90 дней).
Откат — revert.
