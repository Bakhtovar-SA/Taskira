import { z } from "zod";

const id = z.string().uuid();
const title = z.string().trim().min(1).max(240);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  );
export const WorkspaceModules = z
  .object({
    documents: z.boolean(),
    objects: z.boolean(),
    processes: z.boolean(),
    planning: z.boolean(),
    files: z.boolean(),
  })
  .strict();
export type WorkspaceModules = z.infer<typeof WorkspaceModules>;
// Omitting files from an older client's request preserves its current value.
export const WorkspaceModulesBody = WorkspaceModules.extend({
  files: z.boolean().optional(),
});
export type WorkspaceModulesBody = z.infer<typeof WorkspaceModulesBody>;
export const DEFAULT_MODULES: WorkspaceModules = {
  documents: false,
  objects: false,
  processes: false,
  planning: false,
  files: true,
};
export const EntityRef = z
  .object({ kind: z.enum(["issue", "document", "object", "process"]), id })
  .strict();
export type EntityRef = z.infer<typeof EntityRef>;
export const EntityLinkBody = z
  .object({ source: EntityRef, target: EntityRef })
  .strict();
export interface EntityLink {
  id: string;
  source: EntityRef;
  target: EntityRef;
  title: string;
  archived: boolean;
}
export const DocumentCreateBody = z
  .object({
    title,
    parentId: id.nullable().default(null),
    ownerId: id.nullable().default(null),
    template: z
      .enum(["blank", "instruction", "minutes", "decision", "regulation"])
      .default("blank"),
  })
  .strict();
export const DocumentPatchBody = z
  .object({
    title: title.optional(),
    parentId: id.nullable().optional(),
    ownerId: id.nullable().optional(),
    archived: z.boolean().optional(),
    revision: z.number().int().positive(),
  })
  .strict();
export const VersionBody = z
  .object({ name: z.string().trim().max(160).default("") })
  .strict();
export const VerifyDocumentBody = z
  .object({ versionId: id, validUntil: date.nullable() })
  .strict();
export const DocumentCommentBody = z
  .object({
    body: z.string().trim().min(1).max(10000),
    blockId: z.string().max(100).nullable().default(null),
    parentId: id.nullable().default(null),
  })
  .strict();
export interface Document {
  id: string;
  projectId: string;
  title: string;
  parentId: string | null;
  ownerId: string | null;
  generation: number;
  revision: number;
  contentRevision: number;
  updatedAt: string;
  archived: boolean;
  verifiedVersionId: string | null;
  verifiedContentRevision: number | null;
  validUntil: string | null;
  text: string;
}
export interface DocumentVersion {
  id: string;
  documentId: string;
  name: string;
  createdAt: string;
  createdBy: string | null;
  contentRevision: number;
  content: unknown;
}
export interface DocumentComment {
  id: string;
  documentId: string;
  body: string;
  blockId: string | null;
  parentId: string | null;
  authorId: string | null;
  authorName: string;
  resolved: boolean;
  createdAt: string;
}
export interface DocumentFile {
  id: string;
  documentId: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}
export const ObjectField = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    name: title,
    type: z.enum([
      "text",
      "number",
      "date",
      "select",
      "checkbox",
      "user",
      "reference",
    ]),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  })
  .strict();
export type ObjectField = z.infer<typeof ObjectField>;
export const ObjectTypeShape = z
  .object({ name: title, fields: z.array(ObjectField).max(30) })
  .strict();
export const ObjectTypeBody = ObjectTypeShape.superRefine((v, ctx) => {
  if (new Set(v.fields.map((f) => f.key)).size !== v.fields.length)
    ctx.addIssue({
      code: "custom",
      message: "Ключи полей должны быть уникальными",
    });
  for (const f of v.fields)
    if (f.type === "select" && !f.options.length)
      ctx.addIssue({
        code: "custom",
        message: "У списка должны быть варианты",
      });
});
export type FieldValue = string | number | boolean | null;
const values = z.record(
  z.string(),
  z.union([z.string().max(10000), z.number().finite(), z.boolean(), z.null()]),
);
export const ObjectCreateBody = z
  .object({
    typeId: id,
    title,
    ownerId: id.nullable().default(null),
    values: values.default({}),
  })
  .strict();
export const ObjectPatchBody = z
  .object({
    title: title.optional(),
    ownerId: id.nullable().optional(),
    values: values.optional(),
    archived: z.boolean().optional(),
    revision: z.number().int().positive(),
  })
  .strict();
export interface ObjectType {
  id: string;
  projectId: string;
  name: string;
  fields: ObjectField[];
  revision: number;
}
export interface ObjectRecord {
  id: string;
  projectId: string;
  typeId: string;
  title: string;
  ownerId: string | null;
  values: Record<string, FieldValue>;
  archived: boolean;
  revision: number;
  updatedAt: string;
  openIssues?: number;
  lastCheck?: string | null;
}
export const Condition = z
  .object({
    field: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((v) => !["__proto__", "constructor", "prototype"].includes(v)),
    op: z.enum(["eq", "neq", "includes", "isSet"]),
    value: z
      .union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()])
      .default(null),
  })
  .strict();
export const Conditions = z
  .object({
    mode: z.enum(["all", "any"]).default("all"),
    items: z.array(Condition).max(20).default([]),
  })
  .strict();
export type Conditions = z.infer<typeof Conditions>;
export const ProcessStep = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    title,
    description: z.string().max(30000).default(""),
    dependsOn: z.array(z.string().max(40)).max(40).default([]),
    complexity: z.enum(["simple", "medium", "hard"]).nullable().default(null),
    dueInDays: z.number().int().min(0).max(365).nullable().default(null),
    assigneeIds: z.array(id).max(20).default([]),
    reviewerId: id.nullable().default(null),
    documentVersionId: id.nullable().default(null),
    when: Conditions.default({ mode: "all", items: [] }),
  })
  .strict();
