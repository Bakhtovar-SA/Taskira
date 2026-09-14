# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Taskira — an internal corporate task tracker (board / task list / timeline / workflow editor)
with a role-based permission system. Two independent npm packages:

- **root** — React 18 + TypeScript + Vite SPA (`src/`). UI language and all copy is Russian.
- **`server/`** — Fastify 5 + PostgreSQL + JWT API (`server/src/`). **The permission system's source of truth.**

The client was originally a localStorage-only app; it now talks to the API exclusively
(`src/api/`, `src/store.tsx`). `README.md` (root) and `ARCHITECTURE.md` track the current
design; **`server/README.md`** is the authoritative API contract and data model. `src/seed.ts`
is dead demo data except for `DEFAULT_WORKFLOW`, which `DocsView.tsx` still imports. The
`*_MIGRATION.md` files are historical records of completed schema/feature migrations, in order:
roles (004/006), departments (007), issue collaborators (008), LDAP (009), attachments (010),
notifications (011), UI restructure / drop sprints (012), 4-level priorities (013), issue
links (014), notification dismiss (015), issue lifecycle — `done_at`/`archived_at` (016),
token revocation (017), points → complexity (018), custom fields (020 — 019 is
reserved by a parallel branch not yet merged at the time this was written).

## Commands

Client (run from repo root):

```bash
npm install
npm run dev         # Vite dev server on http://localhost:3000 (strictPort — fails if taken)
npm run build       # production build to dist/
npm run typecheck   # tsc --noEmit
npm test            # vitest run — permissions / validation / store helpers
```

Server (run from `server/`):

```bash
cd server
npm install
cp .env.example .env   # then fill DATABASE_URL, JWT_SECRET (>=32 chars), ADMIN_USERNAME/ADMIN_PASSWORD
npm run dev            # tsx watch (chokidar polling) -> migrations -> seed admin+project -> :8080
npm run dev:native     # same, native fs events (no polling)
npm run build          # tsc -p tsconfig.json -> dist/
npm run start          # node dist/index.js
npm run seed           # run migrate() + seedAdmin() + seedProject() standalone
npm run typecheck      # tsc --noEmit
npm test               # vitest run — access/contract/home/notifications/lifecycle/reports/storage/ldap suites (~140 tests)
```

The server has a **vitest** suite (`server/test/`, `npm test`); it needs a local PostgreSQL
(`vitest.config.ts` / `test/global-setup.ts` spin up a scratch DB). LDAP / S3 / mail suites are
`describe.skip` unless their env vars are set (CI sets them via docker-compose — see
`.github/workflows/test.yml`). The client now has **vitest** too (root `npm test`, `vitest.config.ts`, jsdom + Testing Library
available): `src/*.test.ts` covers the pure logic (permissions, validation, store helpers), and
`src/store.bootstrap.test.tsx` is the first component-level test — it renders `StoreProvider`
via a probe component and drives `bootstrap()` against mocked `./api` responses shaped exactly
like the real endpoints. That test exists because a real regression shipped to `main` unnoticed:
`issuesApi.assignedToMe()` returns `{items, truncated, limit}`, but the ≥2-projects boot branch
assigned the whole object to `data.assignedToMe`, and `HomeView`'s `.filter()` on it crashed the
whole app with no ErrorBoundary — typecheck and the pure-logic tests both missed it because the
`as AssignedIssue[]` cast hid the shape mismatch from `tsc`. When adding a new `bootstrap()`
branch or changing what an API method returns, extend this file rather than trusting types alone.
Full client verification is `npm run typecheck` + `npm test` + `npm run build`, and CI runs all
three. A cross-package check also exists: `server/test/permissions-sync.test.ts` reads
`src/permissions.ts` and `src/validation.ts` from disk and fails if the duplicated `MATRIX` or
`LIMITS` drift from the server copies. **No linter** in either package. A local PostgreSQL
reachable via `DATABASE_URL` is required to run the server at all (`initPool` → `migrate`
happen before `listen`).

## Architecture

### Permission model is defined twice and must stay in sync

