# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository. It holds the commands, the rules that CI or the product enforce,
and a map of where things live. Reasoning, bug history and per-feature design notes are in
[docs/ENGINEERING-NOTES.md](docs/ENGINEERING-NOTES.md); decisions are in [docs/adr/](docs/adr/README.md).

## What this is

Taskira is an internal corporate task tracker (board, list, timeline, calendar, roadmap, dashboards, workflow editor) with a
role-based permission system. Two independent npm packages:

- **root**: React 19 + TypeScript + Vite SPA (`src/`). Russian and English UI.
- **`server/`**: Fastify 5 + PostgreSQL + JWT API (`server/src/`). **The source of truth for permissions.**

The client talks to the API only (`src/api/`, `src/store.tsx`). Documentation map:

- [server/README.md](server/README.md): route tables, per-feature server notes, local run (Russian; parts are historical, so
  check against the code). Generated and checked in CI: [docs/API-SCHEMAS.md](docs/API-SCHEMAS.md) (request/response shapes),
  [docs/PERMISSIONS.md](docs/PERMISSIONS.md), [docs/MIGRATION-LIST.md](docs/MIGRATION-LIST.md); never edit them by hand.
- [ARCHITECTURE.md](ARCHITECTURE.md), [README.md](README.md), `*_MIGRATION.md` (records of finished migrations),
  [DOCKER_SETUP.md](DOCKER_SETUP.md), [docs/OPERATIONS.md](docs/OPERATIONS.md), [docs/REALTIME.md](docs/REALTIME.md),
  [docs/SECURITY_OVERVIEW.md](docs/SECURITY_OVERVIEW.md), [SECURITY.md](SECURITY.md), [docs/LICENSE_KEYS.md](docs/LICENSE_KEYS.md),
  [docs/design/](docs/design/) (DESIGN, COMPONENTS, MOTION, PERF-BUDGET, IA).
- Do not add credentials, customer data or private vulnerability reports to issues or docs. Security-facing claims must stay
  aligned with `docs/SECURITY_OVERVIEW.md`. The license private signing key never goes in the repo, only its public half
  (`server/src/licenseTrustedKeys.ts`).

## Commands

Client (repo root):

```bash
npm ci               # after every pull/merge; a stale node_modules gives phantom type errors. On Windows stop dev servers first
npm run dev          # Vite on http://localhost:3000 (strictPort)
npm run build        # production build to dist/
npm run typecheck    # tsc --noEmit; noUnusedLocals is on, so an unused import or local fails
npm run lint         # eslint src --quiet: react-hooks rules only; errors fail CI. `lint:all` also shows exhaustive-deps warnings
                     # (existing debt; do not fix them wholesale, each one changes when an effect runs)
npm test             # vitest run (jsdom + Testing Library)
npm run bundle:check # after build: gzip size and startup-JS budget vs scripts/bundle-budget.json
npm run docs:check   # generated docs are current, motion tokens/map, docs/ size limit (repo:check)
```

Style checks that fail CI: `colors:check`, `contrast:check`, `motion:check`, `antilist:check`, `permissions:check`.
`npm run perf:rerenders` prints re-render tables; `npm run test:ui` is Playwright + axe (CI only for PRs touching components).

Server (`server/`):

```bash
npm ci
cp .env.example .env   # fill DATABASE_URL, JWT_SECRET (>=32 chars), ADMIN_USERNAME/ADMIN_PASSWORD
npm run dev            # tsx watch with polling -> migrations -> seeds -> API on :8080 (dev:native: native fs events)
npm run build && npm run start
npm run typecheck      # also noUnusedLocals
npm test               # vitest, about a thousand cases; needs local PostgreSQL
```

A local PostgreSQL reachable through `DATABASE_URL` is required to run the server at all (`initPool` and `migrate()` run before
`listen`). `npm test` creates the scratch database `taskira_test` itself (`test/global-setup.ts`; the role needs `CREATEDB`).
LDAP, S3 and mail suites are `describe.skip` unless their env vars are set; CI sets them (`.github/workflows/test.yml`).

Verifying a change: client `npm run typecheck && npm test && npm run build` (plus the style checks above for UI work); server
`npm run typecheck && npm test`; if you touched permissions, docs-generating code or migrations, run `npm run permissions:check`
and `npm run docs:check` at the root. CI job `types` typechecks server and client together and checks generated docs.

