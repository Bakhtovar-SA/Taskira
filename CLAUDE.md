# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Taskira — an internal corporate task tracker (Jira-style board / backlog / timeline / workflow editor)
with a role-based permission system. Two independent npm packages:

- **root** — React 18 + TypeScript + Vite SPA (`src/`). UI language and all copy is Russian.
- **`server/`** — Fastify 5 + PostgreSQL + JWT API (`server/src/`). **The permission system's source of truth.**

The client was originally a localStorage-only app; it now talks to the API exclusively
(`src/api/`, `src/store.tsx`). The root `README.md` still largely describes the old
localStorage design and pre-migration roles/types — treat **`server/README.md`** as the
authoritative API contract and current data model. `src/seed.ts` is dead demo data except
for `DEFAULT_WORKFLOW`, which `DocsView.tsx` still imports.

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
npm run dev            # tsx watch: runs migrations -> seeds admin+project -> listens on :8080
npm run build          # tsc -p tsconfig.json -> dist/
npm run start          # node dist/index.js
npm run seed           # run migrate() + seedAdmin() + seedProject() standalone
npm run typecheck      # tsc --noEmit
```

There is **no test runner and no linter** in either package. Verification is `typecheck` plus the
manual checklists at the bottom of `server/README.md`. A local PostgreSQL reachable via
`DATABASE_URL` is required to run the server at all (`initPool` → `migrate` happen before `listen`).

## Architecture

### Permission model is defined twice and must stay in sync

`src/permissions.ts` (client) and `server/src/permissions.ts` (server) are near-identical copies:
the same `MATRIX`, `PermId` union, `can()`, `canEditIssue()`, `denialReason()`, and roles
`admin | manager | employee | viewer`. The client copy exists **only for instant UX feedback**
(hiding buttons, showing lock tooltips). The server re-checks every mutation and is authoritative.
Change one → change the other identically.

Enforcement points:
- **Client**: `store.tsx` → `requirePerm()` gates every mutating action before the API call and
  toasts `denialReason()` on failure. UI components also call `can()` to disable/hide controls.
- **Server**: Fastify `preHandler` hooks in `middleware.ts` — `requirePerm(perm)` for
  role-level checks, `requireIssuePerm(perm)` for task-level checks (loads the issue into
  `req.issueRef`, applies the "employee can only edit own issues" rule). Both call `requireAuth`
  themselves, so a route lists only the permission hook.
- Task-level rule: `employee` may `edit` an issue only if `assigneeId === me || reporterId === me`.
  `admin`/`manager` edit anything. Changing `sprintId` via `PATCH /issues/:id` additionally
  requires `manageSprints` (checked inline in the route, not just the hook).

### Validation limits are also mirrored

`src/validation.ts` `LIMITS` ↔ `server/src/contract.ts` `LIMITS` + zod schemas. `contract.ts`
is the single source of request/response shapes; the server validates every body/query with it
via `zbody()` / `zquery()` preValidation hooks. Client validation is UX-only; the server repeats it.

### Client data flow

`src/store.tsx` is a single React Context (`StoreProvider` / `useStore`) — no reducer library.
Boot sequence in `App.tsx` → `store.bootstrap()`: if no token in `localStorage` (`taskira.token`),
show `LoginForm`; otherwise call `authApi.me()` + `projectApi.bootstrap()` + `issuesApi.list()`
and populate one flat `Data` object. `bootStatus` drives the shell:
`idle | loading | ready | unauthenticated | error`.

`src/api/index.ts` is the whole HTTP layer: a generic `api()` wrapper plus typed
`authApi` / `projectApi` / `issuesApi` / `commentsApi` / `sprintsApi` / `workflowApi` objects.
Errors are normalized to `ApiError { status, code, reason }`; a 401 clears the token.
`API_BASE` comes from `VITE_API_URL` (root `.env`), default `http://localhost:8080`.

Server DTOs are camelCase; the store maps them to client types (`mapIssue`, `mapUser`) and
carries `comments`/`activity` separately (fetched on demand when an issue modal opens).
Mutations are optimistic-ish: call API, then patch `data` from the returned DTO; `moveStatus`
re-fetches issues on failure to undo local drift.

Views (`ViewId`: `board | backlog | timeline | workflow | access | docs`) are switched by
`ui.view` in `App.tsx` — no router despite `react-router-dom` being a dependency.
Keyboard shortcuts (`/`, `C`, `1`–`6`, `Esc`) are wired in `App.tsx`.

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
  no multi-tenant**), `sprints.ts`.
- `db.ts` — thin `pg` wrapper: `q` / `one` / `exec` / `withClient` (dedicated client for
  race-free read-then-write). `migrate()` applies `server/migrations/*.sql` in filename order,
  each file in one transaction, tracked in `schema_migrations`.
- `config.ts` — env only (no secrets in code), loaded once and cached. Parses `server/.env`
  itself (no dotenv dep). Fails fast if `DATABASE_URL` missing or `JWT_SECRET` < 32 chars.
- `middleware.ts` — `requireAuth` verifies JWT but re-reads `access_role` / `is_active` from
  the DB (30s in-memory cache, `invalidateUserCache()` on admin role change) so role changes
  and deactivation take effect without waiting for token expiry.
- `audit.ts` — fire-and-forget `audit_log` inserts; never throws into the request.

### Data model notes

Workflow is a DB-backed directed graph: `workflow_statuses` (with stable `sid`:
`todo`/`inprogress`/`review`/`done`) + `workflow_transitions` (edges). Every status change
(`POST /issues/:id/transition`) is checked against the transitions table — even an admin
cannot move an issue against the schema. `admin` edits the graph via `POST/DELETE
/api/workflow/transitions` and `POST /api/workflow/reset` (statuses are never deleted).

Issue types: `task | bug | request` only (migration 002 collapsed `story`/`epic` → `task`;
grouping survives via nullable `issues.epic_id`, timeline fields `t_start`/`t_span` kept).
Issue keys (`CORP-1`) are assigned by the server via the atomic `project_counters` upsert.

## Gotchas

- **Server imports use `.js` extensions** on relative paths (NodeNext module resolution) even
  though the files are `.ts`. The client uses `allowImportingTsExtensions` and imports `.tsx`/`.ts`.
- `server/.env` is untracked (git-ignored via `.gitignore`) and never entered git history —
  only `.env.example` files are committed, with empty secret values. The working-tree
  `server/.env` does hold real local-dev values (`JWT_SECRET`, `ADMIN_PASSWORD=qwerty!@#123`,
  db creds `taskira`/`taskira`), so don't paste its contents anywhere shared.
- `CORS_ORIGIN` in `server/.env` must match the client's actual origin (client dev server is
  `:3000`, but `.env.example` says `:5173`).
- Client `switchUser` / `resetDemo` are intentionally disabled stubs — user switching is now
  real login/logout only.
- Root `package.json` still lists many unused deps (`@dnd-kit`, `@supabase/supabase-js`,
  `framer-motion`, `recharts`, `canvas-confetti`, `uuid`, …); `server/README.md` has the
  removal command. Don't assume a dependency is wired in just because it's installed.