`src/permissions.ts` (client) and `server/src/permissions.ts` (server) carry the **same `MATRIX`
and `PermId` union** and the same own-issue rule (`isOwnIssue`), plus `roleHas()` / `denialReason()`.
Each side then adds its own surface: the client has role metadata for the UI (`ACCESS_ROLES`,
`roleMeta`, `canEditIssue(user, issue)`); the server has `ServerUser` / `Membership` / `IssueRef`
and `can(user, membership, perm, issue?)`. Roles: `admin | manager | employee | viewer`. The
client copy exists **only for instant UX feedback** (hiding buttons, lock tooltips); the server
re-checks every mutation and is authoritative. Change the shared parts on both sides identically.

Enforcement points:
- **Client**: `store.tsx` → `requirePerm()` gates every mutating action before the API call and
  toasts `denialReason()` on failure. UI components also call `can()` to disable/hide controls.
- **Server**: Fastify `preHandler` hooks in `middleware.ts` — `requirePerm(perm)` for
  role-level checks, `requireIssuePerm(perm)` for task-level checks (loads the issue into
  `req.issueRef`, applies the "employee can only edit own issues" rule). Both call `requireAuth`
  themselves, so a route lists only the permission hook.
- Task-level rule: `employee` may `edit` an issue only if `assigneeId === me || reporterId === me`.
  `admin`/`manager` edit anything.

### Validation limits are also mirrored

`src/validation.ts` `LIMITS` ↔ `server/src/contract.ts` `LIMITS` + zod schemas. `contract.ts`
is the single source of request/response shapes; the server validates every body/query with it
via `zbody()` / `zquery()` preValidation hooks. Client validation is UX-only; the server repeats it.

### Client data flow

`src/store.tsx` is a single React Context (`StoreProvider` / `useStore`) — no reducer library.
Boot sequence in `App.tsx` → `store.bootstrap()`: if no token in `localStorage` (`taskira.token`),
show `LoginForm`; otherwise call `authApi.me()` + `projectsApi.bootstrap(id)` + `issuesApi.list()`
and populate one flat `Data` object. `bootStatus` drives the shell:
`idle | loading | ready | unauthenticated | error | solo | home` (`solo` = invited to individual
issues but member of no project; `home` = ≥2 visible projects, none entered yet → `HomeView`).

`src/api/index.ts` is the whole HTTP layer: a generic `api()` wrapper plus typed
`authApi` / `projectsApi` / `issuesApi` / `commentsApi` / `collaboratorsApi` / `attachmentsApi` /
`notificationsApi` / `membersApi` / `departmentsApi` / `workflowApi` / `ldapApi` objects.
Errors are normalized to `ApiError { status, code, reason }`; a 401 clears the token.
`API_BASE` comes from `VITE_API_URL` (root `.env`), default `http://localhost:8080`.

Server DTOs are camelCase; the store maps them to client types (`mapIssue`, `mapUser`) and
carries `comments`/`activity` separately (fetched on demand when an issue modal opens).
Mutations are optimistic-ish: call API, then patch `data` from the returned DTO; `moveStatus`
re-fetches issues on failure to undo local drift.

Views (`ViewId`: `board | backlog | timeline | reports | workflow | access | admin | docs | collaborating`)
are switched by `ui.view` in `App.tsx` — no router. `backlog` is internal id for the
"Список задач" view (`Backlog.tsx`, a flat filtered/sorted list — sprints removed in
migration 012). `bootStatus` also has a `"home"` state: with ≥2 visible projects, login
lands on `HomeView.tsx` (Мои задачи + Недавние проекты) before any project is entered.
Deep links to a task use a hash (`#/issue/<pid>/<iid>`) parsed by hand in `App.tsx`.
Keyboard shortcuts (`/`, `C`, `1`–`9` for the nine views, `Esc`) are wired in `App.tsx`;
they are suppressed while a modal is open. `reports` (`ReportsView.tsx`) is project-less —
it reads `/api/reports/*`, which scope themselves to the user's visible projects.

The store also exposes **`idx`** alongside `data`: prebuilt `Map`s (`users`, `issues`,
`statuses`) and a `doneStatusIds` `Set`. Use them instead of `data.users.find(...)` inside
list/card renders — the linear scans were quadratic across a board.

### Trello import is entirely client-side — no server changes, no new migration

