import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { auth, q } from "../helpers.js";
import { withTransaction } from "../../src/db.js";
import { advanceRun } from "../../src/services/workspaceProcesses.js";

export type WorkspaceObjects = Record<
  | "workspaceDocument"
  | "workspaceVersion"
  | "workspaceComment"
  | "workspaceFile"
  | "workspaceObjectType"
  | "workspaceObject"
  | "workspaceTemplate"
  | "workspaceRun"
  | "workspaceStep"
  | "workspaceRule"
  | "workspacePlan"
  | "workspaceLink"
  | "workspaceEvent",
  string
>;
export async function seedWorkspace(
  app: FastifyInstance,
  project: string,
  token: string,
  reviewer: string,
): Promise<WorkspaceObjects> {
  const base = `/api/projects/${project}`;
  const send = async (
    method: "POST" | "PATCH",
    path: string,
    payload: object | Buffer,
    extra: Record<string, string> = {},
  ) => {
    const r = await app.inject({
      method,
      url: base + path,
      headers: { ...auth(token), ...extra },
      payload,
    });
    if (r.statusCode >= 300)
      throw new Error(`workspace fixture ${path}: ${r.statusCode} ${r.body}`);
    return r.json();
  };
  await send("PATCH", "/workspace/modules", {
    documents: true,
    objects: true,
    processes: true,
    planning: true,
  });
  const document = await send("POST", "/documents", {
    title: "Access fixture",
  });
  const versions = (
    await app.inject({
      url: `${base}/documents/${document.id}/versions`,
      headers: auth(token),
    })
  ).json();
  const comment = await send("POST", `/documents/${document.id}/comments`, {
    body: "Review this block",
  });
  const boundary = `taskira${randomUUID()}`;
  const file = await send(
    "POST",
    `/documents/${document.id}/attachments`,
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.txt"\r\nContent-Type: text/plain\r\n\r\nfixture\r\n--${boundary}--\r\n`,
    ),
    { "content-type": `multipart/form-data; boundary=${boundary}` },
  );
  const type = await send("POST", "/object-types", {
    name: "Systems",
    fields: [],
  });
  const object = await send("POST", "/objects", {
    typeId: type.id,
    title: "Portal",
  });
  const link = await send("POST", "/entity-links", {
    source: { kind: "document", id: document.id },
    target: { kind: "object", id: object.id },
  });
  const template = await send("POST", "/process-templates", {
    name: "Review",
    steps: [{ key: "check", title: "Check", reviewerId: reviewer }],
  });
  await send("POST", `/process-templates/${template.id}/publish`, {});
  const run = await send("POST", "/process-runs", {
    templateId: template.id,
    title: "Access review",
    requestId: randomUUID(),
  });
  await q(
    "UPDATE issues SET status_id=(SELECT id FROM workflow_statuses WHERE project_id=$1 AND category='done' ORDER BY position LIMIT 1) WHERE id=$2",
    [project, run.steps[0].issueId],
  );
  await withTransaction((c) => advanceRun(c, run.id));
  const rule = await send("POST", "/automation-rules", {
    name: "Disabled rule",
    event: "issue.created",
    enabled: false,
    actions: [{ type: "createIssue", title: "Follow-up" }],
  });
  const event = (
    await q<{ id: string }>(
      "INSERT INTO workspace_events(project_id,type,failed_rule_id,error,attempts) VALUES($1,'issue.updated',$2,'Fixture failure',5) RETURNING id",
      [project, rule.id],
    )
  )[0];
  const plan = await send("POST", "/plans", { name: "Plan", items: [] });
  return {
    workspaceDocument: document.id,
    workspaceVersion: versions.items[0].id,
    workspaceComment: comment.items[0].id,
    workspaceFile: file.id,
    workspaceObjectType: type.id,
    workspaceObject: object.id,
    workspaceTemplate: template.id,
    workspaceRun: run.id,
    workspaceStep: run.steps[0].id,
    workspaceRule: rule.id,
    workspacePlan: plan.id,
    workspaceLink: link.id,
    workspaceEvent: event.id,
  };
}
