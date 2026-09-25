# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Taskira — an internal corporate task tracker (board / task list / timeline / workflow editor)
with a role-based permission system. Two independent npm packages:

- **root** — React 19 + TypeScript + Vite 8 SPA (`src/`). Was Russian-only; `src/i18n/` (added in
  the i18n-foundation branch) now covers the app shell and issue-creation/board flows in RU+EN —
  see the i18n section below for exactly what is and isn't covered yet.
- **`server/`** — Fastify 5 + PostgreSQL + JWT API (`server/src/`). **The permission system's source of truth.**

The client was originally a localStorage-only app; it now talks to the API exclusively
(`src/api/`, `src/store.tsx`). `README.md` (root) and `ARCHITECTURE.md` track the current
design; **`server/README.md`** is the authoritative API contract and data model. `src/seed.ts`
is dead demo data except for `DEFAULT_WORKFLOW`, which `DocsView.tsx` still imports. The
`*_MIGRATION.md` files are historical records of completed schema/feature migrations; the list of
migrations is generated from `server/migrations/` into [docs/MIGRATION-LIST.md](docs/MIGRATION-LIST.md) and the
permission table into [docs/PERMISSIONS.md](docs/PERMISSIONS.md) — don't maintain either by hand. Sprints (migration
023) are an optional, off-by-default module and a deliberate exception to migration 012's removal, not a reversal of
it (ADR-0002/0003).

**Decisions live in [docs/adr/](docs/adr/README.md).** An ADR records a decision on its date and never goes stale: it is
`Accepted` or `Superseded by ADR-MMMM`. Changing an architectural decision = a **new ADR** with a
`Supersedes ADR-NNNN` line; the old ADR gets only `Status: Superseded by ADR-MMMM` — its content is never edited.
Generated docs (`npm run permissions:generate`, `npm run docs:generate`) are checked in CI (job `types`).

Database changes must follow [docs/MIGRATIONS.md](docs/MIGRATIONS.md): immutable legacy
migrations, timestamp-prefixed new files, transactional execution, and expand/contract across
separate releases. CI rejects unmarked destructive contract operations.

Security-facing behavior and claims must stay aligned with
[docs/SECURITY_OVERVIEW.md](docs/SECURITY_OVERVIEW.md). Vulnerability reporting is documented
in [SECURITY.md](SECURITY.md); do not add credentials, customer data, or private reports to issues.
License key storage/rotation/breach procedure is [docs/LICENSE_KEYS.md](docs/LICENSE_KEYS.md) — the
private signing key itself never goes in the repo, only its public half
(`server/src/licenseTrustedKeys.ts`).

## Commands

Client (run from repo root):

```bash
npm ci                # after every pull/merge from main — never trust an existing node_modules (React/Vite versions
                      # have moved under people before: a stale install gives phantom type errors, e.g. RefObject).
                      # WINDOWS: STOP the dev servers first (Vite holds lightningcss's native .node open) — otherwise
                      # `npm ci` dies with EPERM halfway and leaves node_modules half-deleted; recover with `npm install`.
npm run dev         # Vite dev server on http://localhost:3000 (strictPort — fails if taken)
npm run build       # production build to dist/
npm run typecheck   # tsc --noEmit
npm test            # vitest run — permissions / validation / store helpers
npm run bundle:check    # after build: gzip JS/CSS vs scripts/bundle-budget.json (CI, docs/design/PERF-BUDGET.md)
npm run perf:rerenders  # re-render measurement tables (src/perf/, ADR-0011); same file runs silently in npm test
```

Server (run from `server/`):