`src/import/trello.ts` parses a Trello board's JSON export (`parseTrelloExport`, a pure
function with its own unit tests using a hand-written fixture — there is no live Trello account
in this environment to pull a real export from, so the fixture is only as good as the publicly
documented schema) into `{title, description, labels, dueDate, closed}[]`. `store.importIssues()`
(`store.tsx`) then POSTs each one through the exact same `issuesApi.create()` (and therefore the
exact same server-side permission check and validation) that a normal single "Создать" goes
through — one request per card, sequentially, no new bulk endpoint. That was a deliberate
trade-off: a server-side bulk-import endpoint would mean *untested* parsing code running with
real database writes; keeping the parse client-side and reusing the already-tested single-issue
path means the only new, review-worthy code is the pure parser, and it's the one piece that
actually needed new tests. One summary toast ("Импортировано N из M") replaces per-issue
toasts — 50 "успешно создана" toasts from one import would be noise, not signal. `ImportTrelloModal.tsx`
(entry point: a button in `Backlog.tsx`'s header, gated by `can("create")`) reads the file with
`FileReader`, shows the parsed count and a "include archived Trello cards" checkbox before
committing to anything, and reports live progress during the import. Each Trello list name
becomes a `trello:<list name>` label on the issue (so nothing about the original board structure
is silently discarded) rather than being mapped onto a Taskira workflow status — inventing that
mapping (which Trello list is "todo" vs "done"?) isn't something the file alone can answer
reliably, and getting it wrong would misfile every imported card into the wrong column. Trello
members aren't mapped to Taskira users either, for the same reason — identity across the two
systems doesn't line up, and a wrong-assignee guess is worse than leaving it unassigned. Import
from Jira/Asana was explicitly discussed and deferred — each has its own export shape and would
need its own parser and its own fixture-based tests, not a shared "generic importer."

### Server structure

`index.ts` (bootstrap: config → pool → migrate → seed → `buildApp` → listen) →
`app.ts` (Fastify plugins, unified error handler emitting `{ error: { code, reason } }`,
`/api/health` with DB check, route registration all under `/api`).

- `routes/` — thin HTTP handlers, one file per resource. Permission hook + zod schema in the
  route options, business logic inline or delegated to `services/`.
- `services/maintenance.ts` — background loop: auto-archives issues closed longer ago than
  `ARCHIVE_AFTER_DAYS` (default 30) and prunes `audit_log`. Separate from `notifier.ts`, which
  only starts when `NOTIFY_EMAIL_ENABLED`; archiving must run regardless. With several
  instances, set `MAINTENANCE_ENABLED=false` on all but one.
- `services/reports.ts` / `routes/reports.ts` — reporting. Visibility is resolved through
  `listVisibleProjects()` and passed into queries as `project_id = ANY($ids)`, so the
  visibility predicate is **not** duplicated a fourth time here.
- `services/` — domain helpers: `issues.ts` (DTO map, `nextIssueNum` atomic counter),
  `workflow.ts` (`DEFAULT_STATUSES`/`DEFAULT_TRANSITIONS`, `assertTransition` → 409 on
  illegal move), `rank.ts` (fractional `issues.rank` float8; midpoint insert, column
  rebalance when gap `< 1e-9`, whole calculation under `pg_advisory_xact_lock` keyed by
  status column so concurrent drags into the same slot don't race to the same rank),
  `project.ts` (`currentProject()`, cached — **single project, no multi-tenant**).
  `maintenance.ts` runs three independent background jobs on a shared `startJob(name,
  intervalMs, startDelayMs, run)` helper (not one bespoke timer per job — that was the
  original shape and it triplicated the same ~20 lines of guard-flag/setInterval/log
  boilerplate; `startJob` also makes `stop()` reliably reset the in-flight guard flag, which
  the copy-pasted versions didn't, silently wedging a job forever if `stopMaintenance()` ran
  mid-tick): archive + `audit_log` purge every `intervalMs` (default 1h, `startDelayMs=0`),
  `storageSweeper.ts` every `storageSweepIntervalMs` (default 24h, `startDelayMs=15s` — a full
  `Storage.list()` is pricier than one `UPDATE`), and (when `AUTH_MODE=ldap` + a bind DN)
  `departmentSync.ts`'s LDAP resync every `resyncIntervalMs` (default 6h, `startDelayMs=30s`).
  The staggered `startDelayMs` values exist so a fresh deploy doesn't fire a full storage scan,
  a full LDAP directory sync, and the archive pass all in the same instant. The sweeper diffs
  `Storage.list()` against `attachments.storage_key` and deletes objects with no matching row
  (bounded concurrency, `DELETE_CONCURRENCY` in `storageSweeper.ts` — sequential one-by-one
  network deletes were a review finding too), but skips anything younger than
  `storageSweepGraceMs` (default 24h) — `routes/attachments.ts` writes the object via
  `storage.put()` *before* the `INSERT INTO attachments`, so a just-uploaded object is briefly
  visible to `list()` without a DB row yet; the grace period is the guard against sweeping it
  mid-upload.
- `db.ts` — thin `pg` wrapper: `q` / `one` / `exec` / `withClient` (dedicated client for
  race-free read-then-write). `migrate()` applies `server/migrations/*.sql` in filename order,
  each file in one transaction, tracked in `schema_migrations`.
- `config.ts` — env only (no secrets in code), loaded once and cached. Parses `server/.env`
  itself (no dotenv dep). Fails fast if `DATABASE_URL` missing or `JWT_SECRET` < 32 chars.
- `middleware.ts` — `requireAuth` verifies JWT but re-reads `global_role` / `is_active` from
  the DB (30s in-memory cache) so role changes and deactivation take effect without waiting
  for token expiry. The same lookup checks the token's `iatMs` (milliseconds, not JWT's
  second-granularity `iat`) against `users.tokens_valid_from`; `POST /api/auth/logout`
  (migration 017) bumps that column so a copied/stale token stops working immediately instead
  of surviving to its 12h expiry. Project resources live under
  `/api/projects/:projectId/...` (issues, comments, attachments, collaborators, members,
  workflow); `requirePerm` resolves the caller's membership for that `:projectId`.
  `assertFreshUser(userId, iatMs)` — the DB-freshness half of `requireAuth` (active/revoked
  check), factored out so `routes/ws.ts` can reuse it without going through
  `req.jwtVerify()`'s header-based extraction (a browser `WebSocket` can't set an
  `Authorization` header on the handshake). **Two cache-invalidation functions, not one** —
  `invalidateUserCache(userId)` is cheap and safe to call on *any* write to a user row, even a
  no-op one (LDAP re-login on every successful auth, an admin re-saving an unchanged row): it
  only evicts the 30s cache so the next check re-reads fresh. `revokeUserSessions(userId,
  reason)` does that *and* closes the user's open `/api/ws` sockets (`services/wsHub.ts`
  `closeUserSockets`) — call it only for a genuine revocation (logout, deactivation, a role
  change that actually changed something), never unconditionally on every touch of the row.
  Conflating the two was a real bug caught in review: routing every LDAP re-login or identical
  admin PATCH through the WS-closing path force-disconnected other live tabs/devices for
  users whose access hadn't changed at all.