## Hard rules and what enforces them

### Permissions

- `shared/permissions.matrix.json` is the only place to change `MATRIX`, `PermId`, role and permission names. Run
  `npm run permissions:generate`: it writes `src/permissions.matrix.ts`, `server/src/permissions.matrix.ts` and
  `docs/PERMISSIONS.md`. Never edit those by hand ([ADR-0001](docs/adr/0001-permission-matrix-generated-not-imported.md)).
- The logic on top is duplicated by design (the server builds from `server/` alone): `resolveRole`, `isOwnIssue`, `can`,
  `denialReason` in `src/permissions.ts` and `server/src/permissions.ts` (server also has `roleCan`). `server/test/permissions-sync.test.ts`
  runs both over every role x permission x own/foreign issue and compares behaviour, and also checks that `LIMITS` match.
- The client copy is for instant UX feedback only. The server re-checks every mutation. Client mutations go through
  `requirePerm()` in `store.tsx` (toasts `denialReason()` on failure); UI disables or hides controls with `can()`.
- Server hooks (`middleware.ts`): `requirePerm(perm)` for role-level checks, `requireIssuePerm(perm)` for task-level checks (loads
  `req.issueRef`; an `employee` may edit an issue only if they are an assignee or the reporter). Both call `requireAuth`.
  `requireSession` excludes API tokens, `requireGlobalAdmin` rejects every API token, `requireAuth` accepts scoped tokens.
- **Every new API route needs a row in `server/test/access/routes.manifest.ts`, or CI fails** (`routes.manifest.test.ts` diffs the
  manifest against the routes `buildApp()` serves). Pick the policy from `P` by the route's hook; add a `BODIES` / `QUERIES` row if zod
  would answer 400 before the permission check; keep one sorted line per route. A new nested param under `/projects/:projectId`
  (such as `/things/:thingId`) must also be listed in `OWNED` or `NOT_OWNED` in `server/test/access/crossProject.test.ts`; an
  `OWNED` object must return 404 when looked up through another project's path, so scope lookups by the parent from the path.
  The 404/403 rule is in `docs/SECURITY_OVERVIEW.md`.

### Contract and validation

- `server/src/contract.ts` is the single source of request and response shapes, including zod schemas for responses (`IssueDto`,
  `ProjectBootstrapDto`, ...). Handlers are annotated with the `z.infer` types and the client imports the same types with
  `import type` from `../../server/src/contract` (zod is a root devDependency for types only; never value-import `contract.ts` in
  client code, it would pull zod into the bundle). The server validates every body and query with `zbody()` / `zquery()`.
- Response schemas are type sources only and are never `.parse()`d in production; SQL rows are cast. Drift is caught in tests:
  `server/test/responseContract.ts` maps routes to schemas (`RESPONSES`) and an `onSend` hook on the test app parses every
  successful response of a mapped route. Add a route whose whole response has a `contract.ts` schema to `RESPONSES`.
- `src/validation.ts` `LIMITS` mirrors `server/src/contract.ts` `LIMITS`. Client validation is UX-only.

### Database

Follow [docs/MIGRATIONS.md](docs/MIGRATIONS.md): the legacy `001`-`029` files in `server/migrations/` are immutable; new files are
named `YYYYMMDDTHHMM_name.sql` (never another sequential number); each file runs in one transaction (no `BEGIN`/`COMMIT` inside);
schema changes that replace data or contracts are expand/contract across separate releases; destructive operations need a
`-- contract-phase:` marker, which CI checks. `migrate()` applies files in filename order and tracks `schema_migrations`.
Do not maintain `docs/MIGRATION-LIST.md` by hand.

### ADRs

An ADR records a decision on its date and never goes stale: it is `Accepted` or `Superseded by ADR-MMMM`. To change a decision write
a new ADR with a `Supersedes ADR-NNNN` line; the old one only gets `Status: Superseded by ADR-MMMM`. Never edit an ADR's content.

### Deployment model

One serving API process per database ([ADR-0024](docs/adr/0024-single-serving-api.md)): startup holds a PostgreSQL session lock and
exits if it loses it. Stop the old API before upgrading; rolling or multi-replica deployment and transaction-mode PgBouncer are
unsupported. There is no multi-tenancy (one database per organization, [ADR-0009](docs/adr/0009-database-per-tenant.md)).

