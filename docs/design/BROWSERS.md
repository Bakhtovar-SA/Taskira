# Taskira — поддерживаемые браузеры и возможности CSS/DOM

Решение ТЗ 5.2 (трек UX), 25.09.2026. Динамические стили под CSP — [ADR-0010](../adr/0010-dynamic-styles-under-csp.md);
язык дизайна, который уже опирается на `oklch()`, `color-mix()` и `backdrop-filter`, — [ADR-0012](../adr/0012-design-language.md).

## Целевая матрица

| браузер | что поддерживаем | версии на 25.09.2026 |
|---|---|---|
| Chrome, Edge | две последние стабильные | Chrome 153–154 (154 — стабильный с 22.09.2026; с сентября 2026 Chrome выходит раз в две недели, так что «две последние» — это ≈ месяц) ¹ |
| Яндекс Браузер | две последние | движок Chromium; номер движка в двух последних версиях **не проверен** — берём пол «Chromium ≥ 140» с запасом на отставание от Chrome ² |
| Firefox ESR | текущий ESR | ESR 153 (выпущен 21.07.2026, текущий патч 153.3.0) ¹. Если заказчик ещё на ESR 140 — см. сноску ³ в таблице |
| Safari (macOS, iOS/iPadOS) | 17 и новее | пол — Safari 17 (сентябрь 2023) |

**Пол по возможностям** определяют Safari 17 и Firefox ESR; Chromium-браузеры новее всех остальных.

¹ версии проверены поиском 25.09.2026 (Chrome Releases, firefox.com release notes).
² не проверено: у Яндекс Браузера собственная нумерация, публичной таблицы соответствия движку не нашли.

## Возможности

Версии — первая версия с поддержкой по умолчанию (без флагов). Проверено в браузере **только Chromium 141** (единственный
доступный в среде спайка); остальные версии — **по спецификации/документации (MDN, caniuse), не в браузере**; строки,
подтверждённые поиском в день решения, помечены ¹.

| возможность | Chrome/Edge | Firefox | Safari | решение | как используем / фолбэк |
|---|---|---|---|---|---|
| `oklch()` | 111 | 113 | 15.4 | **нативно** | Все токены (`src/styles/tokens.css`, ≈200 мест). Фолбэк не нужен: все цели выше пола. `oklch(from …)` (относительный синтаксис) — не используем: в Safari 17 нет. |
| `color-mix()` | 111 | 113 | 16.2 | **нативно** | Подложки и кольца (`color-mix(in oklch, …)`, 20 мест). Фолбэк не нужен. |
| View Transitions API (в пределах документа) | 111 | 144 ¹ | 18 | **с фолбэком** | Только как улучшение: `document.startViewTransition ? document.startViewTransition(update) : update()`. В Safari 17 (и в Firefox ESR 140 ³) переход просто мгновенный. При `prefers-reduced-motion: reduce` — не вызываем. `view-transition-name` на карточках — кастомным свойством через CSSOM (ADR-0010), не классом на значение. Переходы между документами — не используем (SPA). Типы переходов — не используем (в Firefox 144 их нет ¹). |
| `:has()` | 105 | 121 | 15.4 | **нативно** | Можно, но не на корне доски/страницы: на 300 карточках `:has()` у предка пересчитывается на каждое изменение потомков. Только на небольших компонентах (поле формы, строка). |
| Контейнерные запросы по размеру (`container-type`, единицы `cq*`) | 105 | 110 | 16 | **нативно** | Для карточек/панелей, чья ширина не совпадает с шириной окна (правая панель задачи, колонки доски). Запросы по стилю (`style(…)` в контейнерном запросе) — **не используем**: нет в Firefox. |
| `backdrop-filter` | 76 | 103 | 18 (с префиксом `-webkit-` — с 9) | **нативно + фолбэк** | Только `.glass` (ADR-0012). В Safari 17 работает лишь `-webkit-backdrop-filter` — в `src/index.css` он указан рядом с нативным, это обязательно. Фолбэк `@supports not (…)` → непрозрачный `--bg-raised` уже есть. |
| `@property` | 85 | 128 | 16.4 | **нативно** | Для анимируемых кастомных свойств (ADR-0010 п. 3), объявлять только в статическом CSS. ESR 153 ≥ 128. |
| `prefers-reduced-transparency` | 119 ¹ | **нет по умолчанию** ¹ (за флагом `layout.css.prefers-reduced-transparency.enabled`, выключен из-за риска фингерпринтинга) | **нет** ¹ | **с фолбэком — сейчас фолбэка нет** | См. «Пробел» ниже. |

³ Firefox ESR 140: всё из исходной таблицы выше (без отдельной матрицы движения) есть, **кроме View Transitions** (появились в 144) — там сработает тот же фолбэк
«без перехода». Прочие возможности ESR 140 поддерживает (`@property` с 128, `:has()` с 121).

## Движение: совместимость по документации (C-12)