- `audit.ts` — fire-and-forget `audit_log` inserts; never throws into the request.
- `routes/ws.ts` + `services/wsHub.ts` — `GET /api/ws` (Этап 3c, notification push only,
  *not* the full real-time board `WsMessage` still declares — `issue:upsert`/`presence`
  remain unimplemented). Auth is the connection's first message (`{type:"auth",token}`),
  not a header or query param (the latter would land in access logs) — a 5s timer closes
  the socket (1008) if it never arrives or fails `app.jwt.verify` + `assertFreshUser`. On
  success the server replies `{type:"auth_ok"}` — the client (`store.tsx`) waits for exactly
  this message, not the transport-level `onopen`, to reset its reconnect backoff; resetting
  on `onopen` was a real bug (caught in review) that made the backoff never compound on
  repeated auth failure — a tab with a revoked token hammered `/api/ws` roughly once a second
  forever instead of backing off. `wsHub.ts` keeps a `Map<userId, Set<WebSocket>>`;
  `services/notify.ts` `emit()` calls `pushToUser(id, {type:"notify"})` for every recipient in
  its own try/catch (separate from the notification-creation try/catch above it, so a push
  failure — e.g. a socket closing mid-send — doesn't get logged as if the notification itself
  failed to create) right after the `INSERT INTO notifications` — no notification payload over
  the socket, just a "go refetch" signal, so the client reuses the already-authorized REST path
  instead of a second serialization. Three races worth knowing before touching this, all found
  in review and fixed: (1) the handshake checks `socket.readyState === socket.OPEN` right after
  the `assertFreshUser` DB round-trip, before registering — without it, a slow DB call racing
  the 5s auth timeout registers an already-closed socket that `unregisterSocket()` (fired from
  `close`) never runs for again, leaking the map entry forever; (2) `revokeUserSessions()`
  closes only *already-registered* sockets, so a revocation landing in the DB-round-trip window
  between `assertFreshUser` and `registerSocket()` would find nothing to close and the socket
  would then register anyway, unaffected — `wsHub.ts` `revokedSince(userId, sinceMs)` closes
  this: `routes/ws.ts` stamps `handshakeStartedAt` before the round-trip and checks
  `revokedSince(userId, handshakeStartedAt)` immediately after `registerSocket()` with no
  `await` in between (atomic w.r.t. any concurrent revoke — Node has no other way for code to
  interleave there), closing the socket itself if a revocation landed mid-handshake;
  (4) `userId` alone isn't a strong-enough re-entrancy guard for the `message` handler — it's
  only set *after* `assertFreshUser` resolves, so a second "auth" frame arriving before the
  first's DB round-trip finishes would pass `if (userId) return` too and start its own
  concurrent verification, possibly for a different user, with whichever resolves last winning
  `userId` and the other's `registerSocket()` call leaking an entry nothing ever
  `unregisterSocket()`s. `authStarted` is a separate boolean set synchronously *before* the
  first `await`, so it closes over the whole handshake attempt, not just its outcome — the
  general shape (a sync latch set before you commit to an async exclusive section, checked
  instead of a value only assigned deep inside it) is the fix, not the specific variable.
  `storageSweeper.ts`'s delete loop and `notify.ts`'s push loop got the same class of fix in
  the same review: both used to wrap an entire batch/loop in one `try/catch`, so one failing
  `Storage.delete()` or one `pushToUser()` throw aborted every later item in the same run —
  each is now try/catch'd per-item so one failure doesn't take down the rest.

