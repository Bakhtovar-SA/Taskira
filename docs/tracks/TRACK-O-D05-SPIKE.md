# Трек O — D-05: изолированный переход ключа задачи

Дата: 17.10.2026. Ветка codex/track-o-shared-issue-spike. Это эксперимент, продуктовые страницы/действия стора не подключены. Общая интеграция его не включает. ADR-0015/0035 не меняются; новый ADR до зелёной матрицы не создаётся.

## Прототип

- Только короткий одинаковый ключ (до 64 символов), одинаковый моноширинный стиль. Заголовок задачи не морфится.
- Один постоянный CSSOM view-transition-name=issue-hero перед native startViewTransition. Старое имя освобождается до установки нового внутри flushSync update; статические pseudo-element правила, без style injection/animateView.
- Владение имён ограничено одной транзакцией и двумя узлами; восстановление прежних inline значений/priority, stale cleanup не снимает нового владельца и не перезаписывает чужую последующую правку.
- Только page. Panel и узлы внутри dialog/popover отвергаются. Это отказ от поддержки top layer, а не заявление о его работоспособности.
- Только уже смонтированная тёплая цель. Холодная/lazy, скрытая, несовпадающий ключ или чужое имя сразу завершают shared snapshot; ожидания загрузки и дополнительных API-запросов нет. D17 по-прежнему фокусирует поздний заголовок.
- Системный/личный reduce, отсутствие API и скрытая вкладка сохраняют baseline. Обычная production-сборка не включает эксперимент: DEV или VITE_ISSUE_HERO_SPIKE=track-o-release1 только для изолированного зонда.
- Сцена A08 доказывает React/ref геометрию; отдельная CSP-страница вызывает реальный wrapper и настоящий browser native VT, проверяет удаление старой страницы и D17 heading focus.

## Воспроизведение

Настроить TEMP/TMP/CHROMIUM_PATH на существующее окружение. Из корня выполнить:

    npx vitest run src/issueHeroSpike.test.ts src/motion.test.ts --maxWorkers=1
    node scripts/motion-spike/run-issue-hero.mjs

ISSUE_HERO_OUTPUT задаёт путь raw JSON и PNG. Зонд собирается esbuild в TEMP, читает production CSP прямо из nginx.conf, использует собственный loopback server и закрывает его/браузер. Пробы: warm, deliberate focus, cold, panel, top layer, foreign name, wrong key, system/personal reduce, no native API. Native named-group Animation проверяется на ready; визуальный PNG не является pixel-golden.

## Gate и ограничения

- [x] Targeted unit: 2 файла / 50 тестов PASS; typecheck PASS; motion guard PASS. Docs/map guard PASS, карта118 entries.
- [x] Настоящий Chromium native VT: 10/10 PASS, 0 CSP violations, 0 API requests, 0 page errors, focus/cleanup/fallback.
- [x] A08 React/ref: 3/3 normal/system/personal PASS; native named group 200ms проверен; фокус остаётся на живом trigger. Изолированный native кадр просмотрен; внешний вид продукта не принят.
- [x] Обычный production build/budget PASS: поиск всех JS/CSS не находит issue-hero/issueHeroSpike/DEV сцены.
- [ ] Firefox 144 и Safari 18 вручную (B02).
- [ ] Приёмка внешнего вида владельцем; полная страница Inbox/My tasks/search, navigation screenshots и реальные cold routes после возможного подключения.

До завершения gate результат не даёт разрешения подключать shared element в продукте. Cold target здесь намеренно fallback; нет искусственного продления native animation для успешного теста.

## Независимая review-ветка18.10

Выделена codex/track-o-shared-key-probe от A08 #202 с D17 #208, без остальных интеграционных тем. Повторены client typecheck,35 unit (26 baseline motion +9 D05), production build/budget,10 native CSP проб и весь DEV Stand9/9 PASS. Разница с50 unit выше — отсутствие15 тестов независимых C05/C06/C08 тем в этой минимальной базе. Normal production JS/CSS не содержат issue-hero/issueHeroSpike. Новых зависимостей нет. Продуктовые bindings, Safari/Firefox и приёмка владельца остаются открытыми; в продуктовую интеграцию прототип не добавлен.
