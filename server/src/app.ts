/** Сборка Fastify: плагины, обработчики ошибок, маршруты. */
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { loadConfig } from "./config.js";
import { ApiHttpError } from "./middleware.js";
import { authRoutes } from "./routes/auth.js";
import { departmentRoutes } from "./routes/departments.js";
import { projectsRoutes } from "./routes/projects.js";
import { memberRoutes } from "./routes/members.js";
import { issuesRoutes } from "./routes/issues.js";
import { commentRoutes } from "./routes/comments.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { collaboratorRoutes } from "./routes/collaborators.js";
import { collaboratingRoutes } from "./routes/collaborating.js";
import { homeRoutes } from "./routes/home.js";
import { searchRoutes } from "./routes/search.js";
import { workflowRoutes } from "./routes/workflow.js";
import { issueTemplatesRoutes } from "./routes/issueTemplates.js";
import { customFieldsRoutes } from "./routes/customFields.js";
import { sprintsRoutes } from "./routes/sprints.js";
import { savedViewsRoutes } from "./routes/savedViews.js";
import { userRoutes } from "./routes/users.js";
import { avatarRoutes } from "./routes/avatar.js";
import { ldapRoutes } from "./routes/ldap.js";
import { maintenanceRoutes } from "./routes/maintenance.js";
import { notificationRoutes } from "./routes/notifications.js";
import { reportRoutes } from "./routes/reports.js";
import { auditExportRoutes } from "./routes/auditExport.js";
import { wsRoutes } from "./routes/ws.js";
import { pendingMigrations, q } from "./db.js";
import { ZodError } from "zod";
import { formatZod } from "./middleware.js";
import { requestToken } from "./sessionCookie.js";
import { getStorage } from "./services/storage.js";
import { activeSocketCount } from "./services/wsHub.js";
import { searchIndexWarnings, type HealthWarning } from "./services/healthWarnings.js";
import { createTtlCache } from "./services/ttlCache.js";
import { observeHttpRequest, refreshBackgroundQueueMetrics, renderMetrics } from "./metrics.js";

