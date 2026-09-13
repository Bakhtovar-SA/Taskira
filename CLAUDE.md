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
token revocation (017), points → complexity (018).

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
  `maintenance.ts` runs two independent background timers (not one — different
  cost and cadence): archive + `audit_log` purge every `intervalMs` (default
  1h), and `storageSweeper.ts` every `storageSweepIntervalMs` (default 24h,
  deliberately less often — a full `Storage.list()` is pricier than one
  `UPDATE`). The sweeper diffs `Storage.list()` against `attachments.storage_key`
  and deletes objects with no matching row, but skips anything younger than
  `storageSweepGraceMs` (default 24h) — `routes/attachments.ts` writes the
  object via `storage.put()` *before* the `INSERT INTO attachments`, so a
  just-uploaded object is briefly visible to `list()` without a DB row yet;
  the grace period is the guard against sweeping it mid-upload.
- `db.ts` — thin `pg` wrapper: `q` / `one` / `exec` / `withClient` (dedicated client for
  race-free read-then-write). `migrate()` applies `server/migrations/*.sql` in filename order,
  each file in one transaction, tracked in `schema_migrations`.
- `config.ts` — env only (no secrets in code), loaded once and cached. Parses `server/.env`
  itself (no dotenv dep). Fails fast if `DATABASE_URL` missing or `JWT_SECRET` < 32 chars.
- `middleware.ts` — `requireAuth` verifies JWT but re-reads `global_role` / `is_active` from
  the DB (30s in-memory cache, `invalidateUserCache()` on admin role change) so role changes
  and deactivation take effect without waiting for token expiry. The same lookup checks the
  token's `iatMs` (milliseconds, not JWT's second-granularity `iat`) against
  `users.tokens_valid_from`; `POST /api/auth/logout` (migration 017) bumps that column so a
  copied/stale token stops working immediately instead of surviving to its 12h expiry.
  Project resources live under
  `/api/projects/:projectId/...` (issues, comments, attachments, collaborators, members,
  workflow); `requirePerm` resolves the caller's membership for that `:projectId`.
- `audit.ts` — fire-and-forget `audit_log` inserts; never throws into the request.

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
