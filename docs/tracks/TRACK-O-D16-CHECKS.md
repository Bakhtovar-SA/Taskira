# Трек O — D-16: успех и завершённый чек-лист

Ветка codex/track-o-success-motion, база ff9c8ff. Решения ADR не меняются.

- Реальный success Toasts и DS Toast рисуют галочку drawLine300ms через --dur-4; error/info сохраняют точки. IcCheck имеет нормализованный pathLength1; соседние иконки не получают класс success-check.
- ChecklistCount подсвечивает только переход непустого чек-листа из незавершённого в завершённый при росте done. Первый показ, смена задачи, пустой список, уменьшение done или удаление незавершённого пункта не подсвечиваются.
- Reduce обрабатывает существующий flash wrapper и CSS. Нового состояния сервера/оптимистического изменения не добавлено.

17.10.2026 проверено:

- 3 файла /11 unit PASS: ChecklistCount, настоящий путь Toasts с сохранением DOM и существующий ui.toasts.
- Typecheck, production build, motion/colors/contrast/antilist/docs/permissions guards PASS.
- Production Chromium3/3 с настоящим CSP и строгим сбором page errors/CSP violations (оба списка пусты): normal1460, system390, personal390. Настоящий checkbox ждёт API; ошибка409 не подсвечивает завершение, повтор подтверждает; повторное открытие уже завершённого списка не вспыхивает. Реальная кнопка копирования создаёт success-toast; pathLength1 и animationDuration300ms/0ms проверены.
- Desktop/mobile screenshots просмотрены: галочка и подписи помещаются. Снимки только test-results, goldens не обновлялись.

Gzip против ff9c8ff, байты: total432462(+195), JS393907(+174), CSS38555(+21), entry99857(+5), initial JS196200(+49). Bundle guard PASS.

При интеграции с D07 unit successToasts должен искать стабильный toast-host в document вместо React container, а mock — сохранять stopMotion для cleanup. Реальный icon DOM при смене очереди по-прежнему обязан сохраняться.

Открыты общая интеграционная проверка, ручной Safari/Firefox/reader/VDI и QA владельца. Публикация новой ветки ожидает прямого разрешения владельца после отказа автоматической проверки разрешений.
