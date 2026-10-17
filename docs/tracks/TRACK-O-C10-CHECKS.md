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
- [ ] Tall English hint390px/150%, reduce, compact hint1460/390 и board preload browser.
- [ ] Build/bundle и motion/colors/contrast/antilist/docs guards.
- [x] Impeccable static detector: `[]`; git diff --check.
- [ ] Итоговый desktop/mobile обзор.

17.10: production tall English hint150% и reduce2/2 PASS. Первый geometry-прогон на ff9c8ff: 7/15 провалов из-за измерений до окончания уже существующего движения; используется отдельная A06-зависимость PR #198 (e147646), с точными settle/settleScroll. Порог геометрии не ослабляется. После объединения обязательны повтор geometry и проверки C10.