export function buildApp(): FastifyInstance {
  const cfg = loadConfig();

  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: "info" },
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    // За nginx/LB: без этого `req.ip` = адрес прокси — ломает rate-limit логина
    // по IP и IP в audit-логе. Значение из TRUST_PROXY (см. .env.example).
    trustProxy: cfg.trustProxy,
  });

  const requestStarted = new WeakMap<object, bigint>();
  app.addHook("onRequest", async (req, reply) => {
    requestStarted.set(req, process.hrtime.bigint());
    reply.header("x-request-id", req.id);
  });
  app.addHook("onResponse", async (req, reply) => {
    const started = requestStarted.get(req);
    if (started === undefined) return;
    const route = req.routeOptions.url ?? "unmatched";
    if (route === "/metrics") return;
    observeHttpRequest(req.method, route, reply.statusCode, Number(process.hrtime.bigint() - started) / 1e9);
  });

  // Security-заголовки (аудит SEC-02). API отдаёт только JSON и файлы вложений,
  // поэтому CSP здесь предельно узкая: ничего загружать со страницы API нельзя.
  // Заголовки для самого клиента (SPA) выставляет отдающий его nginx.
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"], // кликджекинг: API нельзя встроить в чужую страницу
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    // HSTS имеет смысл только поверх HTTPS; за nginx его обычно ставит он сам.
    hsts: { maxAge: 15_552_000, includeSubDomains: true },
    referrerPolicy: { policy: "no-referrer" },
  });

  // JWT регистрируем до rate-limit: keyGenerator ниже проверяет Bearer-токен
  // сам, потому что глобальный limiter выполняется раньше route preHandler.
  app.register(jwt, { secret: cfg.jwtSecret, verify: { extractToken: requestToken } });

  // Глобальный лимит запросов (аудит SEC-03): раньше он был только на логине,
  // и один аутентифицированный пользователь мог безнаказанно долбить любую ручку.
  // Ключ — id пользователя (а не IP): за корпоративным NAT у всех один адрес.
  if (cfg.rateLimit.enabled) {
    app.register(rateLimit, {
      global: true,
      max: cfg.rateLimit.max,
      timeWindow: cfg.rateLimit.windowMs,
      keyGenerator: (req) => {
        const token = requestToken(req);
        if (token) {
          try {
            const payload = app.jwt.verify<{ sub?: string }>(token);
            if (payload.sub) return `user:${payload.sub}`;
          } catch {
            // Невалидные/просроченные токены делят IP-bucket; requireAuth ниже
            // всё равно вернёт 401 и не доверяет этому результату.
          }
        }
        return `ip:${req.ip}`;
      },
      errorResponseBuilder: () => ({
        error: { code: "RATE_LIMITED", reason: "Слишком много запросов — подождите немного" },
      }),
    });
  }

  app.register(cors, {
    origin: cfg.corsOrigin === "*" ? true : cfg.corsOrigin,
    // По умолчанию @fastify/cors разрешает только GET/HEAD/POST — браузерный
    // preflight для PATCH/PUT/DELETE тогда падает («Нет связи с сервером» на клиенте).
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
    exposedHeaders: ["X-Request-Id"],
    credentials: true,
  });
  app.register(websocket); // realtime-маршруты — Этап 3c
  // Вложения к задачам: потоковый multipart, один файл за запрос, лимит из конфига
  // (FILES_MIGRATION.md D3). throwFileSizeLimit — стрим падает ошибкой при превышении.
  app.register(multipart, {
    throwFileSizeLimit: true,
    limits: { fileSize: cfg.storage.maxBytes, files: 1, fields: 10, fieldSize: 1024 },
  });

  /* Единый формат ошибок: { error: { code, reason } } */
    app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiHttpError) {
      reply.code(err.statusCode).send({ error: { code: err.code, reason: err.message } });
      return;
    }
    if (err instanceof ZodError) {
      reply.code(400).send({ error: { code: "VALIDATION", reason: formatZod(err) } });
      return;
    }
    if (err instanceof Error && "validation" in err && err.validation) {
      reply.code(400).send({ error: { code: "VALIDATION", reason: err.message } });
      return;
    }
    req.log.error(err);
    reply.code(500).send({ error: { code: "INTERNAL", reason: "Внутренняя ошибка сервера" } });
  });
  
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: { code: "NOT_FOUND", reason: "Эндпоинт не найден" } });
  });

  /* Liveness ничего не спрашивает у зависимостей: процесс способен отвечать. */
  app.get("/health", async () => ({ ok: true, version: cfg.version, ts: new Date().toISOString() }));

  const healthWarningsCache = createTtlCache<HealthWarning[]>(60_000);
  const readiness = async (_req: unknown, reply: { code(status: number): { send(body: unknown): void } }) => {
    const checks = { db: false, migrations: false, storage: false };
    let pending: string[] = [];
    try {
      await q(`SELECT 1`);
      checks.db = true;
      pending = await pendingMigrations();
      checks.migrations = pending.length === 0;
    } catch (error) {
      app.log.warn({ err: error }, "readiness database check failed");
    }
    try {
      const storage = await getStorage(cfg);
      await storage.checkReady();
      checks.storage = true;
    } catch (error) {
      app.log.warn({ err: error }, "readiness storage check failed");
    }
    const ok = checks.db && checks.migrations && checks.storage;
    // Деградация без ошибки (пока — поиск без индексов): видна в ответе, но не роняет readiness.
    // Кэш на минуту: healthcheck оркестратора приходит каждые несколько секунд.
    let warnings: HealthWarning[] = [];
    if (checks.db) {
      try {
        warnings = await healthWarningsCache.get("warnings", searchIndexWarnings);
      } catch (error) {
        app.log.warn({ err: error }, "readiness warnings check failed");
      }
    }
    reply.code(ok ? 200 : 503).send({
      ok,
      // legacy /api/health consumers read this top-level field; /ready clients
      // should prefer the complete checks object below.
      db: checks.db,
      checks,
      ...(pending.length > 0 ? { pendingMigrations: pending } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      version: cfg.version,
      ts: new Date().toISOString(),
    });
  };

  app.get("/ready", readiness);
  // Совместимость со старыми healthcheck релизов; семантика теперь readiness.
  app.get("/api/health", readiness);

  app.get("/metrics", async (_req, reply) => {
    await refreshBackgroundQueueMetrics();
    reply.type("text/plain; version=0.0.4; charset=utf-8").send(renderMetrics(activeSocketCount()));
  });

  app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(userRoutes); // /users, /admin/users (global admin) + /users/pickable
      await api.register(avatarRoutes); // /me/avatar (самообслуживание) + /users/:id/avatar (отдача)
      await api.register(ldapRoutes, { prefix: "/ldap" }); // /ldap/ping (global admin)
      await api.register(maintenanceRoutes, { prefix: "/maintenance" }); // статус и ручной запуск (global admin)
      await api.register(notificationRoutes); // /notifications* (project-less, requireAuth)
      await api.register(reportRoutes); // /reports/* (project-less, scope = видимые проекты)
      await api.register(auditExportRoutes); // /admin/audit-log/export (global admin, JSONL/CSV)
      await api.register(collaboratingRoutes); // /issues/collaborating (project-less)
      await api.register(homeRoutes); // /issues/assigned-to-me (project-less, главный экран)
      await api.register(searchRoutes); // /issues/search (project-less, кросс-проектный поиск)
      await api.register(departmentRoutes, { prefix: "/departments" });
      await api.register(projectsRoutes); // /projects (список, CRUD, bootstrap /projects/:projectId)

      // Ресурсы конкретного проекта — под параметрическим префиксом.
      await api.register(
        async (proj) => {
          await proj.register(memberRoutes, { prefix: "/members" }); // /:userId
          await proj.register(issuesRoutes, { prefix: "/issues" }); // CRUD + transition + watchers
          await proj.register(commentRoutes, { prefix: "/issues" }); // /:id/comments
          await proj.register(attachmentRoutes, { prefix: "/issues" }); // /:id/attachments[/:attId]
          await proj.register(collaboratorRoutes, { prefix: "/issues" }); // /:id/collaborators[/:userId]
          await proj.register(workflowRoutes, { prefix: "/workflow" });
          await proj.register(issueTemplatesRoutes, { prefix: "/issue-templates" });
          await proj.register(customFieldsRoutes, { prefix: "/custom-fields" });
          await proj.register(sprintsRoutes, { prefix: "/sprints" }); // опциональный модуль, см. SPRINTS_MIGRATION.md
          await proj.register(savedViewsRoutes, { prefix: "/saved-views" }); // личные, ТЗ 3.2
        },
        { prefix: "/projects/:projectId" },
      );
      await api.register(wsRoutes); // /ws — push уведомлений (Этап 3c)
    },
    { prefix: "/api" },
  );

  return app;
}
