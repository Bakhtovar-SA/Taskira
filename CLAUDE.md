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
links (014).

## Commands

Client (run from repo root):

```bash
npm install
npm run dev         # Vite dev server on http://localhost:3000 (strictPort — fails if taken)
npm run build       # production build to dist/
npm run typecheck   # tsc --noEmit — the only client-side check
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
npm test               # vitest run — access/contract/home/notifications suites (~90 tests)
```

The server has a **vitest** suite (`server/test/`, `npm test`); it needs a local PostgreSQL
(`vitest.config.ts` / `test/global-setup.ts` spin up a scratch DB). LDAP / S3 / mail suites are
`describe.skip` unless their env vars are set (CI sets them via docker-compose — see
`.github/workflows/test.yml`). The **client has no test runner**; verification there is
`npm run typecheck` + `npm run build`. **No linter** in either package. A local PostgreSQL
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

Views (`ViewId`: `board | backlog | timeline | workflow | access | admin | docs | collaborating`)
are switched by `ui.view` in `App.tsx` — no router. `backlog` is internal id for the
"Список задач" view (`Backlog.tsx`, a flat filtered/sorted list — sprints removed in
migration 012). `bootStatus` also has a `"home"` state: with ≥2 visible projects, login
lands on `HomeView.tsx` (Мои задачи + Недавние проекты) before any project is entered.
Deep links to a task use a hash (`#/issue/<pid>/<iid>`) parsed by hand in `App.tsx`.
Keyboard shortcuts (`/`, `C`, `1`–`8` for the eight views, `Esc`) are wired in `App.tsx`.

### Server structure

`index.ts` (bootstrap: config → pool → migrate → seed → `buildApp` → listen) →
`app.ts` (Fastify plugins, unified error handler emitting `{ error: { code, reason } }`,
`/api/health` with DB check, route registration all under `/api`).

- `routes/` — thin HTTP handlers, one file per resource. Permission hook + zod schema in the
  route options, business logic inline or delegated to `services/`.
- `services/` — domain helpers: `issues.ts` (DTO map, `nextIssueNum` atomic counter),
  `workflow.ts` (`DEFAULT_STATUSES`/`DEFAULT_TRANSITIONS`, `assertTransition` → 409 on
  illegal move), `rank.ts` (fractional `issues.rank` float8; midpoint insert, column
  rebalance when gap `< 1e-9`), `project.ts` (`currentProject()`, cached — **single project,
  no multi-tenant**).
- `db.ts` — thin `pg` wrapper: `q` / `one` / `exec` / `withClient` (dedicated client for
  race-free read-then-write). `migrate()` applies `server/migrations/*.sql` in filename order,
  each file in one transaction, tracked in `schema_migrations`.
- `config.ts` — env only (no secrets in code), loaded once and cached. Parses `server/.env`
  itself (no dotenv dep). Fails fast if `DATABASE_URL` missing or `JWT_SECRET` < 32 chars.
- `middleware.ts` — `requireAuth` verifies JWT but re-reads `global_role` / `is_active` from
  the DB (30s in-memory cache, `invalidateUserCache()` on admin role change) so role changes
  and deactivation take effect without waiting for token expiry. Project resources live under
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
`blocked_by` is `blocks` seen from the other end, not a stored row. `points` still exists in
the schema and contract but the "оценка" field was dropped from the card UI.

## Gotchas

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
  `npm run build`) alongside the server/ldap/storage-s3/mail jobs.
- **Theming** (`src/theme.ts` + `src/index.css`): the palette lives in plain custom
  properties on `:root` / `:root[data-theme="dark"]` (`--c-canvas`, …); `@theme` only
  aliases them (`--color-canvas: var(--c-canvas)`) so `bg-canvas` / `text-ink` / etc.
  resolve live per theme. **Don't add raw `#hex` to components** — use a token class or
  `var(--c-*)` in inline styles, otherwise it won't dark-theme. `catColor()` in `ui.tsx`
  returns `var(--c-*)`. Theme mode (`system|light|dark`) and one of 6 background presets
  are in `localStorage` only (`taskira.theme` / `taskira.bg`), applied to `<html>` by
  `applyTheme()`; the profile-menu "Оформление" popup (`AppearanceSettings` in `ui.tsx`)
  is the UI. Sidebar-internal colors stay hardcoded (the rail is dark in both themes).
