/** Департаменты: список (любой аутентифицированный), CRUD — только глобальный admin.
 *
 *  GET    /api/departments        — список с числом проектов
 *  POST   /api/departments        — создать           [global admin]
 *  PATCH  /api/departments/:id     — переименовать      [global admin]
 *  DELETE /api/departments/:id     — удалить (409, если есть проекты)   [global admin]
 */
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { one, q } from "../db.js";
import { notFound, requireAuth, requireGlobalAdmin, zbody, zparams, type JwtPayload } from "../middleware.js";
import { conflict } from "../services/workflow.js";
import { audit } from "../audit.js";
import { getDepartment, listDepartments } from "../services/departments.js";
import { DepartmentBody, DepartmentParams } from "../contract.js";

export async function departmentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: requireAuth }, async () => listDepartments());

  app.post(
    "/",
    { preHandler: requireGlobalAdmin, preValidation: zbody(DepartmentBody) },
    async (req, reply) => {
      const actor: JwtPayload = req.user;
      const { name } = req.body as z.infer<typeof DepartmentBody>;
      let id: string;
      try {
        id = (await one<{ id: string }>(`INSERT INTO departments (name) VALUES ($1) RETURNING id`, [name]))!.id;
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw conflict("Отдел с таким названием уже есть");
        throw e;
      }
      await audit(actor.sub, "department.create", "department", id, { name });
      reply.code(201).send(await getDepartment(id));
    },
  );

  app.patch(
    "/:id",
    { preHandler: requireGlobalAdmin, preValidation: [zparams(DepartmentParams), zbody(DepartmentBody)] },
    async (req) => {
      const actor: JwtPayload = req.user;
      const { id } = req.params as z.infer<typeof DepartmentParams>;
      const { name } = req.body as z.infer<typeof DepartmentBody>;
      let rows: { id: string }[];
      try {
        rows = await q<{ id: string }>(`UPDATE departments SET name = $1 WHERE id = $2 RETURNING id`, [name, id]);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw conflict("Отдел с таким названием уже есть");
        throw e;
      }
      if (rows.length === 0) throw notFound("Отдел не найден");
      await audit(actor.sub, "department.update", "department", id, { name });
      return getDepartment(id);
    },
  );

  app.delete(
    "/:id",
    { preHandler: requireGlobalAdmin, preValidation: zparams(DepartmentParams) },
    async (req, reply) => {
      const actor: JwtPayload = req.user;
      const { id } = req.params as z.infer<typeof DepartmentParams>;
      const dep = await one<{ id: string }>(`SELECT id FROM departments WHERE id = $1`, [id]);
      if (!dep) throw notFound("Отдел не найден");
      const n = (await one<{ n: string }>(`SELECT count(*)::text AS n FROM projects WHERE department_id = $1`, [id]))!;
      if (Number(n.n) > 0) throw conflict("В отделе есть проекты — сначала перенесите или удалите их");
      await q(`DELETE FROM departments WHERE id = $1`, [id]);
      await audit(actor.sub, "department.delete", "department", id, {});
      reply.code(204).send();
    },
  );
}
