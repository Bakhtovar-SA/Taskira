# Track O B-04: browser accessibility checks

Status: prepared locally, **not executed**. No PASS claim is made by this document.

Dependencies: C-07 Inbox row motion, A-08 DEV motion stand and A-06 browser helpers.
This branch contains only the new QA suite and this report, plus dependency merges.
Runtime API, stores, animation timing, accessibility semantics and axe rules are unchanged.

`e2e/motion-a11y.pw.ts` checks:

- Unmodified axe rules on the live board and Inbox during scoped, paused motion, and
  the A-08 board/list/dialog/panel scenes. Live Inbox is the real listExit consumer.
- Flight copies and row ghosts are inert, aria-hidden and have no IDs; live document
  IDs are unique while copies exist. A nonzero paused animation is mandatory.
- Native trusted M and bulk menu operations; card focus after each operation.
- Inbox keyboard read confirmation removes a middle row, then the last row, then the
  only remaining row: focus follows next, previous, and the active unread tab.
- Both system and personal reduce are configured before document startup. Real board,
  Inbox and A-08 actions must have no finite running motion before settle(). Infinite
  indicators have an explicit allowlist (dsSpin, dsIndet, shimmer, dsShimmer); unexpected
  loops fail. This is not evidence of every S1–S8 product workflow: native DnD, calendar,
  dashboard-specific server refresh and actual VDI still have their separate gates.
- Chromium CDP Accessibility.getFullAXTree traverses the CountUp subtree while the
  visual pseudo-text is intermediate: exposed StaticText must be exactly final 127.
  Normal, system reduce and personal reduce cases attach raw AX nodes. This supplements
  existing textContent tests and does not replace manual screen-reader verification.
- Closing a dialog/panel during its held entrance restores the opening trigger.

Midpoint instrumentation freezes the test clock so the safety timer cannot remove a
clone during axe on a slow computer. It intercepts native animate only within the
selected scope; MutationObserver captures scoped CSS animations. It seeks to delay + activeDuration / 2 (50% of the active interval),
asserts a real native Animation/KeyframeEffect, connected target, exact paused timestamp, unresolved original finished promise and zero finish/cancel events, attaches that proof, and always restores native animate, observer, animation playback
and the clock in finally. Forced clicks bypass only RAF stability under the paused
clock; they are browser pointer events, not dispatchEvent or mocked product handlers.
No global CSS animation disabling, new longer product duration or axe exclusion is used.

## Run after the heavy-job slot is free

Use the D drive for TEMP, TMP, npm cache and artifacts. Start no competing build,
Vitest, browser or benchmark while the B-01 matrix owns the measurement slot.

```powershell
$env:TEMP='D:\CodexScratch\Taskira-Track-O-temp'
$env:TMP=$env:TEMP
$env:npm_config_cache='D:\CodexScratch\npm-cache'
$env:CHROMIUM_PATH='C:\Users\user\AppData\Local\ms-playwright\chromium-1194\chrome-win\chrome.exe'
$env:PLAYWRIGHT_PORT='3582'
npx playwright test e2e/motion-a11y.pw.ts --workers=1 --output=D:\CodexScratch\Taskira-Track-O-temp\motion-a11y-results
```

The suite needs DEV because A-08 and CountUp UI scenes are DEV-only. Real board/Inbox
cases should additionally run against the assembled production candidate using a
production config selecting only those cases; DEV scenes must not be claimed as
production coverage. Keep failure artifacts and report genuine product failures to
implementation owners rather than relaxing assertions. Especially verify the bulk
focus assertion: the baseline restoreCardFocus call is in the single-move path, so a
bulk focus failure is a plausible existing defect, not permission to change runtime here.

## Still pending

- Execute this suite and record exact commit, counts and failures.
- View Transition focus is covered by the separate D-17 topic; its dependency is not
  pulled into this C-07/A-08 topic. Re-run that existing focus suite on integration.
- NVDA/VoiceOver, Safari/Firefox, keyboard-only manual QA and real RDP/VDI (B-02).
- No Linux golden update or manual platform PASS is asserted.