Сверено 15.10.2026 с первичным набором MDN browser-compat-data, commit
[cb1b68d](https://github.com/mdn/browser-compat-data/commit/cb1b68d8df1ae499a25112fb6e78bb148b32886e).
Это первые версии с включённой по умолчанию возможностью, а не результаты запуска Taskira.
**Все строки ниже — не проверено вручную в Safari/Firefox до B-02.** Версию настоящего ESR и движка Яндекс Браузера
нужно записывать с тестового устройства; номер продукта и номер Chromium не взаимозаменяемы.

| Возможность | Chromium | Firefox | Safari | Использование и допустимая деградация |
|---|---|---|---|---|
| [Element.animate / WAAPI](https://github.com/mdn/browser-compat-data/blob/cb1b68d8df1ae499a25112fb6e78bb148b32886e/api/Element.json) | 36 | 48 | 13.1 | Обёртка в motion.ts; поддержка метода сама по себе не доказывает поддержку linear() или доступность копий полёта. Итог операции обязан оставаться верным после отмены/сбоя. |
| [CSS linear()](https://github.com/mdn/browser-compat-data/blob/cb1b68d8df1ae499a25112fb6e78bb148b32886e/css/types/easing-function.json) | 113 | 112 | 17.2 | --ease-spring, меню и поповеры. В Safari 17.0–17.1 функция недействительна: использующее её transition может целиком отброситься после подстановки var(). Мгновенное открытие допустимо, недоступное меню — дефект. |
| [@starting-style](https://github.com/mdn/browser-compat-data/blob/cb1b68d8df1ae499a25112fb6e78bb148b32886e/css/at-rules/starting-style.json) | 117 | 129 | 17.5 | Вход .ds-pop. В Safari 17.0–17.4 и ESR 128 исходный стиль не применяется: допустимо появление без входного перехода. |
| [transition-behavior: allow-discrete](https://github.com/mdn/browser-compat-data/blob/cb1b68d8df1ae499a25112fb6e78bb148b32886e/css/properties/transition-behavior.json) | 117 | 129, частично | 17.4 | Само ключевое слово не гарантирует переход display. По BCD display/content-visibility: Chromium 117, Safari 18; Firefox ещё без поддержки этих подслучаев. Поэтому нельзя держать открытие/закрытие меню на ожидании transitionend. |
| [::details-content](https://github.com/mdn/browser-compat-data/blob/cb1b68d8df1ae499a25112fb6e78bb148b32886e/css/selectors/details-content.json) | 131 | 143 | 18.4 | .form-disclosure и .reports-chart-data: при отсутствии селектора остаётся нативное details/summary с мгновенным раскрытием. Safari не поддерживает цепочки псевдоэлементов после него; Taskira их не использует. |
| [Element.currentCSSZoom](https://github.com/mdn/browser-compat-data/blob/cb1b68d8df1ae499a25112fb6e78bb148b32886e/api/Element.json) | 128 | 126 | **26.4** | cssZoom() возвращает 1 при отсутствии API. Это числовой fallback, а не доказательство правильной геометрии под CSS zoom: проверить полёт, якорь меню и фокус при 2560/3440 px. Указание Safari 18.2 в треке O и старых комментариях исходников ошибочно. |
| [content: attr(data-shown) / ""](https://github.com/mdn/browser-compat-data/blob/cb1b68d8df1ae499a25112fb6e78bb148b32886e/css/properties/content.json) | 77 | 128 | 17.4 | Пустой альтернативный текст псевдоэлемента CountUp; итог остаётся настоящим текстом. В Safari 17.0–17.3 работает запасная content без alt: промежуточные числа могут попасть в VoiceOver, B-02 обязателен. |
| [requestIdleCallback](https://github.com/mdn/browser-compat-data/blob/cb1b68d8df1ae499a25112fb6e78bb148b32886e/api/Window.json) | 47 | 55 | Нет по умолчанию; только Preview за флагом | preloadMotionIdle() использует setTimeout, если метода нет. Отсутствие idle API не должно мешать первому действию/загрузке экрана. |
| [Document.startViewTransition(update)](https://github.com/mdn/browser-compat-data/blob/cb1b68d8df1ae499a25112fb6e78bb148b32886e/api/Document.json) | 111 | 144 | 18 | Смена темы/вида — улучшение; при отсутствии API выполняется update(), без круга темы. Системный/личный reduce и скрытая вкладка проверяются обёрткой. Междокументные и scoped transitions здесь не требуются. |

Здесь отдельно перечислены поддержка синтаксиса и поведение продукта. Проверка CSS.supports или наличие метода
не заменяют ручной прогон доступности, нативного DnD, визуальной посадки и экранного диктора.
Точный оставшийся список и форма результатов — [MANUAL-CHECK-TRACK-O.md](../MANUAL-CHECK-TRACK-O.md).

## Пробел: `prefers-reduced-transparency` работает только в Chromium

`.glass` в `src/index.css` отключает стекло по `@media (prefers-reduced-transparency: reduce)`. В Firefox (флаг выключен)
и Safari (нет вовсе) этот запрос **никогда не срабатывает** — пользователь, включивший в ОС «Уменьшить прозрачность»,
всё равно получит стекло. ADR-0012 п. 4 обещает «отключается при `prefers-reduced-transparency`» — в двух из трёх
движков матрицы это обещание сейчас не выполняется.

Решение (реализация — отдельной задачей трека):
1. Настройка «Прозрачность» в «Оформлении» (`AppearanceSettings`) — атрибут `data-glass="off"` на `<html>`, как уже
   сделано для `data-texture`; в `localStorage`, применяется `public/theme-init.js` до первой отрисовки.
2. Стекло отключается также при `prefers-contrast: more` (в Safari «Увеличить контраст» доступен через этот запрос) —
   то же правило, что уже выключает зерно.
3. `@media (prefers-reduced-transparency: reduce)` остаётся — в Chromium это работает без участия пользователя.

## Как проверять

- Движок Chromium: `npm run csp:spike` (ADR-0010) и `scripts/perf-board/run.mjs` — оба на Playwright.
- Firefox ESR и Safari 17 в среде разработки недоступны. Перед выпуском трека — ручной прогон страницы
  `scripts/csp-spike/page/` (сервер `node scripts/csp-spike/server.mjs`) и основных экранов в Firefox ESR 153 и
  Safari 17; результат дописать сюда с датой.
