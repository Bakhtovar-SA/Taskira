# Engineering notes

Design reasoning and bug history that used to live in `CLAUDE.md`. `CLAUDE.md` keeps the rules and the map; this file keeps the
"why" and the stories behind the rules. It is organised by topic. Decisions that changed an architectural choice are in
[docs/adr/](adr/README.md) and are never edited; this file may be updated freely. The route tables and operational procedures are
in [server/README.md](../server/README.md) and [OPERATIONS.md](OPERATIONS.md) (both in Russian).

Contents: [Server data model](#server-data-model) · [Auth, sessions and WebSocket](#auth-sessions-and-websocket) ·
[Background jobs](#background-jobs) · [Licensing](#licensing) · [Server tests](#server-tests) · [Client store](#client-store) ·
[Client UI components](#client-ui-components) · [Import](#import-trello-jira-asana) · [Local environment and Docker](#local-environment-and-docker)

## Server data model

### Issue lifecycle (migration 016)

`issues.done_at` is set when an issue enters a `done`-category status and cleared when it returns to work; moving between two
closing statuses leaves it alone. `issues.archived_at` is set by the maintenance worker for issues closed longer ago than
`ARCHIVE_AFTER_DAYS` (default 30).

Archiving is not deletion: the row stays, the issue opens by direct link, is searchable (`?archived=all`) and still counts in
reports. It only leaves the project's active working set, which keeps the board and the list from growing without bound.
`GET …/issues` returns active issues by default; `?archived=1` returns archived only, `?archived=all` both.

Anything reporting on "what got done" keys off `done_at`; `updated_at` is not a substitute because any edit touches it. The board
shows the last 14 days in its done column (`DONE_WINDOW_DAYS` in `src/boardFilters.ts`, used by `Board.tsx` / `BoardColumn.tsx`) and
collapses the rest behind "Ранее закрыто".

### Workflow, issue types, keys, priorities

Workflow is a DB-backed directed graph: `workflow_statuses` (with a stable `sid`: `todo` / `inprogress` / `review` / `done`) plus
`workflow_transitions` (edges). Every status change (`POST /api/projects/:projectId/issues/:id/transition`) is checked against the
transitions table, even for an admin. `admin` edits the graph via `POST/DELETE …/workflow/transitions` and `…/workflow/reset`;
statuses are never deleted. Workflow reset returns 409 for a project whose statuses are not the default four, because a reset would
orphan its issues.

Issue types are `task | bug | request` only (migration 002 collapsed `story`/`epic` into `task`; grouping survives through the nullable
`issues.epic_id`; timeline fields `t_start`/`t_span` were kept). Keys (`CORP-1`) are assigned by the server through the atomic
`project_counters` upsert. Priorities are `low | medium | high | critical` (migration 013). Direction ("epic") child counts are stored
on the direction's own row (`issues.epic_child_total/done`, migration `20260930T0500`) and kept by triggers with ±1 deltas;
`GET …/issues/epics` reads them through `idx_issues_active_epics`. Never maintain them from application code; a new write path is
covered automatically. Drift checks and repair: [OPERATIONS.md](OPERATIONS.md).

Issue links (`issue_links`, migration 014): `relates` (symmetric) or `blocks` (directed); `blocked_by` is `blocks` seen from the other
end, not a stored row. Numeric story `points` were replaced outright by `complexity` (`simple | medium | hard`, `COMPLEXITIES` in
`src/types.ts` and `server/src/contract.ts`; migration 018, [ADR-0004](adr/0004-complexity-instead-of-story-points.md)); like
`priorityId` it has no client validator, since a fixed dropdown and the type system are enough.

### Multiple assignees (`issue_assignees`, migration 025)

The single nullable `issues.assignee_id` was replaced outright by a join table: a flat list, no "primary" assignee, zero or more
rows. It has the same shape as `issue_collaborators` (008) but a different meaning: a collaborator is invited to one issue, sees it
and can comment but is never assignable; an assignee is a real project member doing the work.

- `isOwnIssue` (both `permissions.ts` copies) is `assigneeIds.includes(me) || reporterId === me`: an employee can edit an issue if
  they are any of its assignees.
- `mapIssue(row, assigneeIds)` takes the ids as an explicit argument because they no longer live in `issues`. List callers batch-load
  them (`listAssigneeIdsBatch`, one query for N issues); single-issue callers use `listAssigneeIds`. `requireIssuePerm` aggregates
  them into `IssueRef` with `array_agg` in the same round-trip as the rest of the row.
- `PATCH …/issues/:id` treats `assigneeIds` as a full-list replacement (like `labels`), diffs it against the previous set for activity
  lines, notifies only the newly added assignees, and writes the join table only when the diff is non-empty.
- Reports `groupBy=assignee` fans an issue out to every assignee (an issue with two assignees counts in both rows); totals are
  unaffected because that join appears only in the breakdown query. The CSV export `string_agg`s names into one cell instead.
- Client `assignableUsers()` (`src/store/mappers.ts`) takes the issue's current `assigneeIds` so someone already assigned but since
  removed from the project still shows in the picker instead of silently vanishing.

### Checklist (`checklist_items`, migration 019, `services/checklist.ts`)

One row per item, on the same `edit` permission as `issue_links`: whoever can edit the issue manages its checklist. `position` is
assigned once at insert (`COALESCE(MAX(position)+1, 0)` in the same `INSERT`) and never rewritten; there is deliberately no reorder
endpoint in v1 (if drag ordering is ever needed, move to a fractional rank like `issues.rank`). Two concurrent adds can race to the
same position; `listChecklistItems` orders by `position, created_at` instead of taking a lock over something this low-stakes.
Activity is written only for add/remove, not every toggle, so the history does not drown in checkbox changes.
`LIMITS.checklistItemsPerIssue` (50) and `LIMITS.checklistItem.text` mirror between `contract.ts` and `src/validation.ts`.

### Custom fields (`custom_fields` / `custom_field_values`, migration 020, `services/customFields.ts`)

Project-level definitions (`text | number | select | checkbox | date`), one value row per (field, issue); no row means unset;
everything is stored as `text` and parsed according to the field type (`validateValueForField`, not a static zod schema). Defining
fields reuses `editWorkflow` rather than a new `PermId`: it is the same "structural project schema" capability as workflow edges,
and a new permission would mean touching the shared matrix for one narrow feature. Setting a value on an issue uses plain `edit`.
Managed in `WorkflowView.tsx`, `ProjectSettings` sections «fields».

### Subtasks (`issues.parent_id`, migration 021)

Exactly two levels. `assignParentLocked()` / `validateParentAssignmentTx()` (`services/issues.ts`) refuse a parent that already has a
parent, and refuse to give an issue a parent if it already has children. Validation and the write run in one transaction under
`pg_advisory_xact_lock` (the idiom used by `rank.ts`), locked on both issues; without it two concurrent `PATCH`es could each pass
validation against stale state and together build a three-level chain (found in review, PR #46). Unassigning (`parentId = null`)
goes through the same helper, `withIssueParentLock()`, so concurrent assign and unassign serialize on one primitive.

Independent of `epicId` ("direction", free-form grouping with no depth limit): an issue can be both in a direction and a subtask.
There is no subtasks endpoint; the client already holds the project's active issues and filters by `parentId`, the same way the
timeline groups by `epicId`. The "N/M" badge, however, comes from `getIssueDto.subtasksSummary` (a small aggregate over all children,
archived included), because a client-side filter would make the badge regress once a closed subtask ages into the archive. The
subtask rows are in `IssueModalFields.tsx`; "+ add subtask" calls `openCreateSubtask()` in `store.tsx`, which pre-sets
`ui.createParentId` (separate from the plain `setCreateOpen()` so a normal "Create" never inherits a stale parent). Deleting a
parent does not delete its subtasks (`ON DELETE SET NULL`, same as `epicId`); the client's `deleteIssue()` mirrors that by nulling
`parentId` on loaded rows. After create/delete/status change of a subtask the parent's `subtasksSummary` is patched locally
(`mappers.ts`) so the open parent card does not show a stale badge (PR #46 review).

### Issue templates (`issue_templates`, migration 022, `services/issueTemplates.ts`)

Project-level presets (name, type, priority, default title, default description, optional starting status), managed under
`editWorkflow` like fields and the workflow graph. Applying one is pure client-side prefill: `CreateIssueModal` copies the fields
into local form state once on selection; the server is not told which template was used and nothing links an issue to its template.
Templates do not carry checklists or subtasks.

### Sprints (`sprints` / `issues.sprint_id`, migration 023, [SPRINTS_MIGRATION.md](../SPRINTS_MIGRATION.md))

An optional, off-by-default module. Migration 012 removed sprints from the base product and that still holds for any project
without the flag ([ADR-0002](adr/0002-sprints-removed-from-base-product.md), [ADR-0003](adr/0003-sprints-optional-per-project-module.md)).
`project.sprintsEnabled` gates it end to end: every `/sprints*` route and `PATCH …/issues/:id/sprint` returns 404 when it is off,
for every role. `manageSprints` (admin/manager) gates sprint CRUD and assigning an issue to a sprint, the latter through its own
sub-route rather than a branch of the general issue `PATCH`. At most one `active` sprint per project is a DB guarantee
(`uq_sprints_one_active_per_project`, a partial unique index). Completing a sprint moves unfinished issues (`done_at IS NULL`) back
to the backlog in one transaction; there is no auto-carry. The flag is the seed of a possible future `ProjectCapabilities` model;
that model is not built.

### Project templates and appearance ([ADR-0017](adr/0017-project-templates-as-data.md), [ADR-0018](adr/0018-project-appearance.md))

A template is data over existing project settings: statuses (own `sid`s allowed), transitions, custom fields, issue templates,
suggested labels, default view; never code. Five built-ins are in `server/src/templates/builtin.json` (blank, marketing, hr,
support, approval; five is the cap from ТЗ 5.10); organisation templates are rows saved from a project
(`POST /projects/:id/save-as-template`, `saveProjectTemplate`). `POST /projects` with `templateId` + `members[]` creates the
project, applies the template and adds members in one transaction. New columns: `projects.default_view` and
`suggested_labels`. `projects.icon` / `color` / `background` are ids from closed lists in `contract.ts` (`PROJECT_ICONS`,
`PROJECT_COLORS`, `PROJECT_BACKGROUNDS`), never hex or URLs, so nothing new appears under the CSP; null keeps the old behaviour.
Client: `ProjectWizard.tsx` (lazy; `openProjectWizard()`; `suggestKey` transliterates a name into a key); `ProjectMark` in `ui.tsx`
takes `icon`/`color` (pass them, or `lookOf(data.projects, key)` from `src/projectLook.tsx`); a project background overrides the
personal one while the project is open (`setProjectBackground()` in `theme.ts`). `WorkflowView` lays out any status set with
`src/workflowLayout.ts`; the standard four keep a fixed layout.

### Onboarding ([ADR-0019](adr/0019-onboarding-in-product.md))

Progress is per user on the server (`user_onboarding`: done steps, hidden, dismissed hint ids). Steps are marked by the server from
real actions: routes call `markStep()` (`services/onboarding.ts`, never throws, per-process cache) after opening an assigned issue,
a status change, a comment, saving notification prefs. Only `theme` comes from the client (`markThemeStep()` from `App.tsx` via
`onThemeChosen` in `theme.ts`). Client store: `src/onboarding.ts`; call `refreshOnboardingSoon()` after an action that may mark a
step. UI: `GettingStarted` (Home, or collapsed in the sidebar when there is no Home), `<Hint id>` one-line tips (never modal, never
shown again once dismissed), «Организация → Начальная настройка» (`Setup.tsx`) opened once per session for an admin while
`instance.setup_completed_at` is null. The demo project (`projects.is_demo`, at most one) is built in one transaction by
`services/demoProject.ts` with no notifications and no audit rows; deleting it removes the project and any `audit_log` rows for it
and its issues. `server/test/onboarding.test.ts` compares row counts of every table before and after.

### Dashboards ([ADR-0022](adr/0022-dashboards.md), [ADR-0025](adr/0025-project-calendar-portfolio.md), [ADR-0033](adr/0033-reports-dashboard-navigation.md))

One `dashboards` table: personal (owner only; others get 404), organisation-shared (`shared`, global admin edits) and one «Обзор»
per project (`project_id`, `manageDashboards` for admin/manager; no row means the client's `DEFAULT_PROJECT_OVERVIEW` in
`src/dashboards/catalog.ts`). Widgets are data: a closed zod union `DashboardWidget` in `contract.ts` with the grid position inside
each widget; rows with an unknown type are dropped on read. `POST /api/dashboards/data` computes a whole set under
`listVisibleProjects()` like reports; an invisible project yields empty data and one failing widget yields `{type:"error"}` for
itself only; on an overview every widget is forced to that project. Client code is in `src/dashboards/` (pure grid layout in
`grid.ts`; `charts.tsx` is own SVG on `--chart-1…8`, a categorical palette whose order was validated for colour-blind separation on
light and dark surfaces, so do not reorder it or add a ninth; `spec.ts` mirrors contract constants because a value import from
`contract.ts` would pull zod into the bundle, and `spec.test.ts` checks the mirror). Built-in tabs: «Обзор организации»
(`/dashboards/overview`, client constant `DEFAULT_ORG_OVERVIEW`, read-only, «Сохранить как свой» makes a personal copy) and Reports.
Shared dashboards and overviews are in the admin export; personal ones are not. Performance on 100 projects / 50 000 issues is in
[PERFORMANCE.md](PERFORMANCE.md) («Дашборды»): the trend widget is one grouped pass per side, not a subquery per week, and
«Активность» relies on `idx_activity_created`; keep both when touching those queries. Portfolio widgets (projects, projectHealth,
milestones) extend the closed catalogue; server projectHealth uses ordered rules and `CURRENT_DATE` over all issues including
archives.

### Departments ("teams" in the UI)

The UI says «команда» / "team" (owner's request); code, API, DB and env keep `department*`. Names of existing teams are data; the
seed default «Общий отдел» is not renamed because the seed finds it by name on every start.

`department_members` (migration 009) always had `source` (`'ldap' | 'manual'`) but only LDAP sync wrote to it until
`routes/departments.ts` gained `GET/PUT/DELETE …/departments/:id/members(/:userId)` (global admin). `PUT` inserts `source='manual'`
with `ON CONFLICT DO NOTHING`, so a manual add never overwrites a row the sync owns. `DELETE` refuses (409) to remove a
`source='ldap'` row, because the next login or resync would recreate it and the removal would only look like it worked; the real way
is to change the AD group. Both call `invalidateDeptMembership()` (`middleware.ts`) so the 30 s project-visibility cache updates at
once.

### People pickers

Collaborators in `IssueModal`, and project and team members in `AdminView`, use the `ds` `Combobox` over `usersApi.pickable()`:
debounced server-side search, at least 2 characters, at most 20 results, stale responses dropped inside `Combobox`. It replaced flat
`<select>`s that rendered the whole user list (a few hundred people made that unusable) and, later, a hand-written
`UserSearchPicker`. Do not bring back a picker that loads the whole directory.

### Project resolution

`project.ts` (`projectById()`, cached) is resolved per `:projectId`, not a singleton (multi-project since migration 007). There is
still no multi-tenancy in the [ADR-0009](adr/0009-database-per-tenant.md) sense: no `organization_id` anywhere.

## Auth, sessions and WebSocket

### Auth freshness

`requireAuth` verifies the JWT but re-reads `global_role` / `is_active` from the DB (30 s cache, `AUTH_CACHE_TTL_MS`), so role
changes and deactivation take effect without waiting for token expiry. The same lookup compares the token's `sessionVersion` with `users.session_version` (migration 029; it replaced the earlier
`tokens_valid_from` timestamp check); logout and revocations bump it so a copied token stops working immediately. `assertFreshUser` is the DB-freshness half,
factored out so `routes/ws.ts` can reuse it.

There are two cache-invalidation functions, on purpose. `invalidateUserCache(userId)` only evicts the 30 s cache and is safe to call
on any write to a user row, even a no-op (LDAP re-login, an admin re-saving an unchanged row). `revokeUserSessions(userId, reason)`
does that and also closes the user's open `/api/ws` sockets (`closeUserSockets` in `services/wsHub.ts`); call it only for a genuine
revocation (logout, deactivation, a role change that changed something). Conflating them was a real bug caught in review: routing
every LDAP re-login or identical admin PATCH through the socket-closing path force-disconnected other live tabs and devices of users
whose access had not changed.

### WebSocket handshake (`routes/ws.ts`, `services/wsHub.ts`)

Protocol and realtime delivery are in [REALTIME.md](REALTIME.md). The handshake lessons, all found in review:

1. After the `assertFreshUser` round-trip the handler checks `socket.readyState === OPEN` before registering. Without it a slow DB
   call racing the 5 s auth timeout registers an already-closed socket that `unregisterSocket()` (fired from `close`) never runs
   for again, leaking the map entry.
2. `revokeUserSessions()` closes only already-registered sockets, so a revocation landing between `assertFreshUser` and
   `registerSocket()` would find nothing to close. `revokedSince(userId, sinceMs)` closes the gap: the handler stamps
   `handshakeStartedAt` before the round-trip and checks `revokedSince` right after `registerSocket()` with no `await` in between
   (atomic, since Node cannot interleave there), closing the socket itself if a revocation landed mid-handshake.
3. `userId` alone is not a strong enough re-entrancy guard: it is set only after `assertFreshUser` resolves, so a second `auth`
   frame arriving first would start a concurrent verification, possibly for another user, and the loser's `registerSocket()` would
   leak an entry. `authStarted` is a boolean set synchronously before the first `await`. The general shape, a synchronous latch
   set before committing to an async exclusive section, is the fix, not the specific variable.
4. The client (`src/realtime.ts`) resets its reconnect backoff on the `auth_ok` message, not on transport `onopen`. Resetting on
   `onopen` made the backoff never compound on repeated auth failure, and a tab with a revoked token hammered `/api/ws` about once
   a second forever.
5. `services/notify.ts` `emit()` pushes `{type:"notify"}` (no payload, "go refetch") in a try/catch separate from the notification
   insert, so a push failure is not logged as a failed notification. Per-item try/catch also applies in the `storageSweeper.ts`
   delete loop and the `pushToUser` loop: one throwing item must not abort the rest of the batch.

## Background jobs

`services/maintenance.ts` runs its jobs on one `startJob(name, intervalMs, startDelayMs, run)` helper. Before it existed each job
had its own copy of the guard-flag / `setInterval` boilerplate, and a `stopMaintenance()` during an in-flight tick could leave a
guard flag set and wedge that job forever; `startJob` resets it in `stop()`. Jobs and defaults (all configurable, see `config.ts`):

- archive + `audit_log` purge every `MAINTENANCE_INTERVAL_MS` (1 h), first pass after `MAINTENANCE_START_DELAY_MS` (5 min), in
  `MAINTENANCE_BATCH_SIZE` batches under `FOR UPDATE SKIP LOCKED`, capped by `MAINTENANCE_MAX_PER_RUN`; an advisory lock prevents
  overlap with manual maintenance (`GET /api/maintenance`, `POST /api/maintenance/run?dryRun=`); metrics `taskira_background_job_*`.
- `storage-sweep` (`STORAGE_SWEEP_INTERVAL_MS`, 24 h) and, with `AUTH_MODE=ldap` and a bind DN, `ldap-resync`
  (`LDAP_RESYNC_INTERVAL_MS`, 6 h). Their first runs are offset from the base delay (+15 s and +30 s), as are `webhook-dispatch`,
  `due-events` and `recurring` (+20 s, +25 s, +25 s), so a fresh deploy does not run a storage scan, a directory sync and the archive
  pass at the same instant. A full `Storage.list()` costs more than one `UPDATE`.
- The sweeper diffs `Storage.list()` against `attachments.storage_key` and deletes objects with no row (bounded concurrency,
  `DELETE_CONCURRENCY`), skipping anything younger than `STORAGE_SWEEP_GRACE_MS` (24 h): `routes/attachments.ts` calls
  `storage.put()` before the `INSERT INTO attachments`, so a just-uploaded object is briefly visible without a row.
- `notifier.ts` starts only with `NOTIFY_EMAIL_ENABLED`; archiving runs regardless. `MAINTENANCE_ENABLED=false` makes
  `startMaintenance()` start none of these jobs (archive, webhook dispatch, due events, recurring, storage sweep, LDAP resync);
  reminders and the notifier have their own switches. One serving
  API per database ([ADR-0024](adr/0024-single-serving-api.md)); deploy stop-first.

## Licensing

`services/license.ts` (ТЗ 4.3): an RS256-signed token (`header.payload.signature`, base64url, `node:crypto` directly, no JWT
dependency) verified against the `kid`-keyed public-key registry in `server/src/licenseTrustedKeys.ts`, never against `JWT_SECRET`
(a separate symmetric key for sessions). `kid` and a multi-key registry exist from the start; without them a key rotation is
permanent breakage and a leaked private key has no recovery path. Custody, rotation and breach response:
[LICENSE_KEYS.md](LICENSE_KEYS.md); the private key never enters the repo.

- `getLicenseStatus()` reads `instance.license_key` with its own `SELECT`, bypassing the `getInstance()` cache, because
  `scripts/install-license.ts` writes that column from a separate process that cannot call `invalidateInstanceCache()`.
- Seat counting (`countActiveSeats`) counts users who logged in within the license's own `activeWindowDays` (a field in the token,
  not a server constant), not `count(*) FROM users`: LDAP JIT provisioning and background AD resync create user rows with no
  purchaser involvement, so counting rows would exceed a seat limit on day one for any client with a large AD tree.
  `users.last_login_at` (migration `20260922T1600_users_last_login.sql`, set on every successful login) is used instead of
  `audit_log`, whose retention (`AUDIT_RETENTION_DAYS`) is configurable and could silently fall below the license window.
- Expiry is a grace period, not a hard stop: `checkLicenseAndWarn()` (at startup and every 24 h, `startLicenseCheck()`) only writes
  `audit_log` (`license.expired` / `license.invalid` / `license.seats_over_limit`). `requiresPlan(feature)` in `middleware.ts` exists
  but is wired to no route yet. `GET /api/admin/license` is read-only (`routes/license.ts`).

## Server tests

- `resetDb()` in `server/test/helpers.ts` retries on Postgres `40P01` (deadlock, up to 5 attempts). History: `audit()` used to
  write `audit_log` through an un-awaited `void q(...)`, and a late INSERT from the previous test could deadlock with the next
  test's `TRUNCATE`. `audit()` now awaits its INSERT (see the comment in `server/src/audit.ts`), which removes that race; the
  retry stays as protection when several test files run against one test database.
- Tests run in a separate database `taskira_test` (created by `test/global-setup.ts`); files share it, so
  `fileParallelism: false`. See the "Тесты" section of [server/README.md](../server/README.md).
- LDAP, S3 and mail suites are `describe.skip` unless their env vars are set; CI sets them via the `server/docker-compose.*.yml`
  files (`test:ldap`, `test:storage`, `test:mail` scripts).

## Client store

- `src/store.tsx` is a React Context facade (`StoreProvider` / `useStore`), no reducer library; the domain logic is split across
  `src/store/*.ts`. Measured (ТЗ 5.2): every state change re-rendered the whole tree including all board cards. The accepted fix is
  a domain-by-domain move to `useSyncExternalStore` selector subscriptions behind the same facade
  ([ADR-0011](adr/0011-store-selector-subscriptions.md)). Done: board cards take stable props and columns are `memo`
  (`BoardColumn`); toasts and notifications are external stores (`src/store/slices.ts`: `useToasts()`, `useNotifications()`,
  `useUnreadCount()`, not on `useStore()`); modal chunks are preloaded by `src/lazyModals.ts`. Track K measured and reverted a
  stable `useActions()` hook (no reliable browser gain, [TRACK-K](tracks/TRACK-K-BOARD-SPEED.md)); `useIssue(id)` still reads the
  facade, and `src/store/experimental/selectorStore.ts` is not wired in. See [PERFORMANCE.md](PERFORMANCE.md).
- Stale-response guard: async issue reads, PATCH and transitions capture both the project id and the session epoch and ignore stale
  successes and errors after navigation or re-login, even when the project id is unchanged.
- `bootstrap()` in `src/store/session.ts` has one branch per `bootStatus`. `store.bootstrap.test.tsx` exists because a real
  regression reached `main`: `issuesApi.assignedToMe()` returns `{items, truncated, limit}` but the ≥2-project branch assigned the
  whole object to `data.assignedToMe`, so `HomeView`'s `.filter()` crashed the app with no ErrorBoundary. Typecheck and the pure
  tests both missed it because an `as AssignedIssue[]` cast hid the mismatch. When adding a `bootstrap()` branch or changing what an
  API method returns, extend that test instead of trusting types.
- `upsertIssue()` (`src/store/mappers.ts`) replaces the stored issue with the one it is given. It used to force `comments` /
  `activity` back to the previous values "to be safe", which clobbered what `openIssue()` had just fetched, so the card's
  "Комментарии" / "История" counts reflected what was in memory instead of what the server returned. `mapIssue()` already keeps
  `prev?.comments` / `prev?.activity` as defaults for other callers, so callers pass the merged issue. Found by manual smoke
  testing, which is a reminder to click through a UI change rather than trust green tests.
- Server DTOs are camelCase; the store maps them with `mapIssue` / `mapUser` (`src/store/mappers.ts`) and carries comments and
  activity separately (fetched when an issue opens). Mutations are optimistic-ish: call the API, then patch `data` from the returned
  DTO; `moveStatus` re-fetches on failure to undo local drift.
- `idx` next to `data` has prebuilt `Map`s (`users`, `issues`, `statuses`) and the `doneStatusIds` `Set`; use them in list and card
  renders instead of `data.users.find(...)`, which was quadratic across a board.

- `react-hooks/exhaustive-deps` warnings were triaged once (113 findings): one real stale closure (the sidebar `[` shortcut kept
  a narrow-screen `changeCollapsed` after the window grew past 1024 px and skipped the width glide; fixed, test
  `Sidebar.collapse.test.tsx`), 104 deliberate, 8 harmless. Deliberate groups: store action hooks omit `pid`, `local`,
  `setData`, state setters and refs because they are stable; cleanups that bump a generation counter ref (`epoch.current++`) are
  the intended way to cancel a request; mount-only effects (`BoardCard` enter animation, `SidebarResizeHandle`, `ds/Dialog`).
  A new warning in new code is worth reading; the existing ones are not a to-do list.

## Client UI components

- **Popups are `ds` `Menu` / `Popover`, never local open/close state.** They sit on the Popover API, so outside-click, Escape and
  "another popup opened" come from the browser. A real bug came from hand-rolling one: the board card's move menu (opens on click
  and on `m`/`ь`) had its own `useState`, never closed on outside click, and two cards' menus could be open at once, which looked
  like a UI freeze. The old `<Dropdown>` and `DROPDOWN_OPEN_EVT` are gone. jsdom has no Popover API (`showPopover` is guarded);
  query popup content with `hidden: true` in unit tests.
- **Escape handled inside a window must not close it.** `ds` `Dialog` / `SidePanel` close on Escape only if nothing inside called
  `preventDefault()`, and the global Escape handler in `App.tsx` skips `e.defaultPrevented` too. Without that, Escape in the issue
  card's status menu closed the whole card.
- **`ds` `Dialog` takes `onClose` inline.** The old `<Modal>` listed `onClose` in its mount effect's deps, so the effect re-ran on
  every keystroke and re-focused the first focusable element; focus jumped out of the field in every modal. `useNativeDialog`
  (`ds/Dialog.tsx`) holds `onClose` in a ref; keep any new setup in that effect independent of values the caller re-creates per
  render. Initial focus: `[data-autofocus]`, else the first enabled control in the body, else the window; `focusReady` re-runs it
  once a loading placeholder is replaced. Tests: `src/ds/dialog.focus.test.tsx`.
- A window that animates out stays mounted through `Presence`
  (`<Presence show={x}>{(open) => <Window open={open} />}</Presence>`). People avatars are `UserAvatar` / `UserAvatarGroup`
  (`src/components/UserAvatar.tsx`).
- Responsive: below 1024 px the sidebar is a drawer opened by «Меню» in `Topbar.tsx` (`openSidebarDrawer()`), closed by navigation,
  Esc or the scrim; view tabs stay in a scrollable header row. `.glass-edge` sets `position: relative` unlayered, so the drawer's
  `position: fixed` lives in `index.css` (`.side-drawer`), not a Tailwind utility. Below 768 px the issue modal's right-hand panel
  collapses under the main content, the board shows columns vertically in one scroll container, and view side padding drops to
  16 px. Card layout is still desktop-first above that; do not assume mobile parity for anything not listed here.
- Glass and blur: no `backdrop-filter` on large surfaces ([ADR-0023](adr/0023-glass-without-backdrop-blur.md),
  [ADR-0027](adr/0027-task-workspace-design.md)); blur under ~90% of a 3440 px screen cost 10 fps on the board and 13–27 fps in
  dialogs. A personal photo is blurred once in `body::before`. Board plates and card edges come from `--board-col-bg/-line` and
  `--board-card-line`.
- Project calendar ([ADR-0025](adr/0025-project-calendar-portfolio.md)): `/p/:projectKey/calendar`, lazy `CalendarView`, a due-date
  month/week grid starting Monday; visible-range cursor pages are capped at 500 and a separate panel lists unscheduled issues;
  local civil dates; native DnD under issue edit permissions; `M` opens the date picker; Enter creates with the selected due date.
  Calendar is not a project default view.
- Roadmap ([ADR-0021](adr/0021-project-roadmap.md), `RoadmapView.tsx`, `src/roadmapLayout.ts`, server `routes/roadmap.ts`,
  `editRoadmap`): rows keep positions in days and CSS multiplies by `--ppd`, and only rows in the scroll window render; with 100
  projects a zoom switch that re-rendered every row cost 250 ms, mostly style recalc. Reuse `src/timeScale.ts` + `TimeCanvas.tsx`
  (shared with the Timeline) instead of writing a second scale.
- Branding ([ADR-0020](adr/0020-brand-hue-bounded-variable.md), `src/brand.ts`, `BrandMark.tsx`): name, accent hue (`--brand-h` on
  `<html>`, every accent token derives from it; `BRAND_HUE` 255–320 in `contract.ts`, mirrored in `brand.ts`, whole range swept by
  `contrast:check`), PNG/WebP logo. Public `GET /api/instance/brand`; hue and name are cached in `taskira.brand` so
  `public/theme-init.js` applies them before first paint. Use `<BrandMark>` / `useBrandName()` in the shell, not `<Logo>` or the
  literal name.
- Theme and atmosphere are `<html>` attributes (`data-theme`, `data-atmosphere`) set by `applyTheme()` and, before first paint, by
  `public/theme-init.js`; values live in `localStorage` only (`taskira.theme`, `taskira.bg`). The start splash is static markup in
  `index.html` (`#splash`) removed by `src/splash.ts` after the first render.
- Fonts: Manrope only (vendored in `src/assets/fonts/`); `font-mono` in the UI means issue keys, i.e. Manrope with tabular numerals;
  real code uses `--font-code`. Icons are the in-house duotone set in `src/icons.tsx` (`tone` prop for nav colours); logo is
  `<Logo variant="mark|mono|app">`, app-icon files come from `scripts/generate-brand-assets.mjs`.
- `ds` showcase `/dev/ui` (`src/dev/DevUI.tsx`) exists only under `import.meta.env.DEV` in `main.tsx`. `npm run test:ui`
  (Playwright + axe, `e2e/`, baselines in `e2e/__screenshots__`, Linux Chromium of `@playwright/test` 1.56.1, pinned exactly) runs
  in CI only for PRs touching components (`.github/workflows/ui-visual.yml`). jsdom has no jest-dom matchers: use plain
  `getAttribute` / `textContent`. `Button`, `IconButton` and `AvatarGroup` use the lazy `Tooltip` from `ds/LazyTooltip.tsx`, so in
  tests await tooltips (`findByRole("tooltip")`).

## Import (Trello, Jira, Asana)

Import is entirely client-side. `src/import/trello.ts` (`parseTrelloExport`, pure, with a hand-written fixture based on the public
schema; there was no live Trello account to export from) turns a board JSON into `{title, description, labels, dueDate, closed}[]`.
`store.importIssues()` then POSTs each card through the same `issuesApi.create()` a single "Создать" uses, sequentially, with the
same server-side permission check and validation. Trade-off: a server bulk-import endpoint would be untested parsing code running
with real writes; keeping the parser client-side and reusing the tested single-issue path means only the pure parser is new and
needs tests. One summary toast ("Импортировано N из M") replaces per-issue toasts. Each Trello list name becomes a `trello:<list>`
label rather than a workflow status (which list is "done" cannot be derived from the file, and a wrong guess misfiles every
card); members are not mapped to Taskira users for the same reason.

Jira and Asana use their CSV exports: `src/import/csv.ts` keeps repeated columns and quoted line breaks; `jira.ts` and `asana.ts`
are separate pure parsers with hand-written fixtures; status and section names become `jira:` / `asana:` labels. `ImportModal.tsx`
is lazy, opened from the list header and gated by `can("create")`; it limits files to 20 MB, previews skipped and closed issues and
reports progress. No server endpoint or migration is involved. Details: [TRACK-D](tracks/TRACK-D-IMPORT-JIRA-ASANA.md).

## Local environment and Docker

- `npm run dev` in `server/` forces chokidar polling (`cross-env CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=250`). On Windows the
  recursive `fs.watch` that tsx uses by default silently drops change events from atomic-save editors and from tools that write
  through temp file + rename, so the server kept running stale code. `dev:native` opts out. After a large multi-file change,
  restart dev anyway.
- On Windows stop the dev servers before `npm ci`: Vite holds lightningcss's native `.node` file and tsx holds esbuild, and `npm ci`
  dies with `EPERM` halfway, leaving `node_modules` half-deleted; recover with `npm install`.
- `server/.env` is untracked and may hold real development secrets; never paste its contents into shared output.
  `CORS_ORIGIN` must match the client origin (the Vite dev server is `:3000`).
- Behind nginx or a load balancer set `TRUST_PROXY` (feeds Fastify's `trustProxy` in `app.ts`); without it `req.ip` is the proxy,
  which breaks the per-IP login rate limit and the `ip` field in `audit_log`.
- Root `docker-compose.yml` is a separate config surface from `server/.env`: the container reads `environment:` from the compose
  file. `VITE_API_URL` is a build argument of the root `Dockerfile`, so changing it means rebuilding. `DATABASE_URL` interpolates
  `POSTGRES_PASSWORD` without URL-encoding, so a password with `@ / : # %` (plausible from `openssl rand -base64`) mis-parses with
  no obvious error; use `openssl rand -hex 24`. See [DOCKER_SETUP.md](../DOCKER_SETUP.md).