### i18n (Russian and English)

The whole client UI exists in both languages. Code is in `src/i18n/`: `ru.ts` is the source dictionary (flat `"domain.key"`), `en.ts`
is typed `Record<keyof Dict, string>` so TypeScript refuses a missing or extra key, `index.tsx` provides `useT()` returning
`{ lang, setLang, t, tn, errText }`.

- Use `t(key, params?)`; use `tn(n, one, few, many)` for counts instead of a local plural helper. Shared labels come from the
  dictionary (``t(`priority.${p}`)``, `issueType.*`, `complexity.*`, `permission.*`, `role.*`), not from `.name` fields.
- **`src/i18n/cyrillicGuard.test.ts` fails on Russian text in client code outside the dictionary**, unless it is an RU/EN pair, a
  developer message (`console.*`, `throw new Error`, `new ApiError`), a Russian-layout hotkey, or a file in its `FILE_ALLOW` with a
  reason. Add dictionary keys instead of silencing it. The store uses `local(ru, en)` pairs for toasts.
- User and admin data is never translated: workflow status names, project and team names, issue text, comments, job roles.
- **Server errors:** show them through `errText(e, fallback)` (`apiErrorText()` in `src/i18n/apiErrors.ts`), not `e.message`. Russian
  UI shows the server's Russian `reason`; English maps `ApiError.code` to an `apiError.<CODE>` key, and an unmapped code falls back
  to `fallback`. `apiErrors.test.ts` scans `server/src` and fails if a thrown code has no dictionary entry. Do not add English
  strings to server handlers. `denialReason()` stays the Russian mirror of the server; the UI shows `denialText()`.
- **Issue history is data:** `logActivity(issueId, actorId, event)` (`server/src/services/activity.ts`) takes an `ActivityEvent`, a
  closed zod union in `contract.ts`, and stores `activity.kind` + `payload` plus the Russian phrase in `text`. The client renders the
  event through `activity.*` keys (`src/activityText.ts`). A new history event means: a union member, an `activityText()` case, two
  dictionary keys, an `activityLine()` case. Never call `logActivity` with free text. New history also needs a thin-body mapping in
  `services/webhookPayload.ts` (unknown history is not forwarded).
- Email is rendered in the recipient's language from `MAIL_STRINGS` (`server/src/services/emailTemplates.ts`; `users.lang` is set
  by `PUT /api/me/lang`; shape checked by `mailLang.test.ts`). The in-app help has matching RU and EN sections (`DocsView.test.tsx`).
- The English dictionary is a lazy chunk (`loadLang()`); the UI language is in `localStorage` (`taskira.lang`).
- UI says «команда» / "team" for what code, API, DB and env call `department`.

### Design tokens, motion, components

- Every colour lives in `src/styles/tokens.css` (OKLCH primitives, semantic tokens, legacy `--c-*` aliases). **No raw `#hex` or
  `rgb()` in components** (`colors:check`); declared text/background pairs must stay at 4.5:1 (`contrast:check`). Themes override only
  the semantic layer. See `docs/design/DESIGN.md` and ADR-0012/0016.
- `motion:check` fails an animation or transition whose duration is not a `--dur-*` token (or exceeds 450 ms), or a moving animation
  not overridden under `prefers-reduced-motion`. The only entry to `motion/mini` is `src/motion.ts`; every function there honours
  `motionReduced()`. Changing motion means updating `docs/design/MOTION.md` ([ADR-0035](docs/adr/0035-motion-library-spike.md)).
- `antilist:check` fails on `uppercase` caps labels (`first-letter:uppercase` is fine) and a trailing arrow in a dictionary string.
- No `backdrop-filter` on large surfaces (sidebar translucent, work sheet opaque; ADR-0023/0027); only small floating `.glass`
  surfaces may use it. Font is Manrope only; icons are the in-house set in `src/icons.tsx`.