export type ProcessStep = z.infer<typeof ProcessStep>;
export const ProcessTemplateBody = z
  .object({
    name: title,
    description: z.string().max(10000).default(""),
    steps: z.array(ProcessStep).min(1).max(40),
  })
  .strict();
export type ProcessTemplateBody = z.infer<typeof ProcessTemplateBody>;
export interface ProcessTemplateVersion {
  id: string;
  templateId: string;
  version: number;
  spec: ProcessTemplateBody;
  createdAt: string;
}
export interface ProcessTemplate {
  id: string;
  projectId: string;
  name: string;
  draft: ProcessTemplateBody;
  revision: number;
  publishedVersionId: string | null;
  archived: boolean;
}
export const ProcessStartBody = z
  .object({
    templateId: id,
    title,
    objectId: id.nullable().default(null),
    assigneeIds: z.array(id).max(20).default([]),
    parameters: values.default({}),
    requestId: id,
  })
  .strict();
export interface ProcessStepRun {
  id: string;
  key: string;
  title: string;
  state: "waiting" | "active" | "review" | "completed" | "skipped";
  issueId: string | null;
  issueKey: string | null;
  approved: boolean;
  reviewerId: string | null;
  complexity: string | null;
  dependsOn: string[];
}
export interface ProcessRun {
  id: string;
  projectId: string;
  title: string;
  templateVersionId: string;
  state: "running" | "paused" | "completed" | "cancelled";
  ownerId: string;
  error: string | null;
  createdAt: string;
  steps: ProcessStepRun[];
  log: WorkspaceHistory[];
}
export const RuleAction = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("createIssue"),
      title,
      complexity: z.enum(["simple", "medium", "hard"]).nullable().default(null),
      assigneeIds: z.array(id).max(20).default([]),
    })
    .strict(),
  z
    .object({
      type: z.literal("updateIssue"),
      priorityId: z.enum(["low", "medium", "high", "critical"]).optional(),
      assigneeIds: z.array(id).max(20).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("notify"),
      userIds: z.array(id).min(1).max(20),
      message: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z.object({ type: z.literal("startProcess"), templateId: id, title }).strict(),
]);
export const AutomationRuleBody = z
  .object({
    name: title,
    event: z.enum([
      "issue.created",
      "issue.updated",
      "issue.statusChanged",
      "issue.due",
      "step.completed",
    ]),
    when: Conditions.default({ mode: "all", items: [] }),
    actions: z.array(RuleAction).min(1).max(10),
    enabled: z.boolean().default(false),
  })
  .strict();
export type AutomationRuleBody = z.infer<typeof AutomationRuleBody>;
export interface AutomationRule extends AutomationRuleBody {
  id: string;
  ownerId: string;
  error: string | null;
}
export const PlanItem = z
  .object({
    kind: z.enum(["issue", "step"]),
    id,
    title,
    complexity: z.enum(["simple", "medium", "hard"]).nullable(),
    dependsOn: z.array(id).max(100).default([]),
  })
  .strict();
export type PlanItem = z.infer<typeof PlanItem>;
export const PlanBody = z
  .object({
    name: title,
    targetDate: date.nullable().default(null),
    items: z.array(PlanItem).max(500),
  })
  .strict();
export type PlanBody = z.infer<typeof PlanBody>;
export interface PlanScenario extends PlanBody {
  id: string;
  projectId: string;
  planId: string | null;
  revision: number;
}
export interface ForecastResult {
  reasonCode:
    | "insufficientHistory"
    | "missingHistory"
    | "missingDependency"
    | "invalidDependencies"
    | "duplicateWork"
    | "emptyWork"
    | null;
  projection: { week: string; lower: number; median: number; upper: number }[];
  sufficientHistory: boolean;
  reason: string | null;
  historyWeeks: number;
  completedIssues: number;
  medianWeek: string | null;
  p80Week: string | null;
  samples: number;
  asOf: string;
  weekly: { week: string; counts: Record<string, number> }[];
}
export interface WorkspaceHistory {
  id: string;
  action: string;
  actorId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}
export interface LibraryItem {
  ref: EntityRef;
  projectId: string;
  projectKey: string;
  projectName: string;
  title: string;
  text: string;
  updatedAt: string;
  archived: boolean;
}
export const IdParams = z.object({ id }).passthrough();

export interface AutomationExecution {
  eventId: string;
  type: string;
  attempts: number;
  error: string | null;
  processedAt: string | null;
  createdAt: string;
  actions: { key: string; type: string; result: unknown }[];
}

export const ProjectFilesQuery = z.object({
  q: z.string().trim().max(200).default(""),
  source: z.enum(["all", "issue", "document"]).default("all"),
  sort: z.enum(["newest", "oldest", "name", "size"]).default("newest"),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ProjectFilesQuery = z.infer<typeof ProjectFilesQuery>;
export const ProjectFileDto = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  createdAt: z.string(),
  uploadedBy: z.string().uuid().nullable(),
  uploaderName: z.string().nullable(),
  source: z.object({
    kind: z.enum(["issue", "document"]),
    id: z.string().uuid(),
    title: z.string(),
    key: z.string().nullable(),
    archived: z.boolean(),
  }),
});
export type ProjectFile = z.infer<typeof ProjectFileDto>;
export const ProjectFilesResultDto = z.object({
  items: z.array(ProjectFileDto),
  total: z.number(),
  totalBytes: z.number(),
  offset: z.number(),
  limit: z.number(),
});
export type ProjectFilesResult = z.infer<typeof ProjectFilesResultDto>;
