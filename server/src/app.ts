/** Сборка Fastify: плагины, обработчики ошибок, маршруты. */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import { loadConfig } from "./config.js";
import { ApiHttpError } from "./middleware.js";
import { authRoutes } from "./routes/auth.js";
import { departmentRoutes } from "./routes/departments.js";
import { projectsRoutes } from "./routes/projects.js";
import { memberRoutes } from "./routes/members.js";
import { issuesRoutes } from "./routes/issues.js";
import { commentRoutes } from "./routes/comments.js";
import { sprintRoutes } from "./routes/sprints.js";
import { workflowRoutes } from "./routes/workflow.js";
import { userRoutes } from "./routes/users.js";
import { q } from "./db.js";
import { ZodError } from "zod";
import { formatZod } from "./middleware.js";

export function buildApp(): FastifyInstance {
  const cfg = loadConfig();

  const app = Fastify({ logger: { level: "info" } });

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
      await api.register(userRoutes); // /users, /admin/users (global admin)
      await api.register(departmentRoutes, { prefix: "/departments" });
      await api.register(projectsRoutes); // /projects (список, CRUD, bootstrap /projects/:projectId)

      // Ресурсы конкретного проекта — под параметрическим префиксом.
      await api.register(
        async (proj) => {
          await proj.register(memberRoutes, { prefix: "/members" }); // /:userId
          await proj.register(issuesRoutes, { prefix: "/issues" }); // CRUD + transition + sprint + watchers
          await proj.register(commentRoutes, { prefix: "/issues" }); // /:id/comments
          await proj.register(sprintRoutes, { prefix: "/sprints" });
          await proj.register(workflowRoutes, { prefix: "/workflow" });
        },
        { prefix: "/projects/:projectId" },
      );
      // Этап 3c: /ws
    },
    { prefix: "/api" },
  );

  return app;
}