### Data model notes

Workflow is a DB-backed directed graph: `workflow_statuses` (with stable `sid`:
`todo`/`inprogress`/`review`/`done`) + `workflow_transitions` (edges). Every status change
(`POST /api/projects/:projectId/issues/:id/transition`) is checked against the transitions
table — even an admin cannot move an issue against the schema. `admin` edits the graph via
`POST/DELETE /api/projects/:projectId/workflow/transitions` and `.../workflow/reset` (statuses
are never deleted).

Issue types: `task | bug | request` only (migration 002 collapsed `story`/`epic` → `task`;
grouping survives via nullable `issues.epic_id`, timeline fields `t_start`/`t_span` kept).
Issue keys (`CORP-1`) are assigned by the server via the atomic `project_counters` upsert.
Priorities: `low | medium | high | critical` (migration 013 collapsed the old 5 levels).
Issue links (`issue_links`, migration 014): `relates` (symmetric) or `blocks` (directed);
`blocked_by` is `blocks` seen from the other end, not a stored row. The old numeric
`points` (Scrum story points, dropped from the card UI in round4 but left dangling in the
schema/contract) was replaced outright by `complexity` — a plain three-value scale
(`simple | medium | hard`, `COMPLEXITIES`/`COMPLEXITY_ORDER` in `types.ts` ↔ `COMPLEXITIES`
in `contract.ts`) — migration 018. It has no dedicated client validator, same as
`priorityId`: the type system and a fixed dropdown are enough, no numeric range to check.

