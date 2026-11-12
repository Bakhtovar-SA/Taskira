import { z } from "zod";

/** Stable product identifiers; labels and icons belong to the client. */
export const ApplicationId = z.enum(["work", "knowledge", "objects"]);
export type ApplicationId = z.infer<typeof ApplicationId>;
export const ApplicationEnabled = z.object({
  work: z.boolean(),
  knowledge: z.boolean(),
  objects: z.boolean(),
}).strict();
export type ApplicationEnabled = z.infer<typeof ApplicationEnabled>;
export const ApplicationsDto = z.object({
  revision: z.number().int().positive(),
  canManage: z.boolean(),
  applications: z.array(z.object({
    id: ApplicationId,
    enabled: z.boolean(),
    /** Visible projects, including existing material when its project module is off. */
    projectIds: z.array(z.string().uuid()),
  }).strict()),
}).strict();
export type ApplicationsDto = z.infer<typeof ApplicationsDto>;
export const ApplicationsPatchBody = z.object({
  revision: z.number().int().positive(),
  enabled: ApplicationEnabled,
}).strict().refine(({ enabled }) => Object.values(enabled).some(Boolean), {
  path: ["enabled"],
  message: "Оставьте включённым хотя бы одно приложение",
});
export type ApplicationsPatchBody = z.infer<typeof ApplicationsPatchBody>;
