# Трек O — C-10: N:FIX-11/13/14

База ff9c8ff, ветка codex/track-o-small-motion. VT-счётчик FIX-10 — отдельная работа D-17.

- Индикатор Tabs зависит от null-разделённого набора id, обновляет измерение при том же selected index.
- Hint раскрывает grid 0fr→1fr со стабильным clip-child; padding внутри, без потолка48px. Touch hint сохраняет grid.
- Board использует общий preloadMotionIdle с cleanup/reduce.
- ENTER_FRAMES.toast и EnterKind.toast удалены после поиска всех product callers; CSS anim-toast и exit(toast) остаются.
- Presence comment соответствует --dur-2=150ms, страховка300ms. ADR не менялись.

Совместимость при интеграции с DEV Stand: его `src/dev/DevMotion.tsx:94` добавил `toast` в `kinds` после базы ff9c8ff.
При объединении удалить только `toast` из `kinds` и из цикла primitive enter в `e2e/motion-stand.pw.ts`.
Настоящий `ToastScene` и сценарии `toasts-queue`/`toasts-clear` сохранить: они проверяют реальный CSS anim-toast и exit.
Это обязательная интеграционная правка, иначе Stand передаст удалённый EnterKind.toast. В этой ветке файлов Stand ещё нет.

Проверки ожидают согласованного тяжёлого слота:

- [x] Tabs.motion, onboarding, ds, Presence, motion, board.characterize: 6 файлов / 74 unit PASS; typecheck PASS (17.10.2026).
- [x] Production Chromium17/17: tall English hint390px/150%, reduce, compact hint1460/390 и прежние точные geometry/scroll gates доски. Board preload cleanup проверен targeted unit.
- [x] Build/bundle и motion/colors/contrast/antilist/docs guards PASS.
- [x] Impeccable static detector: `[]`; git diff --check.
- [x] Автоматические desktop/mobile geometry и compact gates PASS; снимок длинной мобильной подсказки просмотрен: текст и крестик помещаются. Ручной QA владельца и браузерная матрица остаются открытыми.

17.10: production tall English hint150% и reduce2/2 PASS. Первый geometry-прогон на ff9c8ff: 7/15 провалов из-за измерений до окончания уже существующего движения; используется отдельная A06-зависимость PR #198 (e147646), с точными settle/settleScroll. Порог геометрии не ослабляется. После объединения обязательны повтор geometry и проверки C10.

После A06 production17/17 PASS, без изменения порогов. Gzip (с A06): total432293, JS393746, CSS38547, entry99850, initial JS196139 байт; budget PASS. Относительно ff9c8ff это +26/+13/+13/-2/-12 байт соответственно; это совместный размер C10+A06, не изолированный инкремент C10.