Custom fields (`custom_fields`/`custom_field_values`, migration 020, `services/customFields.ts`):
project-level definitions (`text | number | select | checkbox | date`), one value row per
(field, issue) — NULL/absent row means unset, everything stored as `text` regardless of type
since parsing depends on which field it is (`validateValueForField` in the service, not a
static zod schema). Defining fields (`POST/PATCH/DELETE /custom-fields`) reuses the `editWorkflow`
permission rather than a new `PermId` — it's the same "structural project schema" capability as
workflow transitions, and adding a dedicated permission would mean touching the shared MATRIX
(both `permissions.ts` copies + `permissions-sync.test.ts`) for one narrow feature. Setting a
*value* on a specific issue uses plain `edit`, same as priority/complexity/labels. Managed in
`WorkflowView.tsx` (schema-editing screen) alongside the workflow graph, not a separate view.

## Issue lifecycle (migration 016)

`issues.done_at` is set when an issue enters a `done`-category status and **cleared** when it
returns to work; moving between two closing statuses leaves it alone. `issues.archived_at` is
set by the maintenance worker for issues closed longer ago than `ARCHIVE_AFTER_DAYS`.

**Archiving is not deletion** — the row stays, the issue opens by direct link, is searchable
(`?archived=all`) and still counts in reports. It only leaves the project's active working set,
which is what keeps the board and task list from growing without bound. `GET …/issues` returns
active issues by default; `?archived=1` for archived only, `?archived=all` for both.

Anything reporting on "what got done" keys off `done_at` — `updated_at` is not a substitute,
since any edit touches it. The board shows the last 14 days in its done column
(`DONE_WINDOW_DAYS` in `Board.tsx`) and collapses the rest behind "Ранее закрыто".

## Gotchas

- **`server npm test` used to flake with "обнаружена взаимоблокировка" (Postgres 40P01)**
  in `resetDb()`'s `TRUNCATE`, on a different test file each run — root-caused and fixed:
  `audit()` (`audit.ts`) writes to `audit_log` via `void q(...)`, deliberately not awaited by
  callers. If the previous test hit a mutating route, that INSERT can still be in flight when
  the next test's `beforeEach` → `resetDb()` fires; `TRUNCATE` grabs ACCESS EXCLUSIVE on 15
  tables at once (including `users` and `audit_log`) while the background INSERT holds
  `audit_log` and needs an FK-check lock on `users` — a real wait-cycle, not a false alarm.
  `test/helpers.ts` `resetDb()` now retries on `code === "40P01"` (up to 5 attempts); don't
  "fix" this by awaiting `audit()` in production code — that reintroduces the hot-path
  round-trip the fire-and-forget design deliberately avoids.
- **Server imports use `.js` extensions** on relative paths (NodeNext module resolution) even
  though the files are `.ts`. The client uses `allowImportingTsExtensions` and imports `.tsx`/`.ts`.
- **`npm run dev` forces chokidar polling** (`cross-env CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=250`).
  Windows' recursive `fs.watch` (tsx's default) silently drops change events from atomic-save
  editors and from tooling that writes via temp-file + rename, so the server keeps running stale
  code. Polling costs a little CPU and is reliable. `npm run dev:native` opts back out. After a
  large multi-file change, still worth restarting dev to be sure.
- `server/.env` is untracked (git-ignored via `.gitignore`) and never entered git history —
  only `.env.example` files are committed, with empty secret values. The working-tree
  `server/.env` does hold real local-dev values (`JWT_SECRET`, `ADMIN_PASSWORD=qwerty!@#123`,
  db creds `taskira`/`taskira`), so don't paste its contents anywhere shared.
- `CORS_ORIGIN` in `server/.env` must match the client's actual origin — the Vite dev server
  is `:3000` (`strictPort`), which is what `.env.example` now ships.
- Behind nginx/an LB, set `TRUST_PROXY` (`true` or an IP/CIDR list) — it feeds Fastify's
  `trustProxy` (`app.ts`). Without it `req.ip` is the proxy address, which breaks the
  per-IP login rate-limit (`routes/auth.ts`) and the `ip` field in `audit_log`.