```bash
cd server
npm ci                 # same rule as the client: after every pull, dev server stopped first on Windows (tsx holds esbuild)
cp .env.example .env   # then fill DATABASE_URL, JWT_SECRET (>=32 chars), ADMIN_USERNAME/ADMIN_PASSWORD
npm run dev            # tsx watch (chokidar polling) -> migrations -> seed admin+project+instance -> :8080
npm run dev:native     # same, native fs events (no polling)
npm run build          # tsc -p tsconfig.json -> dist/
npm run start          # node dist/index.js
npm run seed           # run migrate() + seedAdmin() + seedProject() + seedInstance() standalone
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

### Permission matrix: one source, two generated copies; the logic on top is mirrored and behaviour-tested

`shared/permissions.matrix.json` is the **only** place to change `MATRIX`, `PermId`, role/permission names and the
permissions doc table. `npm run permissions:generate` (`scripts/generate-permissions.mjs`) writes
`src/permissions.matrix.ts` and `server/src/permissions.matrix.ts` (identical content) and `docs/PERMISSIONS.md`; never
edit them by hand — `npm run permissions:check` (CI job `types`, and `server/test/permissions-sync.test.ts`) fails on any
drift. A shared *import* is impossible by design: the server builds from `server/` (Dockerfile, `rootDir: src`), the
client from the repo root with `server/` in `.dockerignore`. What stays duplicated in code — `resolveRole`, `isOwnIssue`,
`roleCan`/`can`, `denialReason` in `src/permissions.ts` ↔ `server/src/permissions.ts` — is verified by behaviour:
the sync test runs client `can()`/`denialReason()` against the server's on every role × permission × own/foreign issue
combination. The client copy exists **only for instant UX feedback**; the server re-checks every mutation and is
authoritative. Client-only extras (`ACCESS_ROLES` colors, `summarize`, …) stay in `src/permissions.ts` fed by the matrix.

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
**Response types (TZ 2.1):** `contract.ts` holds zod schemas for API responses (`IssueDto`, `ProjectBootstrapDto`,
`NotificationDto`, `ReportSummaryDto`, …). Server mappers/handlers are annotated with the `z.infer` types and the client
imports the same types (`import type` from `../../server/src/contract`; root has `zod` as a devDependency for types only —
nothing reaches the bundle). `src/types.ts` aliases them for pure mirrors and keeps only real view-models (ms timestamps
etc.). Those schemas are **type sources only, never `.parse()`d at runtime** — they do not guarantee a mapper returns what
it declares (SQL rows are cast `q<Row>`); don't assume the API is protected from drift against the DB because a schema
exists. Still hand-written: request-side client params (`IssueFilterParams`, `IssueTemplateInput`, `ReportFilter`) and
small inline envelopes in `src/api/index.ts` (login, auth config, LDAP ping/resync, member PUT, link/checklist/custom-field
wrappers, transition, sprint complete). CI job `types` typechecks server and client together (UI-02: not verifiably a
required check). The old text-emitting `generate-client-contracts.mjs` / `contracts:check` is gone.

### Client data flow

`src/store.tsx` is a React Context (`StoreProvider` / `useStore`) — no reducer library. Measured (ТЗ 5.2):
every state change re-rendered the whole tree incl. all board cards; the accepted fix is a domain-by-domain move to
`useSyncExternalStore` selector subscriptions behind the `useStore()` facade
([ADR-0011](docs/adr/0011-store-selector-subscriptions.md)). Done so far (steps 0–2): board cards take stable props
and columns are `memo` (`BoardColumn`), so they don't depend on the context; toasts and notifications live in
external stores (`src/store/slices.ts`) — read them with `useToasts()` / `useNotifications()` / `useUnreadCount()`,
they are **not** on `useStore()` anymore. Modal chunks are preloaded via `src/lazyModals.ts`.
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
are switched by `ui.view` in `App.tsx`, reflected into real, human-readable URLs
(`/p/:projectKey/<view>`, `/reports` — the one exception, project-less) by
`useRouterSync.ts` — `wouter` (ADR-0008), not a hand-rolled hash parser (ТЗ 3.1, plan v2
Track 3; see that file's own header comment for the bidirectional-sync design and the
race it guards against). `backlog` is internal id for the "Список задач" view
(`Backlog.tsx`, a flat filtered/sorted list — sprints removed in migration 012).
`bootStatus` also has a `"home"` state: with ≥2 visible projects, login lands on
`HomeView.tsx` (Мои задачи + Недавние проекты) before any project is entered — its URL
is `/`. Deep links to a task (`/p/:projectKey/issue/:issueKey`) resolve the human-readable
key via `GET /api/issues/resolve` (`server/src/routes/search.ts` — the key is globally
unique, so no project needs to be named to resolve it) before opening the issue; `src/router.ts`
holds the pure path helpers/parser. `nginx.conf`'s `try_files $uri /index.html` (and Vite's
dev-server default) is what makes a hard refresh on one of these paths work — required now
that the path itself carries state, unlike the old hash-only scheme.
Keyboard shortcuts (`/`, `C`, `1`–`4` for the project views — board/list/timeline/sprints, `G` then `H`/`R`/`S` for
home/reports/project settings, `Esc`, `?` help — ADR-0013 §7) are wired in `App.tsx`;
they are suppressed while a modal is open. `⌘K`/`Ctrl+K` (matched by `e.code`, so it works in the Russian layout)
opens the command palette from anywhere (`CommandPalette.tsx`, lazy chunk; `src/palette/` — fuzzy + wrong-layout
matching, recent issues in `localStorage`, `openPalette()` event for buttons). `reports` (`ReportsView.tsx`) is project-less —
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

### Client i18n (RU/EN) — foundation, not full coverage

`src/i18n/` — `ru.ts` (the source-of-truth dictionary, flat `"domain.key"` strings, `as const`),
`en.ts` (typed `Record<keyof Dict, string>` — TS refuses to compile if a key is missing *or*
if an extra one is added that `ru.ts` doesn't have, so the two can't silently drift), and
`index.tsx` (`I18nProvider` + `useT()` → `{ lang, setLang, t, tn }`). `t(key, params?)` does
`{param}` interpolation; `tn(n, oneKey, fewKey, manyKey)` picks the grammatically correct
dictionary key for a count (Russian 1/2-4/5+ with the 11-14 exception, English singular/plural)
— use it instead of a local `plural()` helper (two near-identical copies of one existed in
Board.tsx and HomeView.tsx before this existed; both are gone now). Language is `localStorage`
only (`taskira.lang`, default `"ru"`), switched from the same "Оформление" popup as the theme
picker (`AppearanceSettings` in `ui.tsx`) — no server involvement, same pattern as `theme.ts`.

**What's actually covered**: the app shell (`LoginForm`, `Sidebar`, `Topbar`, `HomeView`,
`Toasts`, `AppearanceSettings`), the `Board` view, and `CreateIssueModal` — plus the shared
`issueType.*` / `priority.*` / `complexity.*` labels, which is why those three read from the
dictionary instead of a `.name` field on `ISSUE_TYPES` / `PRIORITIES` / `COMPLEXITIES` in
`types.ts` now (those constants keep only `id` + ordering; call sites do
`t(\`priority.${p}\`)`, which TS checks against the dictionary's key union because
`PriorityId`/`IssueTypeId`/`ComplexityId` are string-literal unions — a template literal type
substituting one of those into `t()`'s `TKey` parameter only compiles if the dictionary
actually declares every resulting key). **What's still Russian-only, deliberately deferred
rather than half-translated**: the rest of `IssueModal` (only its Priority/Due-date/Complexity
fields were converted; Status/Assignee/Direction/Labels/Links/Collaborators/Attachments and the
comments/activity tabs weren't), `Backlog`/`SoloView`/`DocsView` beyond their `ISSUE_TYPES`-type
filter dropdown or reference tables, `AdminView`, `PermissionsView`, `WorkflowView`,
`ReportsView`, `CollaboratingView`, `SprintsView`, `ErrorBoundary`, and every `toast(...)` call
in `store.tsx`/`App.tsx`. Extend file-by-file the same way rather than assuming the dictionary
is exhaustive.

**Server-originated text is a separate, harder problem, not yet started**: `ApiError.message`
(shown directly in toasts, e.g. login failures, validation rejections) is the server's `reason`
string, which is Russian regardless of the client's language — the server has no locale
awareness at all. Localizing that means either giving the server an `Accept-Language`-driven
reason catalog keyed by `ApiError.code` (the code is already machine-readable; the human
`reason` isn't), or having the client map `code` → a dictionary key and ignore `reason` for
known codes, falling back to the raw (Russian) string only for the unmapped remainder. Don't
add English strings to server route handlers directly — that just swaps which single language
is hardcoded.

User-authored or admin-configured content is **out of scope for `t()` by design, not an
oversight**: workflow status names, project/department names, issue titles/descriptions,
comments, and job-role text all come from the database and stay whatever language the person
who typed them used — there is no dictionary key for someone's actual data.

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
  `project.ts` (`projectById()`, cached — resolved per `:projectId`, not a singleton: multi-project
  within one installation since migration 007. **No multi-tenant** in the ADR-0009 sense still
  holds — no `organization_id` anywhere — but "single project" stopped being true back at that
  migration and this line just hadn't caught up; see [docs/adr/0009-database-per-tenant.md](docs/adr/0009-database-per-tenant.md)).
  `maintenance.ts` runs three independent background jobs on a shared `startJob(name,
  intervalMs, startDelayMs, run)` helper (not one bespoke timer per job — that was the
  original shape and it triplicated the same ~20 lines of guard-flag/setInterval/log
  boilerplate; `startJob` also makes `stop()` reliably reset the in-flight guard flag, which
  the copy-pasted versions didn't, silently wedging a job forever if `stopMaintenance()` ran
  mid-tick): archive + `audit_log` purge every `intervalMs` (default 1h, first pass after `MAINTENANCE_START_DELAY_MS`, default 5 min, in `MAINTENANCE_BATCH_SIZE` batches under `FOR UPDATE SKIP LOCKED`, capped by `MAINTENANCE_MAX_PER_RUN`; one executor per cluster via `pg_try_advisory_lock`; metrics `taskira_background_job_*`; admin `GET /api/maintenance` + `POST /api/maintenance/run?dryRun=` — MAINT-01),
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
- `services/license.ts` (ТЗ 4.3, plan v2 Track 4) — offline license: an RS256-signed token
  (`header.payload.signature`, base64url, `node:crypto` directly — no new JWT dependency), verified
  against `server/src/licenseTrustedKeys.ts`'s `kid`-keyed public-key registry, never against
  `JWT_SECRET` (that's a separate, symmetric key for user sessions). `kid` support and a multi-key
  registry are there from the start — without it, key rotation is permanent breakage, and a leaked
  private key has no recovery path. `getLicenseStatus()` reads `instance.license_key` with its own
  `SELECT`, deliberately bypassing `services/instance.ts`'s `getInstance()` cache, since
  `scripts/install-license.ts` writes that column from a separate one-off process with no way to
  call `invalidateInstanceCache()` on the running server. Seat counting (`countActiveSeats`) counts
  users who logged in within `activeWindowDays` (a field *in the license itself*, default 30 at
  issuance — not a server constant), not `count(*) FROM users`: LDAP JIT-provisioning
  (`userProvisioning.ts`, `departmentSync.ts`) creates user rows automatically on first login and on
  background AD resync, with no purchaser involvement, so counting all rows would blow a seat limit
  on day one for any client with a large AD tree, regardless of how many people actually use
  Taskira. `users.last_login_at` (migration `20260922T1600_users_last_login.sql`, set in
  `routes/auth.ts` on every successful login) is what this counts against — not `audit_log`, whose
  retention (`AUDIT_RETENTION_DAYS`) is independently configurable and could silently drop below the
  license's window. Expiry is a grace period, not a hard stop: `checkLicenseAndWarn()` (run at
  startup and once every 24h, `startLicenseCheck()`/`stopLicenseCheck()`) only writes
  `audit_log` (`license.expired` / `license.invalid` / `license.seats_over_limit`); nothing blocks a
  request. `requiresPlan(feature)` (`middleware.ts`, same shape as `requirePerm`) exists but is
  intentionally wired to zero routes in this PR. `docs/LICENSE_KEYS.md` covers private-key custody,
  rotation, and breach response — the private key itself never enters this repo.
- `db.ts` — thin `pg` wrapper: `q` / `one` / `exec` / `withClient` (dedicated client for
  race-free read-then-write). `migrate()` applies `server/migrations/*.sql` in filename order,
  each file in one transaction, tracked in `schema_migrations`. New migration policy and naming
  are defined in [docs/MIGRATIONS.md](docs/MIGRATIONS.md); do not allocate another sequential
  number after the legacy `001`–`029` series.
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

Multiple assignees (`issue_assignees`, migration 025, `services/issues.ts`): the old single
nullable `issues.assignee_id` was replaced outright by a join table — a flat list, no "primary"
assignee, same shape as `issue_collaborators` (008) but a materially different concept: a
collaborator is invited to one issue, sees it and can comment, but is never assignable; an
assignee is a real project member doing the work, and there can now be zero, one, or several.
`isOwnIssue` (both `permissions.ts` copies) widened from `assigneeId === me` to
`assigneeIds.includes(me)` — an employee can edit an issue if they're *any* of its assignees, not
just its sole one. `mapIssue(row, assigneeIds)` takes the ids as an explicit second argument
rather than reading them off the row, since they no longer live in `issues` — callers either
batch-load them for a list (`listAssigneeIdsBatch`, one query for N issues, not N) or load one
issue's at a time (`listAssigneeIds`); `requireIssuePerm`'s hot path aggregates them into
`IssueRef` with `array_agg` in the same round-trip as the rest of the row, not a second query.
`PATCH .../issues/:id` treats `assigneeIds` as a full-list replacement (like `labels`), diffs
it against the previous set for activity log lines and to notify only the *newly* added
assignees (never a no-op re-notify of someone already on the issue), and writes the join table
only when that diff is non-empty. Reports' `groupBy=assignee` breakdown deliberately fans out an
issue across every one of its assignees (an issue with two assignees contributes to both rows) —
overall totals are unaffected since that join only appears in the breakdown query, not the
totals query; the CSV export instead `string_agg`s names into one cell, since a row-per-issue
export can't fan out. `assignableUsers()` (client `store.tsx`) takes the issue's current
`assigneeIds` (not a single id) so someone already assigned but since removed from the project
still shows up in the picker instead of silently vanishing.

Checklist (`checklist_items`, migration 019, `services/checklist.ts`): one row per item, on
the same `edit`-permission model as `issue_links` — no dedicated permission, whoever can edit
the issue manages its checklist. `position` is an integer assigned once at insert time
(`COALESCE(MAX(position)+1, 0)` in the same `INSERT`) and never rewritten — there is
deliberately no reorder endpoint in v1 (see the comment in the migration itself: if
drag-and-drop ordering is ever needed, move to a fractional rank like `issues.rank`
rather than adding one preemptively for a feature that doesn't exist yet). Two concurrent
adds can race to the same position; `listChecklistItems` breaks the tie with `created_at`
as a secondary sort instead of taking a lock over something this low-stakes. Activity
(`logActivity`) is only written for add/remove, not for every check/uncheck — else the
issue's history feed would drown in checkbox toggles. `LIMITS.checklistItemsPerIssue` (50)
and `LIMITS.checklistItem.text` mirror between `server/src/contract.ts` and
`src/validation.ts` like every other limit.

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

Subtasks (`issues.parent_id`, migration 021): exactly two levels, no arbitrary nesting —
`assignParentLocked()`/`validateParentAssignmentTx()` (`services/issues.ts`) refuse to set
`parentId` to an issue that already has a parent itself (no "subtask of a subtask"), and refuse
to give an issue a parent if it already has children of its own (no turning an existing parent
into someone's child, which would silently make its own children three generations deep). The
validation and the actual `INSERT`/`UPDATE` run inside one transaction under
`pg_advisory_xact_lock` (same idiom as `rank.ts`), locked on both issues involved (the candidate
parent and, when it already exists, the issue being reparented) — without this, two concurrent
`PATCH`es could each pass validation against stale state and together build a 3-level chain
(caught in review, PR #46). This is deliberately independent of `epicId` ("direction" — a
free-form grouping with no depth limit and no link back to completion status); an issue can be
both in a direction and someone's subtask at once. There is **no dedicated subtasks endpoint** —
the client already loads the project's full active issue list into `data.issues` and filters by
`parentId` locally (`IssueModal.tsx`'s subtasks section), the same way `TimelineView` already
groups by `epicId` client-side; adding a server list endpoint for something the client can
already derive for free would just be a second source of truth to keep in sync. `+ добавить
подзадачу` opens `CreateIssueModal` with `ui.createParentId` pre-set (`store.tsx`'s
`openCreateSubtask()`, separate from the plain `setCreateOpen()` so a normal "Создать" doesn't
inherit a stale parent from a previous subtask flow) — the parent is fixed for that create, not
user-editable in the form, since the whole point of the button is "a child of *this* issue."
Deleting a parent does not delete its subtasks (`ON DELETE SET NULL`, same as `epicId`) — the
child becomes an ordinary standalone issue rather than disappearing silently, and `deleteIssue()`
on the client mirrors that FK by nulling `parentId` on the affected rows already in `data.issues`
(same as it already did for `epicId`) so the UI doesn't show a dangling reference before the next
refetch. Snapping `parentId` to `null` (unassigning) goes through `withIssueParentLock()` — the
same advisory-lock helper `assignParentLocked()` uses, factored out — so a concurrent assign and
unassign on the same issue serialize on the same primitive (`services/issues.ts`). The list of
subtask rows shown in `IssueModal.tsx` is still derived from the client's already-loaded
`data.issues` (active issues only, like everywhere else in the app), but the *count* badge
("Подзадачи · N/M") comes from `getIssueDto.subtasksSummary` — a small aggregate query counting
**all** children including archived ones — because the plain client-side filter would otherwise
make the badge silently regress when a closed subtask ages into the archive (archiving isn't
deletion; see Issue lifecycle below).
Issue templates (`issue_templates`, migration 022, `services/issueTemplates.ts`): project-level
presets (`name`, `typeId`, `priorityId`, a default title, a default description, and an optional
starting `statusId`) managed from `WorkflowView.tsx` under the same `editWorkflow` permission as
the workflow graph and custom fields — a third instance of "this is project-schema configuration,
not worth a dedicated `PermId`." Applying one is **pure client-side prefill**: `CreateIssueModal`'s
"Шаблон" dropdown copies the template's fields into the form's local state once, on selection —
nothing is sent to the server about which template (if any) was used, and nothing stops the user
from editing every field afterward. There is deliberately no link between a created issue and the
template it came from; the template is a starting point, not a stamped relationship. Scoped
independently of `checklist_items`/`issues.parent_id` (separate, unmerged branches at the time
this was written) — a template does not (yet) carry a checklist or subtask structure to copy in;
folding template support for those in is natural follow-up work once those branches land, not
part of this one.

Sprints (`sprints`/`issues.sprint_id`, migration 023, [SPRINTS_MIGRATION.md](SPRINTS_MIGRATION.md)):
an **optional, off-by-default** module, not part of the base workflow — migration 012 removed
sprints entirely (dead functionality, `SCOPE.md` scoped them out from the start) and that decision
still holds for any project without the flag. `project.sprintsEnabled` gates it end to end: every
`/sprints*` route and `PATCH .../issues/:id/sprint` 404 when it's off, regardless of role — not
merely hidden in the UI. `manageSprints` (`admin`/`manager`) is a restored `PermId`, gating sprint
CRUD *and* assigning an issue to a sprint (the latter via its own `PATCH .../issues/:id/sprint`
sub-route, not a branch inside the general issue `PATCH` — unlike the pre-012 version, which had
both; not worth reproducing that redundancy now that checklist/custom-field/link sub-routes
already establish the "dedicated sub-route per concern" pattern). At most one `active` sprint per
project is a DB-level guarantee (`uq_sprints_one_active_per_project`, a partial unique index), not
just a route check. Completing a sprint moves its unfinished issues (`done_at IS NULL`) back to
the backlog (`sprint_id = NULL`) in one transaction; there is no auto-carry into a next sprint.
`project.sprintsEnabled` is a deliberately minimal capability flag — the seed of a future
`ProjectCapabilities` model (sprints, WIP limits, estimation mode, board layout, vocabulary) that
a later pass will generalize, not reinvent; this migration does not build that model, only the one
flag it needs today.

Department membership (`department_members`, migration 009) has always had a `source` column
(`'ldap' | 'manual'`), but only the LDAP sync path (`departmentSync.ts`) ever wrote to it until
now — there was no route or UI for `source='manual'` despite the schema explicitly being built
for it (see that migration's own comment). `routes/departments.ts` now has
`GET/PUT/DELETE .../departments/:id/members(/:userId)` (global-admin only, like the rest of that
file): `PUT` inserts `source='manual'` (idempotent, and it won't overwrite an existing
`source='ldap'` row — `ON CONFLICT DO NOTHING`, so a manual add never fights a row the sync
already owns); `DELETE` refuses (409) to remove a `source='ldap'` row, since the next login or
scheduled resync would just recreate it and silently make the removal look like it worked when
it didn't — the only real way to drop an LDAP-sourced membership is from the AD group itself.
Both routes call `invalidateDeptMembership()` (`middleware.ts`) so the 30s project-visibility
cache picks up the change immediately rather than on its own schedule.

`UserSearchPicker` (`ui.tsx`) is a small reusable component wrapping `usersApi.pickable()`
(debounced server-side search, ≥2 characters, ≤20 results — the same endpoint the issue
collaborator picker already used) with a search box + select + add button. It replaced three
independent flat, unsearchable `<select>`s that each rendered the *entire* user list as options
(`AdminView.tsx`'s project-member add, the new department-member add, and — after refactoring —
`IssueModal.tsx`'s collaborator picker, which had its own copy of the same debounce logic before
this existed): on an organization with a few hundred people, scrolling a plain `<select>` to find
one name was the actual complaint that motivated this. `AdminView.tsx` still keeps a separate,
admin-only `usersApi.list()` fetch, but only to build a `Set` of admin user ids so they can be
excluded from the project-member picker's candidates (admins already have implicit full access);
that fetch no longer drives the visible candidate list itself.

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
- **Theming / design tokens** (ADR-0012 + ADR-0016, [docs/design/DESIGN.md](docs/design/DESIGN.md)): every colour lives in
  `src/styles/tokens.css` — OKLCH primitives (`--violet-*`, `--gray-*`, hue 288) → semantic tokens (`--bg-*`,
  `--text-1/2/3`, `--border-*`, `--accent-*`, `--status-*`, `--elev-*`) → aliases of the old `--c-*` names, so old
  classes (`bg-canvas`, `text-ink`, …) still resolve ([docs/design/ALIASES.md](docs/design/ALIASES.md)). Themes
  override only the semantic layer. **Don't add raw `#hex`/`rgb()` to components** — `npm run colors:check` fails CI;
  `npm run contrast:check` fails CI if a declared text/background pair drops below 4.5:1. Theme and atmosphere preset
  are `<html>` attributes (`data-theme`, `data-atmosphere`) set by `applyTheme()`
  and, before first paint, by `public/theme-init.js`; values are `localStorage` only (`taskira.theme` / `taskira.bg`).
  ADR-0016 (supersedes parts of 0012): the sidebar (`.glass-side`) and the work sheet (`.glass-sheet`) are glass over
  the atmosphere glow on `body` (no grain); popovers/menus/toasts use `.glass`; never glass on task cards or forms.
  Font is Manrope only (vendored in `src/assets/fonts/`); `font-mono` in the UI means issue keys = Manrope with tabular
  numerals, real code uses `--font-code`. Icons are the in-house duotone set in `src/icons.tsx` (`tone` prop for nav
  colours); logo is `<Logo variant="mark|mono|app">`, app-icon files come from `scripts/generate-brand-assets.mjs`.
- **Dynamic style values under the CSP** ([ADR-0010](docs/adr/0010-dynamic-styles-under-csp.md), verified in Chromium by
  `npm run csp:spike`): CSSOM writes (`el.style.x`, `setProperty('--x')`, WAAPI `el.animate`) are allowed by
  `style-src-attr 'none'`; `style=""` in markup, `setAttribute('style')` and `<style>` are blocked. `secure-jsx`
  currently turns every distinct `style` value into a new rule in `public/dynamic.css` (unbounded) — for continuous
  values (positions, progress, colours from data) set a custom property via ref/CSSOM and consume it from a static rule;
  enumerable states go in `data-*` attributes. Browser matrix: [docs/design/BROWSERS.md](docs/design/BROWSERS.md).
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
- **`<Modal>` (`ui.tsx`) takes `onClose` as a prop, and almost every caller passes it inline**
  (`onClose={() => setX(false)}`) — a fresh function on every render of the caller. `Modal`'s
  mount effect (focus-trap setup, initial focus, Esc handling) used to list `onClose` in its
  dependency array; since typing into any field inside the modal re-renders the caller and
  therefore creates a new `onClose`, that effect was tearing down and re-running on *every
  keystroke* — and re-running it means re-focusing the first focusable element in the dialog,
  which in most modals is the header's close (×) button, since it sits before the body's inputs
  in the DOM. Symptom: type one character into a title/description/label field and focus jumps
  to the × button or a link, every modal in the app, not just one. Fixed by holding `onClose` in
  a `ref` (`onCloseRef`, updated every render, read from inside the Esc handler) so the mount
  effect's deps can safely be `[]` — it now really does run once. If you add new imperative setup
  to that effect, keep it independent of anything the caller re-creates per render, or route it
  through a ref the same way.
- **`upsertIssue()` (`store.tsx`) used to force `comments`/`activity` back to whatever was
  already in `data.issues` for that id**, "to be safe." Its only caller, `openIssue()`, calls
  `mapIssue()` (which itself already defaults to `prev?.comments`/`prev?.activity` for every
  other caller — list refresh, `updateIssue`, `moveStatus`, …) and then deliberately *overwrites*
  `mapped.comments`/`mapped.activity` with what it just fetched from `GET .../comments` and
  `GET .../activity`, specifically so the card shows real data on open. `upsertIssue()`'s extra
  "safety" clobbered exactly that overwrite back to the stale (usually empty) values already in
  the list — so the "Комментарии"/"История" tab counts and content on a freshly opened card never
  reflected what the server actually returned, only what happened to already be in memory. Found
  by manual smoke-testing, unrelated to whatever else was being worked on at the time — a reminder
  to actually click through a UI change rather than trust that green tests cover it. Fixed by
  dropping the override; `mapIssue()`'s own default already does the right thing for every other
  caller, since `upsertIssue()` has exactly one caller.