- Components are `src/ds/` on native `<dialog>` and the Popover API with `@floating-ui/dom` (ADR-0014; Radix was rejected because its
  scroll lock injects `<style>`, which the CSP blocks). Popups are `ds` `Menu` / `Popover`, never hand-rolled open/close state. A
  `Dialog` takes `onClose` inline. Escape handled inside a window must `preventDefault()` so the window stays open. The reasons are
  in ENGINEERING-NOTES ("Client UI components"); the component map is `docs/design/COMPONENTS.md`.
- **Bundle budget and entry chunk:** `bundle:check` compares gzip JS/CSS and the "startup" metric (entry plus every `modulepreload`)
  with `scripts/bundle-budget.json` ([PERF-BUDGET](docs/design/PERF-BUDGET.md)). Modules in the entry chunk (Board and what it imports
  statically, Sidebar, LoginForm, StatusScreens, ErrorBoundary, GettingStarted, `WorkspaceControls`, `BoardBackgroundControl`) import
  `ds` components from their files (`../ds/Button`), not the `../ds` barrel, and take `Menu` / `Popover` from `ds/LazyOverlay`; code
  that only shows or hides a popover uses `showPop` / `hidePop` from `ds/pop.ts`, not `ds/floating.ts`. `Button`, `IconButton` and
  `AvatarGroup` use the lazy `ds/LazyTooltip` (`dsId` is in `ds/ids.ts`). Importing `Select` from the file, not the barrel, is the same
  rule. Otherwise `Overlay` and `@floating-ui/dom` land in `modulepreload`.
- **Dynamic styles under the CSP** ([ADR-0010](docs/adr/0010-dynamic-styles-under-csp.md)): CSSOM writes (`el.style.x`,
  `setProperty('--x')`, WAAPI) are allowed; `style=""` in markup, `setAttribute('style')` and `<style>` are blocked (`style-src-attr 'none'`).
  For continuous values (positions, progress, colours from data) set a custom property with `ref={cssVars({"--x": 12})}`
  (`src/cssVars.ts`) and read it in a static class (`left-[var(--x)]`); enumerable states go in `data-*` attributes. `secure-jsx`
  turns each distinct `style` value into a new rule in `public/dynamic.css`, which is unbounded, so avoid `style={...}`.

## Architecture map

### Client

- **Data flow.** `src/store.tsx` is a React Context facade (`StoreProvider` / `useStore`) over domain modules in `src/store/`; a
  gradual move to `useSyncExternalStore` selectors is ADR-0011. Toasts and notifications are external stores: use `useToasts()`,
  `useNotifications()`, `useUnreadCount()` (not on `useStore()`). There is no public `useActions()`. Use `idx` (prebuilt `Map`s
  and `doneStatusIds`) in list and card renders instead of scanning `data.users` or `data.issues`.
- **Boot.** `App.tsx` calls `store.bootstrap()` (`src/store/session.ts`): `authApi.me()` with the HttpOnly session cookie (no JWT in
  `localStorage`), 401 shows `LoginForm`. `bootStatus` is `idle | loading | ready | unauthenticated | error | solo | home` (`solo`:
  invited to single issues but in no project; `home`: two or more visible projects and none entered, URL `/`). When you add a
  `bootstrap()` branch or change what an API method returns, extend `src/store.bootstrap.test.tsx`; a cast once hid a shape
  mismatch that crashed the app.
- **HTTP layer.** `src/api/index.ts`: a generic `api()` plus typed objects (`authApi`, `projectsApi`, `issuesApi`, ...). Errors are
  normalized to `ApiError { status, code, reason }`; a 401 invalidates the client session epoch. Async issue reads, PATCH and
  transitions capture project id and session epoch and ignore stale results after navigation or re-login. `API_BASE` comes from
  `VITE_API_URL` (default same origin). Server DTOs are camelCase and mapped by `mapIssue` / `mapUser` (`src/store/mappers.ts`);
  mutations call the API and then patch `data` from the returned DTO.
