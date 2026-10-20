# Карта движения

Сгенерировано npm run motion:map -- --md. Не править вручную; npm run motion:map -- --check проверяет актуальность.

CSS-классы сопоставлены с текстовыми ссылками в TS/TSX (не доказательство выполнения). JS reduce-статус — статический: соблюдение границ проверяет motion:check, выполнение проверяют e2e. DEV и тестовые файлы исключены. Бесконечные индикаторы перечислены, даже если сознательно остаются при reduce.

| Источник | Тип | Цель / свойства | Длительность | Reduce | Где применяется |
|---|---|---|---|---|---|
| src/boardFlip.ts:184 | waapi-wrapper | flipFrom: пресет flipFrom | пресет src/motion.ts | обёртка motionReduced | src/boardFlip.ts |
| src/boardFlip.ts:234 | waapi-wrapper | flash: пресет flash | пресет src/motion.ts | обёртка motionReduced | src/boardFlip.ts |
| src/boardFlip.ts:237 | waapi-wrapper | flipFrom: пресет flipFrom | пресет src/motion.ts | обёртка motionReduced | src/boardFlip.ts |
| src/ChecklistCount.tsx:11 | waapi-wrapper | flash: пресет flash | пресет src/motion.ts | обёртка motionReduced | src/ChecklistCount.tsx |
| src/components/Board.tsx:140 | waapi-wrapper | enter: пресет enter | пресет src/motion.ts | обёртка motionReduced | src/components/Board.tsx |
| src/components/BoardFilterSummary.tsx:14 | waapi-wrapper | enter: пресет enter | пресет src/motion.ts | обёртка motionReduced | src/components/BoardFilterSummary.tsx |
| src/components/Sidebar.tsx:191 | waapi-wrapper | glideWidth: пресет glideWidth | пресет src/motion.ts | обёртка motionReduced | src/components/Sidebar.tsx |
| src/CountUp.tsx:22 | waapi-wrapper | countTo: пресет countTo | пресет src/motion.ts | обёртка motionReduced | src/CountUp.tsx |
| src/dashboards/gridFlip.ts:59 | waapi-wrapper | flipFrom: пресет flipFrom | пресет src/motion.ts | обёртка motionReduced | src/dashboards/gridFlip.ts |
| src/ds/Dialog.tsx:56 | waapi-wrapper | enter: пресет enter | пресет src/motion.ts | обёртка motionReduced | src/ds/Dialog.tsx |
| src/ds/ds.css:1005 | css-transition | .ds-ring .ds-ring-val: stroke-dashoffset | stroke-dashoffset var(--dur-4) var(--ease-out) | личный выключатель | src/ds/Display.tsx |
| src/ds/ds.css:1042 | css-animation | .ds-sk: background-position | dsShimmer 1.4s linear infinite | @media + личный выключатель | src/components/DashboardView.tsx, src/components/ProjectWizard.tsx, src/components/settings/OrgSettings.tsx, src/components/settings/ProjectRoadmap.tsx, src/components/settings/ProjectSettings.tsx, src/ds/Combobox.tsx, src/ds/Display.tsx |
| src/ds/ds.css:1048 | css-keyframes | dsShimmer: background-position | из правила применения | см. правила применения | см. CSS |
| src/ds/ds.css:173 | css-animation | .ds-spinner: transform | dsSpin 0.7s linear infinite | личный выключатель | src/ds/Button.tsx |
| src/ds/ds.css:181 | css-keyframes | dsSpin: transform | из правила применения | см. правила применения | см. CSS |
| src/ds/ds.css:205 | css-transition | .ds-input: box-shadow, background-color | box-shadow var(--dur-2) var(--ease-standard), background-color var(--dur-2) var(--ease-standard) | личный выключатель | src/components/AssigneePicker.tsx, src/ds/Combobox.tsx, src/ds/DatePicker.tsx, src/ds/Field.tsx, src/ds/Select.tsx |
| src/ds/ds.css:293 | css-transition | .ds-box: background-color, box-shadow | background-color var(--dur-2) var(--ease-standard), box-shadow var(--dur-2) var(--ease-standard) | личный выключатель | src/ds/Field.tsx |
| src/ds/ds.css:309 | css-transition | .ds-box svg: opacity, transform | opacity var(--dur-2) var(--ease-standard), transform var(--dur-4) var(--ease-spring) | личный выключатель | src/ds/Field.tsx |
| src/ds/ds.css:332 | css-transition | .ds-check[data-kind="radio"] .ds-dot: opacity, transform | opacity var(--dur-2), transform var(--dur-4) var(--ease-spring) | личный выключатель | src/components/settings/PersonalSettings.tsx, src/ds/Field.tsx |
| src/ds/ds.css:352 | css-transition | .ds-switch: background-color, box-shadow | background-color var(--dur-3) var(--ease-standard), box-shadow var(--dur-2) var(--ease-standard) | личный выключатель | src/ds/Field.tsx |
| src/ds/ds.css:363 | css-transition | .ds-switch > span: transform | transform var(--dur-3) var(--ease-out) | личный выключатель | src/ds/Field.tsx |
| src/ds/ds.css:377 | css-transition | .ds-switch > span svg: opacity | opacity var(--dur-2) | личный выключатель | src/ds/Field.tsx |
| src/ds/ds.css:446 | css-transition | .ds-tab: background-color, color, box-shadow | background-color var(--dur-2), color var(--dur-2), box-shadow var(--dur-2) | личный выключатель | src/ds/Tabs.tsx |
| src/ds/ds.css:46 | css-transition | .ds-btn: background-color, box-shadow, color, transform | background-color var(--dur-2) var(--ease-standard), box-shadow var(--dur-2) var(--ease-standard), color var(--dur-2) var(--ease-standard), transform var(--dur-1) var(--ease-standard) | личный выключатель | src/components/settings/OrgSettings.tsx, src/ds/Button.tsx, src/ui.tsx |
| src/ds/ds.css:521 | css-transition | .ds-pop: opacity, transform, overlay, display | opacity var(--dur-2) var(--ease-standard), transform var(--dur-2) var(--ease-standard), overlay var(--dur-2) allow-discrete, display var(--dur-2) allow-discrete | @media + личный выключатель | src/ds/Combobox.tsx, src/ds/Overlay.tsx, src/ds/Select.tsx |
| src/ds/ds.css:531 | css-transition | .ds-pop:popover-open: opacity, transform, overlay, display | opacity var(--dur-3) var(--ease-out), transform var(--dur-4) var(--ease-spring), overlay var(--dur-4) allow-discrete, display var(--dur-4) allow-discrete | @media + личный выключатель | src/ds/Combobox.tsx, src/ds/Overlay.tsx, src/ds/Select.tsx |
| src/ds/ds.css:612 | css-animation | .ds-tip:popover-open: opacity | dsTipIn var(--dur-2) var(--ease-out) | @media + личный выключатель | src/ds/Overlay.tsx, src/titleHints.ts |
| src/ds/ds.css:615 | css-keyframes | dsTipIn: opacity | из правила применения | см. правила применения | см. CSS |
| src/ds/ds.css:655 | css-animation | .ds-dialog::backdrop: opacity | dsScrimIn var(--dur-3) var(--ease-out) | @media + личный выключатель | src/ds/Dialog.tsx |
| src/ds/ds.css:659 | css-animation | .ds-dialog[data-closing]::backdrop: opacity | dsScrimOut var(--dur-2) var(--ease-standard) forwards | @media + личный выключатель | src/ds/Dialog.tsx |
| src/ds/ds.css:662 | css-animation | .ds-dialog[data-closing]: opacity, transform | dsDialogOut var(--dur-2) var(--ease-standard) forwards | @media + личный выключатель | src/ds/Dialog.tsx |
| src/ds/ds.css:665 | css-animation | .ds-dialog[data-kind="panel"][data-closing]: opacity, transform | dsPanelOut var(--dur-2) var(--ease-standard) forwards | @media + личный выключатель | src/ds/Dialog.tsx |
| src/ds/ds.css:668 | css-keyframes | dsScrimIn: opacity | из правила применения | см. правила применения | см. CSS |
| src/ds/ds.css:673 | css-keyframes | dsScrimOut: opacity | из правила применения | см. правила применения | см. CSS |
| src/ds/ds.css:678 | css-keyframes | dsDialogOut: opacity, transform | из правила применения | см. правила применения | см. CSS |
| src/ds/ds.css:684 | css-keyframes | dsPanelOut: opacity, transform | из правила применения | см. правила применения | см. CSS |
| src/ds/ds.css:794 | css-animation | .ds-toast-bar: transform | dsToastBar var(--toast-ms, 5000ms) linear forwards | личный выключатель | src/ds/Display.tsx |
| src/ds/ds.css:808 | css-keyframes | dsToastBar: transform | из правила применения | см. правила применения | см. CSS |
| src/ds/ds.css:978 | css-transition | .ds-progress > span: width | width var(--dur-4) var(--ease-out) | @media + личный выключатель | src/ds/Display.tsx |
| src/ds/ds.css:986 | css-animation | .ds-progress[data-indeterminate] > span: transform | dsIndet 1.2s var(--ease-in-out) infinite | личный выключатель | src/ds/Display.tsx |
| src/ds/ds.css:990 | css-keyframes | dsIndet: transform | из правила применения | см. правила применения | см. CSS |
| src/ds/Tabs.tsx:51 | waapi-wrapper | glideTo: пресет glideTo | пресет src/motion.ts | обёртка motionReduced | src/ds/Tabs.tsx |
| src/Flash.tsx:11 | waapi-wrapper | flash: пресет flash | пресет src/motion.ts | обёртка motionReduced | src/Flash.tsx |
| src/index.css:1061 | css-keyframes | viewIn: opacity | из правила применения | см. правила применения | см. CSS |
| src/index.css:1066 | css-keyframes | drawLine: stroke-dashoffset | из правила применения | см. правила применения | см. CSS |
| src/index.css:1071 | css-animation | .anim-view: opacity | viewIn var(--dur-3) var(--ease-out) both | @media + личный выключатель | src/App.tsx, src/components/ProjectWizard.tsx, src/components/QuickCreateIssue.tsx, src/components/TimelineView.tsx, src/components/settings/SettingsView.tsx, src/useSkeletonReveal.ts |
| src/index.css:1074 | css-animation | .anim-stagger > *: opacity | viewIn var(--dur-4) var(--ease-out) backwards | @media + личный выключатель | src/components/InboxView.tsx, src/components/MyIssuesView.tsx, src/components/ReportsView.tsx, src/components/SprintsView.tsx, src/dashboards/DashboardGrid.tsx |
| src/index.css:1083 | css-animation | .success-check path: stroke-dashoffset | drawLine var(--dur-4) var(--ease-out) backwards | @media + личный выключатель | src/ds/Display.tsx, src/ui.tsx |
| src/index.css:1087 | css-animation | .chart-line: stroke-dashoffset | drawLine var(--dur-5) var(--ease-out) backwards | @media + личный выключатель | src/dashboards/charts.tsx |
| src/index.css:1091 | css-animation | .reports-chart rect[data-series]: opacity | viewIn var(--dur-4) var(--ease-out) backwards | @media + личный выключатель | src/components/ReportsView.tsx |
| src/index.css:1094 | css-animation | .ds-empty: opacity | viewIn var(--dur-4) var(--ease-out) both | @media + личный выключатель | src/dashboards/widgets.tsx, src/ds/Display.tsx |
| src/index.css:1103 | css-animation | .anim-done-tail: grid-template-rows, opacity | doneTailIn var(--dur-3) var(--ease-out) | @media + личный выключатель | src/components/BoardDoneTail.tsx |
| src/index.css:1104 | css-keyframes | doneTailIn: grid-template-rows, opacity | из правила применения | см. правила применения | см. CSS |
| src/index.css:176 | css-transition | body: background-color, color | background-color var(--dur-4) var(--ease-standard), color var(--dur-4) var(--ease-standard) | личный выключатель | CSS / динамическая сборка классов |
| src/index.css:345 | css-transition | .board-card: box-shadow | box-shadow var(--dur-2, 180ms) cubic-bezier(0.16, 1, 0.3, 1) | личный выключатель | src/components/Board.tsx |
| src/index.css:440 | css-transition | .theme-choice: box-shadow, background-color | box-shadow var(--dur-2) var(--ease-standard), background-color var(--dur-2) | личный выключатель | src/components/ProjectLookPicker.tsx |
| src/index.css:463 | css-animation | #splash path: stroke-dashoffset | splashDraw var(--dur-3) var(--ease-out) forwards | @media + личный выключатель | CSS / динамическая сборка классов |
| src/index.css:471 | css-animation | #splash[data-out]: opacity | splashOut var(--dur-3) var(--ease-standard) forwards | личный выключатель | CSS / динамическая сборка классов |
| src/index.css:474 | css-animation | #splash[data-out] svg: transform | splashLift var(--dur-3) var(--ease-standard) forwards | @media + личный выключатель | CSS / динамическая сборка классов |
| src/index.css:477 | css-keyframes | splashDraw: stroke-dashoffset | из правила применения | см. правила применения | см. CSS |
| src/index.css:482 | css-keyframes | splashOut: opacity | из правила применения | см. правила применения | см. CSS |
| src/index.css:487 | css-keyframes | splashLift: transform | из правила применения | см. правила применения | см. CSS |
| src/index.css:511 | css-animation | .hint-line: grid-template-rows, margin-block, opacity | hintIn var(--dur-3) var(--ease-out) | @media + личный выключатель | src/components/Hint.tsx |
| src/index.css:518 | css-keyframes | hintIn: grid-template-rows, margin-block, opacity | из правила применения | см. правила применения | см. CSS |
| src/index.css:531 | css-animation | .skeleton-late: opacity | skeletonLate var(--dur-3) var(--ease-out) var(--dur-3) both | @media + личный выключатель | src/components/Backlog.tsx, src/components/Board.tsx |
| src/index.css:534 | css-keyframes | skeletonLate: opacity | из правила применения | см. правила применения | см. CSS |
| src/index.css:540 | css-transition | .look-choice: box-shadow, background-color | box-shadow var(--dur-2) var(--ease-standard), background-color var(--dur-2) | личный выключатель | src/components/ProjectLookPicker.tsx |
| src/index.css:653 | css-transition | .palette-row: background-color, color | background-color var(--dur-1, 100ms) linear, color var(--dur-1, 100ms) linear | личный выключатель | src/components/CommandPalette.tsx |
| src/index.css:672 | css-transition | .btn-primary: background-color, box-shadow, transform | background-color var(--dur-2) var(--ease-standard), box-shadow var(--dur-2) var(--ease-standard), transform var(--dur-1) var(--ease-standard) | личный выключатель | src/components/QuickCreateIssue.tsx |
| src/index.css:751 | css-keyframes | fadeUp: opacity, transform | из правила применения | см. правила применения | см. CSS |
| src/index.css:761 | css-keyframes | popIn: opacity, transform | из правила применения | см. правила применения | см. CSS |
| src/index.css:771 | css-keyframes | toastIn: opacity, transform | из правила применения | см. правила применения | см. CSS |
| src/index.css:781 | css-keyframes | cardFlash: background, box-shadow | из правила применения | см. правила применения | см. CSS |
| src/index.css:790 | css-keyframes | shimmer: background-position | из правила применения | см. правила применения | см. CSS |
| src/index.css:801 | css-keyframes | dropLand: transform | из правила применения | см. правила применения | см. CSS |
| src/index.css:810 | css-keyframes | doneFlash: background, box-shadow | из правила применения | см. правила применения | см. CSS |
| src/index.css:821 | css-transition | .cl-text: text-decoration-color, color | text-decoration-color var(--dur-4) var(--ease-out), color var(--dur-3) var(--ease-standard) | @media + личный выключатель | src/components/IssueModal.tsx |
| src/index.css:829 | css-animation | .anim-fadeup: opacity, transform | fadeUp var(--dur-3) var(--ease-out) both | @media + личный выключатель | src/components/IssueModal.tsx |
| src/index.css:832 | css-animation | .anim-pop: opacity, transform | popIn var(--dur-2) var(--ease-out) both | @media + личный выключатель | src/components/Board.tsx, src/components/Topbar.tsx |
| src/index.css:837 | css-keyframes | scrimIn: opacity | из правила применения | см. правила применения | см. CSS |
| src/index.css:842 | css-animation | .anim-scrim: opacity | scrimIn var(--dur-3) var(--ease-standard) both | личный выключатель | src/components/Sidebar.tsx |
| src/index.css:845 | css-animation | .anim-toast: opacity, transform | toastIn var(--dur-3) var(--ease-out) both | @media + личный выключатель | src/motion.ts, src/ui.tsx |
| src/index.css:851 | css-transition | .wf-node-box: stroke, stroke-width | stroke var(--dur-2) ease-out, stroke-width var(--dur-2) ease-out | личный выключатель | src/components/WorkflowView.tsx |
| src/index.css:877 | css-transition | .wf-edge: stroke, stroke-width | stroke var(--dur-2) ease-out, stroke-width var(--dur-2) ease-out | личный выключатель | src/components/WorkflowView.tsx |
| src/index.css:882 | css-animation | .wf-edge.is-on: stroke-dashoffset | wfFlow 0.9s linear infinite | @media + личный выключатель | src/components/MyIssues.tsx, src/components/WorkflowView.tsx |
| src/index.css:889 | css-keyframes | wfFlow: stroke-dashoffset | из правила применения | см. правила применения | см. CSS |
| src/index.css:904 | css-animation | .anim-drop: transform, background, box-shadow | dropLand var(--dur-3) var(--ease-out) both, cardFlash var(--dur-5) ease-out both | @media + личный выключатель | CSS / динамическая сборка классов |
| src/index.css:907 | css-animation | .anim-drop-done: transform, background, box-shadow | dropLand var(--dur-3) var(--ease-out) both, doneFlash var(--dur-5) ease-out both | @media + личный выключатель | CSS / динамическая сборка классов |
| src/index.css:911 | css-animation | .anim-flash: background, box-shadow | cardFlash var(--dur-5) ease-out both | личный выключатель | src/components/Board.tsx |
| src/index.css:914 | css-animation | .anim-flash-done: background, box-shadow | doneFlash var(--dur-5) ease-out both | личный выключатель | CSS / динамическая сборка классов |
| src/index.css:928 | css-transition | .timeline-bar: transform, width | transform var(--dur-4) var(--ease-out), width var(--dur-4) var(--ease-out) | @media + личный выключатель | src/components/TimelineView.tsx |
| src/index.css:954 | css-transition | .timeline-bar-fill: width | width var(--dur-4) var(--ease-out) | @media + личный выключатель | src/components/TimelineView.tsx |
| src/index.css:977 | css-animation | .skeleton: background-position | shimmer 1.4s ease-in-out infinite | @media + личный выключатель | src/App.tsx, src/components/IssueModal.tsx, src/components/IssueSearchBox.tsx, src/components/ReportsView.tsx, src/components/RoadmapView.tsx, src/issuePages.ts, src/useSkeletonReveal.ts |
| src/index.css:988 | css-keyframes | fadeOnly: opacity | из правила применения | см. правила применения | см. CSS |
| src/listEnter.ts:29 | waapi-wrapper | enter: пресет enter | пресет src/motion.ts | обёртка motionReduced | src/listEnter.ts |
| src/listExit.ts:101 | waapi-wrapper | exit: пресет exit | пресет src/motion.ts | обёртка motionReduced | src/listExit.ts |
| src/listExit.ts:105 | waapi-wrapper | flipFrom: пресет flipFrom | пресет src/motion.ts | обёртка motionReduced | src/listExit.ts |
| src/motion.ts:208 | view-transition | startViewTransition: пресет startViewTransition | пресет src/motion.ts | JS guard в модуле; проверяется motion:check | src/motion.ts |
| src/motion.ts:247 | waapi-wrapper | animate: el, { transform: [from, "translate(0px, 0px)"] } | { type: e.spring, ...(delayMs > 0 ? SPRING_ENTER : SPRING), ...(delayMs > 0 ? { delay: delayMs / 1000 } : {}) } | JS guard в модуле; проверяется motion:check | src/motion.ts |
| src/motion.ts:248 | waapi-wrapper | animate: [{ transform: from }, { transform: "none" }] | { duration: DUR_4_MS, delay: delayMs, fill: "backwards", easing: EASE_OUT_CSS } | JS guard в модуле; проверяется motion:check | src/motion.ts |
| src/motion.ts:278 | waapi-wrapper | animate: el, ENTER_FRAMES[kind] | { type: e.spring, ...(kind === "pop" ? SPRING_POP : SPRING_ENTER) } | JS guard в модуле; проверяется motion:check | src/motion.ts |
| src/motion.ts:288 | waapi-wrapper | animate: el, { opacity: [1, 0], transform } | EXIT | JS guard в модуле; проверяется motion:check | src/motion.ts |
| src/motion.ts:296 | waapi-wrapper | animate: [ { opacity: 0.4, transform: `translateX(${dir * 12}px)` }, { opacity: 1, transform: "none" }, ] | { duration: DUR_4_MS, easing: EASE_OUT_CSS, fill: "backwards" } | JS guard в модуле; проверяется motion:check | src/motion.ts |
| src/motion.ts:357 | waapi-wrapper | animate: [{ backgroundColor: "color-mix(in oklch, var(--accent-solid) 22%, transparent)" }, { backgroundColor: "transparent" }] | { duration: 300, easing: "ease-out" } | JS guard в модуле; проверяется motion:check | src/motion.ts |
| src/motion.ts:387 | waapi-wrapper | animate: el, frames | { type: e.spring, ...SPRING } | JS guard в модуле; проверяется motion:check | src/motion.ts |
| src/motion.ts:387 | waapi-wrapper | animate: frames | { duration: DUR_4_MS, easing: EASE_OUT_CSS } | JS guard в модуле; проверяется motion:check | src/motion.ts |
| src/motion.ts:434 | waapi-wrapper | animate: el, { transform: [from, `${at} scaleX(1)`] } | { type: e.spring, ...SPRING } | JS guard в модуле; проверяется motion:check | src/motion.ts |
| src/roadmapDateFlash.ts:35 | waapi-wrapper | flash: пресет flash | пресет src/motion.ts | обёртка motionReduced | src/roadmapDateFlash.ts |
| src/store.tsx:457 | view-transition | viewTransition: пресет viewTransition | пресет src/motion.ts | обёртка motionReduced | src/store.tsx |
| src/store.tsx:470 | view-transition | viewTransition: пресет viewTransition | пресет src/motion.ts | обёртка motionReduced | src/store.tsx |
| src/store/session.ts:341 | view-transition | viewTransition: пресет viewTransition | пресет src/motion.ts | обёртка motionReduced | src/store/session.ts |
| src/store/session.ts:465 | view-transition | viewTransition: пресет viewTransition | пресет src/motion.ts | обёртка motionReduced | src/store/session.ts |
| src/styles/reports.css:56 | css-animation | .reports-metrics > *, .reports-panels > *: opacity | viewIn var(--dur-4) var(--ease-out) backwards | @media + личный выключатель | src/components/ReportsView.tsx |
| src/styles/reports.css:63 | css-animation | .reports-content > .reports-footnote: opacity | viewIn var(--dur-4) var(--ease-out) backwards; delay 150ms | @media + личный выключатель | src/components/ReportsView.tsx |
| src/styles/roadmap.css:81 | css-animation | .roadmap-connection-preview: stroke-dashoffset | roadmap-dash var(--dur-5) linear infinite | @media + личный выключатель | src/components/RoadmapView.tsx |
| src/styles/roadmap.css:85 | css-keyframes | roadmap-dash: stroke-dashoffset | из правила применения | см. правила применения | см. CSS |
| src/styles/workspace.css:263 | css-transition | .board-member-filter: transform | transform var(--dur-2) var(--ease-out) | @media + личный выключатель | src/components/ProjectMembers.tsx |
| src/styles/workspace.css:266 | css-transition | .board-member-name: max-width, opacity, padding | max-width var(--dur-3) var(--ease-out), opacity var(--dur-2) var(--ease-out), padding var(--dur-3) var(--ease-out) | @media + личный выключатель | src/components/ProjectMembers.tsx |
| src/styles/workspace.css:411 | css-transition | .board-col-highlight: box-shadow, background-color | box-shadow var(--dur-3) var(--ease-standard), background-color var(--dur-3) var(--ease-standard) | личный выключатель | src/components/Board.tsx |
| src/styles/workspace.css:740 | css-transition | .form-disclosure::details-content, .reports-chart-data::details-content: block-size, content-visibility | block-size var(--dur-4) var(--ease-out), content-visibility var(--dur-4) allow-discrete | @media + личный выключатель | src/components/CreateIssueModal.tsx, src/components/ReportsView.tsx |
| src/styles/workspace.css:754 | css-animation | .home-grid > div > .home-card: opacity | fadeOnly var(--dur-4) var(--ease-out) both | @media + личный выключатель | src/components/HomeView.tsx |
| src/theme.ts:147 | view-transition | startViewTransition: пресет startViewTransition | пресет src/motion.ts | JS guard в модуле; проверяется motion:check | src/theme.ts |
| src/theme.ts:150 | waapi-raw | animate: { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${Math.ceil(r)}px at ${x}px ${y}px)`] } | { duration: 450, easing: "cubic-bezier(0.2, 0, 0, 1)", pseudoElement: "::view-transition-new(root)" } | JS guard в модуле; проверяется motion:check | src/theme.ts |
| src/ui.tsx:127 | waapi-wrapper | flipFrom: пресет flipFrom | пресет src/motion.ts | обёртка motionReduced | src/ui.tsx |
| src/ui.tsx:130 | waapi-wrapper | exit: пресет exit | пресет src/motion.ts | обёртка motionReduced | src/ui.tsx |
| src/usePulse.ts:12 | waapi-wrapper | enter: пресет enter | пресет src/motion.ts | обёртка motionReduced | src/usePulse.ts |
