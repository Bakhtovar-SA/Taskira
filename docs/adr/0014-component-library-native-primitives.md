# ADR-0014 — Библиотека компонентов: свои компоненты на нативных `<dialog>` и Popover API + `@floating-ui/dom`

**Статус:** Accepted
**Дата:** 2026-09-26

## Контекст

ТЗ 5.7 трека 5 v2: набор компонентов на токенах ADR-0016 со всеми состояниями, доступностью и визуальными тестами;
экраны дальше строятся только из него. Нужна headless-основа для поверхностей, которые сложно сделать доступными
вручную: диалог, выезжающая панель, меню, поповер, подсказка, комбобокс, выбор даты. Критерии из ТЗ: доступность
(ловушка фокуса, ARIA), размер, совместимость с CSP (ADR-0010: `style-src 'self'; style-src-attr 'none'`, без nonce),
RTL не нужен. Пол браузеров — Safari 17 и Firefox ESR (`docs/design/BROWSERS.md`).

Текущий `src/ui.tsx` (39 КБ исходника) — источник требований: `Modal` с самодельной ловушкой фокуса, `Dropdown` с
абсолютным позиционированием и широковещательным событием `DROPDOWN_OPEN_EVT` для «закрыть остальные», `Tip` на CSS.
Их известные дефекты: выпадашка обрезается контейнером с `overflow`, а подсказка — предком со стеклом (`backdrop-filter`
делает предка контейнером для `position: fixed`; подсказку свёрнутой панели пришлось выносить в портал), у края окна
меню не переворачивается.

Замер 26.09.2026 (esbuild `--minify`, gzip -9, React вынесен):

| вариант | gzip |
|---|---|
| Radix: dialog, popover, dropdown-menu, tooltip, tabs, checkbox, radio-group, switch | 38.8 KB |
| Radix: только dropdown-menu | 30.7 KB |
| `@floating-ui/react` (позиционирование + взаимодействия) | 31.8 KB |
| `@floating-ui/dom` (`computePosition`, `autoUpdate`, `flip`, `shift`, `offset`, `size`) | 6.6 KB |

Radix Dialog, Popover и DropdownMenu в модальном режиме блокируют прокрутку через `react-remove-scroll`, а тот через
`react-style-singleton` вставляет в документ элемент `<style>` (`document.createElement('style')`). Наша CSP такой
элемент отклоняет (`style-src 'self'`, nonce нет), то есть часть поведения молча не работает. Добавлять nonce ради
библиотеки — менять CSP, чего ADR-0010 п. 7 не допускает.

Платформа за это время догнала: `<dialog>` с `showModal()` даёт верхний слой, инертный фон и `Esc`; Popover API
(`popover="auto"`) даёт верхний слой, закрытие кликом мимо и по `Esc` и «открыт только один». Оба есть на полу матрицы
(Popover API: Chrome 114, Firefox 125, Safari 17). Верхний слой снимает обе проблемы обрезки. `@floating-ui/dom`
проверен под нашей CSP спайком ADR-0010 (все режимы, 0 нарушений).

## Решение

1. **Свои компоненты** в `src/ds/` на нативных примитивах:
   - `Dialog`, `SidePanel` — `<dialog>` + `showModal()`; начальный фокус и возврат фокуса — свои, ловушку даёт инертный фон;
   - `Popover`, `Menu`, `Tooltip`, выпадающие списки `Combobox` и `DatePicker` — элемент с атрибутом `popover`
     (`auto` для поповеров и меню, `manual` для подсказки), позиция — `@floating-ui/dom` (`strategy: "fixed"`,
     `flip`, `shift`, `offset`, `autoUpdate`) присваиваниями CSSOM, как требует ADR-0010;
   - клавиатура и ARIA — по шаблонам WAI-ARIA APG (menu, tabs, combobox, radiogroup, switch, dialog).
2. **Зависимость одна:** `@floating-ui/dom` (6.6 KB gzip). Radix и `@floating-ui/react` не берём.
3. **Плотность** — атрибут `data-density="comfortable|compact"` на `<html>` и токены размеров контролов
   (`--ctl-h-*`, `--ctl-px-*`, `--row-h`), как `data-theme` (ADR-0010 п. 4).
4. **Иконки** — остаётся собственный двухтоновый набор `src/icons.tsx` (утверждён владельцем, ADR-0016), сетка 16,
   одна толщина обводки 1.5 на сетке 16; размер 20 — тот же рисунок в масштабе. Lucide (ISC) сравнили: однотонные
   линейные иконки противоречат утверждённому языку, а смешение двух наборов даёт две толщины линии.
5. `DROPDOWN_OPEN_EVT` для новых компонентов не нужен (это делает `popover="auto"`); старые `Dropdown`/`Modal`
   живут до миграции экранов (карта — `docs/design/COMPONENTS.md`).

## Последствия

- Бандл: +6.6 KB gzip вместо +31–39 KB; CSP не меняется.
- Доступность — на нас: каждое поведение (стрелки в меню, `Home`/`End`, набор букв, возврат фокуса) пишется и
  проверяется самостоятельно; `/dev/ui` и axe в визуальном прогоне — обязательная часть.
- jsdom не реализует Popover API и частично `<dialog>` — в юнит-тестах нужны заглушки; поведение верхнего слоя
  проверяется в Playwright, а не в jsdom.
- Anchor positioning в CSS заменит `@floating-ui/dom`, когда появится на полу матрицы (в Safari 17 и Firefox ESR 153
  его нет) — тогда новым ADR.

## Источники

- ТЗ 5.7 трека 5 v2; ADR-0010 (спайк CSP, floating-ui), ADR-0016; `docs/design/BROWSERS.md`.
- Замер размеров — временная сборка esbuild 26.09.2026 (цифры выше); `react-style-singleton/dist/es2015/singleton.js`.