- **Views and URLs.** `ViewId` (`src/types.ts`): `overview | board | backlog | sprints | timeline | calendar | reports | roadmap |
  dashboards | settings | projectSettings | orgSettings | docs | collaborating | inbox | my`. `ui.view` selects the screen in
  `App.tsx` and `useRouterSync.ts` mirrors it into the URL with `wouter` (ADR-0008, ADR-0013 §5). Paths (`src/router.ts`):
  `/p/:projectKey/{overview,board,list,timeline,calendar,sprints}`, `/p/:projectKey/settings/:section`, `/settings/:section`,
  `/admin/:section`, and project-less `/inbox`, `/my-issues`, `/reports`, `/roadmap`, `/dashboards[/:id]`, `/help`, `/shared`. A
  project-less path at boot opens inside the last project's shell. Old `/p/:projectKey/<view>` links still parse and are replaced in
  place (`samePlace()`). An open issue is `?issue=KEY` on the view path (`ui.issueMode = "panel"`; `J`/`K` walk `data-issue-id` order via
  `src/issueNav.ts`) or `/p/:projectKey/issue/:issueKey` as a full page (`"page"`; used by Inbox, My issues, search and shared links).
  `GET /api/issues/resolve` maps a key to an issue without naming a project. `nginx.conf` `try_files $uri /index.html` makes a hard
  refresh work. `backlog` is the internal id of the list view (`Backlog.tsx`).
- **Settings have three homes** (ADR-0013 §2): `settings` (personal), `projectSettings`, `orgSettings`, section in `ui.section`. Section
  lists are in `src/settings/sections.ts`, visibility in `src/settings/access.ts` (`allowedSections`); open a home with
  `useOpenSettings()`. Screens are in `src/components/settings/`; project members live only in `PermissionsView`. Every setting has
  one home; env-only values show read-only with an `env` tag.
- **Shortcuts** (wired in `App.tsx`, off while a modal is open): `/`, `C`, `1`-`3` and `5` for board / list / timeline / calendar (`4` is
  sprints, only when the project has them), `G` then `H I M R D O S`, `[` collapses the sidebar, `?` help, `Esc`. `Ctrl/Cmd+K`
  (matched by `e.code`, so it works in the Russian layout) opens the lazy command palette (`src/palette/`).
- **Big screens are split by file:** board = `Board.tsx` + `BoardColumn.tsx` + `BoardCard.tsx` (the done-column window
  `DONE_WINDOW_DAYS` is in `src/boardFilters.ts`); list = `Backlog.tsx` + `BacklogRow.tsx` + `BacklogFilters.tsx`; issue card =
  `IssueModal.tsx` + `IssueModalFields.tsx` (collaborators, attachments, subtasks, checklist, custom fields, links) +
  `IssueModalParts.tsx`; `MentionText.tsx` is separate so `SoloView` does not pull the card.
- **Other client pieces.** Dashboards: `src/dashboards/` and `DashboardView.tsx`. Time scale for Timeline and roadmap:
  `src/timeScale.ts` + `TimeCanvas.tsx` (reuse, do not write a second one). Branding: `src/brand.ts` and `<BrandMark>` / `useBrandName()`
  instead of `<Logo>` or a hardcoded name. Onboarding: `src/onboarding.ts`. Project appearance: pass `icon`/`color` to `ProjectMark`
  or use `lookOf()` from `src/projectLook.tsx`. People pickers are the `ds` `Combobox` over `usersApi.pickable()`; never load the whole
  directory into a `<select>`. Imports from Trello, Jira and Asana are client-side parsers in `src/import/` that call the normal
  `issuesApi.create()` through `store.importIssues()`.

### Server

Order at startup: `index.ts` loads config, `initPool`, `migrate()`, startup seeds (`seedStartup.ts`: first admin, project `CORP`,
instance row), `buildApp()`, then listens. `app.ts` registers plugins, the unified error handler (`{ error: { code, reason } }`),
`/api/health` and all routes under `/api`.

- `routes/`: thin handlers, one file per resource, with the permission hook and zod schema in the route options. `services/`: domain
  logic (`issues.ts`, `issueUpdate.ts`, `issueList.ts`, `workflow.ts`, `rank.ts`, `reports.ts`, `projects.ts`, ...). Project resources
  live under `/api/projects/:projectId/...`; `requirePerm` resolves the caller's membership for that id.
- Issue keys (`CORP-1`) come from the atomic `project_counters` upsert. Issue ordering is a fractional `issues.rank`, computed under
  `pg_advisory_xact_lock` per status column. Illegal status moves return 409 (`assertTransition`, even for admin).
- **Reports and dashboards resolve visibility through `listVisibleProjects()`** and pass ids as `project_id = ANY($ids)`; do not
  re-implement the visibility predicate.
