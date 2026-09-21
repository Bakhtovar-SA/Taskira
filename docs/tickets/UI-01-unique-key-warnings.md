# UI-01 — React «unique key» warnings on nearly every screen (dev mode)

**Статус: открыт, не чинится сейчас.** Найдено при обходе PERF-06 (2026-09-21).

- **Файл:** `src/secure-jsx/jsx-runtime.ts` (`jsx` / `jsxs` / `jsxDEV` = один `secured`), подключён через
  `jsxImportSource: "#secure-jsx"` в `tsconfig.json`. Введён коммитом `9c4d560` («security procurement artifact»).
- **Симптом:** в консоли dev-сборки `Warning: Each child in a list should have a unique "key" prop` на форме
  логина, Sidebar, Topbar, Board, `<select>` в Backlog и др. — то есть на элементах со статичными детьми, а не
  на списках без `key`.
- **Гипотеза (не проверена):** `jsxs` сообщает React, что массив `children` статичен и валидировать `key` не
  нужно; `secured` передаёт его в `createElement(type, props)` как обычный prop, и React считает его динамическим
  списком. Проверять на `jsxs` отдельно от `jsx`.
- **Не тронуто и почему:** не регрессия PERF-05/06 и не наш код в этом треке; на поведение и на production-сборку
  не влияет (предупреждения только в dev). Чинить отдельным шагом с проверкой, что `dynamicStyle` (CSP-обход
  inline-style) не ломается.
- **Проверка после починки:** dev-сборка, консоль пуста на логине/доске/списке; `npm test` (в т.ч.
  `dynamicStyle.test.tsx`) и `npm run build`.