- **`docker-compose.yml` (root)** deploys the whole stack (postgres + server + client)
  — see `DOCKER_SETUP.md`. It's a separate config surface from `server/.env`: the
  container reads config from `environment:` in the compose file (`config.ts`'s `.env`
  parser is a no-op fallback when the file doesn't exist, real `process.env` wins either
  way). `VITE_API_URL` for the client is baked in at `docker build` time (`ARG`/`ENV` in
  the root `Dockerfile`) — changing it after the image is built means rebuilding, not just
  restarting. Not built/run locally (no Docker on this dev machine) — verified by re-reading
  the Dockerfiles/compose against the actual `package.json` scripts and `src/index.ts` boot
  sequence, not by executing them. `docker-compose.yml`'s `DATABASE_URL` interpolates
  `POSTGRES_PASSWORD` into a `postgresql://user:pass@host/db` string with no URL-encoding —
  a password containing `@ / : # %` (plausible from `openssl rand -base64`) mis-parses the
  connection string with no obvious error pointing at the cause. `.env.example` recommends
  `openssl rand -hex 24` (URL-safe alphabet) specifically for this variable — don't "fix" a
  broken deploy by switching it back to `-base64`.
- User switching is real login/logout only. The old `switchUser` / `resetDemo` client stubs
  and the "Войти как" role-preview UI were removed (dept branch) — they only re-skinned the
  UI locally and never changed which JWT the API saw.
- Root `package.json` was trimmed to `react` / `react-dom` + dev tooling (Vite, Tailwind,
  TypeScript, Playwright). The old unused deps (`@dnd-kit`, `@supabase/supabase-js`,
  `framer-motion`, `recharts`, `canvas-confetti`, `react-router-dom`, `uuid`, …) are gone —
  the client has no router and no drag lib wired in; hash routing is hand-rolled in `App.tsx`.
- CI (`.github/workflows/test.yml`) now has a `client` job (root `npm run typecheck` +
  `npm test` + `npm run build`) alongside the server/ldap/storage-s3/mail jobs.
- **Theming** (`src/theme.ts` + `src/index.css`): the palette lives in plain custom
  properties on `:root` / `:root[data-theme="dark"]` (`--c-canvas`, …); `@theme` only
  aliases them (`--color-canvas: var(--c-canvas)`) so `bg-canvas` / `text-ink` / etc.
  resolve live per theme. **Don't add raw `#hex` to components** — use a token class or
  `var(--c-*)` in inline styles, otherwise it won't dark-theme. `catColor()` in `ui.tsx`
  returns `var(--c-*)`. Theme mode (`system|light|dark`) and one of 6 background presets
  are in `localStorage` only (`taskira.theme` / `taskira.bg`), applied to `<html>` by
  `applyTheme()`; the profile-menu "Оформление" popup (`AppearanceSettings` in `ui.tsx`)
  is the UI. Sidebar-internal colors stay hardcoded (the rail is dark in both themes).
- **Responsive layout**: below 768px the issue modal's right-hand panel (status, assignee,
  due date, labels) collapses under the main content instead of sitting beside it, the
  sidebar hides in favor of a native `<select>` in `Topbar.tsx` carrying the same sections
  and visibility rules (admin-only "Департаменты", collab-only "Мои подключения"), and view
  side padding drops to 16px. Card layout is still desktop-first above that breakpoint —
  don't assume mobile parity for anything not explicitly listed here.
- **`<Dropdown>` (`ui.tsx`) is the only correct way to build a popup menu** — it closes on
  outside click, on Escape, and on any *other* dropdown opening (`DROPDOWN_OPEN_EVT`, a
  `window` `CustomEvent` broadcast — exported specifically so hand-rolled popups outside
  `ui.tsx` can subscribe to it). A real bug shipped from skipping it: the board card's move
  menu (`Board.tsx`, the small arrow icon — opens on click *and* on `m`/`ь` for
  keyboard-only status changes, which `<Dropdown>` doesn't support, hence the hand-rolled
  state instead of reusing the component outright) had its own local `useState` with none of
  that — it never closed on outside click, and two different cards' menus could be open at
  the same time, looking exactly like a UI freeze. Fixed by giving it the same two
  `useEffect`s `<Dropdown>` has (listen for `DROPDOWN_OPEN_EVT` from others, listen for
  outside `mousedown`) instead of switching it to `<Dropdown>` outright. If you add another
  bespoke open/close popup anywhere, wire it into `DROPDOWN_OPEN_EVT` the same way — plain
  local boolean state is not enough by itself.
