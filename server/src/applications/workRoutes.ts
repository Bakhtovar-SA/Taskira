import type { FastifyInstance } from "fastify";
import { issuesRoutes } from "../routes/issues.js";
import { issuesBulkRoutes } from "../routes/issuesBulk.js";
import { issueAutomationRoutes } from "../routes/issueAutomation.js";
import { commentRoutes } from "../routes/comments.js";
import { attachmentRoutes } from "../routes/attachments.js";
import { collaboratorRoutes } from "../routes/collaborators.js";
import { workflowRoutes } from "../routes/workflow.js";
import { issueTemplatesRoutes } from "../routes/issueTemplates.js";
import { recurringRoutes } from "../routes/recurring.js";
import { customFieldsRoutes } from "../routes/customFields.js";
import { sprintsRoutes } from "../routes/sprints.js";
import { savedViewsRoutes } from "../routes/savedViews.js";


export async function workProjectRoutes(app: FastifyInstance): Promise<void> {
  await app.register(issuesRoutes, { prefix: "/issues" });
  await app.register(issueAutomationRoutes, { prefix: "/issues" });
  await app.register(issuesBulkRoutes, { prefix: "/issues" });
  await app.register(commentRoutes, { prefix: "/issues" });
  await app.register(attachmentRoutes, { prefix: "/issues" });
  await app.register(collaboratorRoutes, { prefix: "/issues" });
  await app.register(workflowRoutes, { prefix: "/workflow" });
  await app.register(issueTemplatesRoutes, { prefix: "/issue-templates" });
  await app.register(recurringRoutes, { prefix: "/recurring" });
  await app.register(customFieldsRoutes, { prefix: "/custom-fields" });
  await app.register(sprintsRoutes, { prefix: "/sprints" });
  await app.register(savedViewsRoutes, { prefix: "/saved-views" });
}