- `db.ts`: `q` / `one` / `exec` / `withClient`. `config.ts`: env only, parsed once, fails fast on a missing `DATABASE_URL` or a
  `JWT_SECRET` under 32 characters.
- `middleware.ts` `requireAuth` verifies the JWT but re-reads role and active flag from the DB (30 s cache), so role changes and
  deactivation apply quickly. Two invalidation functions on purpose: `invalidateUserCache(userId)` is safe on any user write;
  `revokeUserSessions(userId, reason)` also closes the user's WebSockets, so call it only for a real revocation (logout,
  deactivation, an actual role change). `audit()` is fire-and-forget; never await it in a request path.
- Realtime: `GET /api/ws` carries notification pushes and durable project sync ([REALTIME.md](docs/REALTIME.md), ADR-0036). The
  client never applies a pushed card; it re-reads through `GET /api/projects/:projectId/sync`. Handshake races and their fixes are in
  ENGINEERING-NOTES; touch `routes/ws.ts` / `wsHub.ts` only after reading that section.
- Background jobs run through `startJob` in `services/maintenance.ts` (archive and audit purge, storage sweep, LDAP resync, webhook
  dispatch, due events, recurring); `MAINTENANCE_ENABLED=false` stops them. The notifier has its own switch.
- Integrations (track L): `integration_events` is a transactional outbox filled by PostgreSQL triggers on `activity` and `comments`;
  never emit webhooks from route handlers. `WEBHOOK_SECRET_KEY` encrypts subscription secrets (`secretBox`) and must live outside
  backups. The SSRF allowlist is operator env; DNS results are checked and pinned per attempt, no redirects. API tokens start with
  `tsk_`, store only a hash and act as project members. Service accounts (`auth_source='service'`) cannot log in and need explicit
  project membership, never global admin. Recurring issues use `createIssueInTx` with `(rule_id, scheduled_for)` uniqueness. Host
  scripts write `ops_runs`; the API only reads it. `GET /api/admin/status` is a global-admin snapshot of 11 checks. Emergency outbox
  stop and operator procedures are in [OPERATIONS](docs/OPERATIONS.md); thresholds in [server/README.md](server/README.md).
- Feature data models (assignees, subtasks, checklist, custom fields, templates, sprints, project templates, onboarding, dashboards,
  departments, licensing) are in ENGINEERING-NOTES "Server data model". Rules that bite across them: epic child counts are
  maintained by DB triggers, never from application code; sprints are off by default and every sprint route 404s when
  `project.sprintsEnabled` is false; archiving is not deletion (`done_at` drives "what got done", `archived_at` only removes an issue
  from the active set); subtasks are two levels deep and the `parentId` writes go through the advisory-locked helpers in
  `services/issues.ts`; an issue's assignees are a list (`assigneeIds`), and `mapIssue(row, assigneeIds)` takes them explicitly.

## Gotchas

- Server imports use `.js` extensions on relative paths (NodeNext) even though files are `.ts`; the client imports `.ts` / `.tsx`
  (`allowImportingTsExtensions`).
- `upsertIssue()` (`src/store/mappers.ts`) replaces the stored issue wholesale; pass it the already merged issue (`mapIssue()` keeps
  the previous `comments` / `activity` by default).
- jsdom has no Popover API (`showPopover` is guarded) and no jest-dom matchers; query popup content with `hidden: true` and use
  `getAttribute` / `textContent`. Await tooltips with `findByRole("tooltip")`.
- Do not "fix" the `40P01` retry in `server/test/helpers.ts` `resetDb()` by awaiting `audit()` in production code.
- `server/.env` is untracked and may hold real secrets; never paste it into shared output. `CORS_ORIGIN` must match the client origin
  (`http://localhost:3000` in dev). Behind nginx or a load balancer set `TRUST_PROXY`, or the per-IP login rate limit and audit IPs
  see the proxy address.
- Root `docker-compose.yml` is a separate config surface from `server/.env`; `VITE_API_URL` is baked into the client image at build
  time; use `openssl rand -hex 24` for `POSTGRES_PASSWORD` (it goes into a URL unencoded). See [DOCKER_SETUP.md](DOCKER_SETUP.md).
- User switching is real login and logout only; there are no role-preview stubs.
