/** Сборка Fastify: плагины, обработчики ошибок, маршруты. */
import Fastify, { type FastifyInstance } from "fastify";
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
import { workflowRoutes } from "./routes/workflow.js";
import { userRoutes } from "./routes/users.js";
import { ldapRoutes } from "./routes/ldap.js";
import { notificationRoutes } from "./routes/notifications.js";
import { reportRoutes } from "./routes/reports.js";
import { wsRoutes } from "./routes/ws.js";
import { q } from "./db.js";
import { ZodError } from "zod";
import { formatZod } from "./middleware.js";

export function buildApp(): FastifyInstance {
  const cfg = loadConfig();

  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: "info" },
    // За nginx/LB: без этого `req.ip` = адрес прокси — ломает rate-limit логина
    // по IP и IP в audit-логе. Значение из TRUST_PROXY (см. .env.example).
    trustProxy: cfg.trustProxy,
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

  // Глобальный лимит запросов (аудит SEC-03): раньше он был только на логине,
  // и один аутентифицированный пользователь мог безнаказанно долбить любую ручку.
  // Ключ — id пользователя (а не IP): за корпоративным NAT у всех один адрес.
  if (cfg.rateLimit.enabled) {
    app.register(rateLimit, {
      global: true,
      max: cfg.rateLimit.max,
      timeWindow: cfg.rateLimit.windowMs,
      keyGenerator: (req) => {
        const sub = (req.user as { sub?: string } | undefined)?.sub;
        return sub ?? req.ip;
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
    credentials: false,
  });
  app.register(jwt, { secret: cfg.jwtSecret });
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

  /* Служебное: готовность + связь с БД. Нет БД — 503 для балансировщика/мониторинга. */
  app.get("/api/health", async (_req, reply) => {
    let db = true;
    try {
      await q(`SELECT 1`);
    } catch {
      db = false;
    }
    reply.code(db ? 200 : 503).send({ ok: db, db, ts: new Date().toISOString() });
  });

  app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(userRoutes); // /users, /admin/users (global admin) + /users/pickable
      await api.register(ldapRoutes, { prefix: "/ldap" }); // /ldap/ping (global admin)
      await api.register(notificationRoutes); // /notifications* (project-less, requireAuth)
      await api.register(reportRoutes); // /reports/* (project-less, scope = видимые проекты)
      await api.register(collaboratingRoutes); // /issues/collaborating (project-less)
      await api.register(homeRoutes); // /issues/assigned-to-me (project-less, главный экран)
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
        },
        { prefix: "/projects/:projectId" },
      );
      await api.register(wsRoutes); // /ws — push уведомлений (Этап 3c)
    },
    { prefix: "/api" },
  );

  return app;
}
