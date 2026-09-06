/** Сборка Fastify: плагины, обработчики ошибок, маршруты. */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import { loadConfig } from "./config.js";
import { ApiHttpError } from "./middleware.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/project.js";
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
    credentials: false,
  });
  app.register(jwt, { secret: cfg.jwtSecret });
  app.register(websocket); // realtime-маршруты — Этап 3c

  /* Единый формат ошибок: { error: { code, reason } } */
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiHttpError) {
      reply.code(err.statusCode).send({ error: { code: err.code, reason: err.message } });
      return;
    }
    if (err instanceof ZodError) {
      reply.code(400).send({ error: { code: "VALIDATION", reason: formatZod(err) } });
      return;
    }
    if (err.validation) {
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
      await api.register(projectRoutes); // GET  /project (bootstrap)
      await api.register(issuesRoutes, { prefix: "/issues" }); // CRUD + transition + sprint + watchers
      await api.register(commentRoutes, { prefix: "/issues" }); // /:id/comments
      await api.register(sprintRoutes, { prefix: "/sprints" });
      await api.register(workflowRoutes, { prefix: "/workflow" });
      await api.register(userRoutes); // /users, /admin/users
      // Этап 3c: /ws
    },
    { prefix: "/api" },
  );

  return app;
}
