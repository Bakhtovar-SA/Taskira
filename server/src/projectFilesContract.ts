import { z } from "zod";
import { uuid } from "./idSchema.js";

export const ProjectFileType = z.enum(["images", "documents", "archives", "other"]);

export const ProjectFilesQuery = z.object({
  q: z.string().trim().max(250).default(""),
  type: z.enum(["all", ...ProjectFileType.options]).default("all"),
  sort: z.enum(["newest", "oldest", "name", "size"]).default("newest"),
  limit: z.coerce.number().int().min(1).max(50).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export type ProjectFilesQuery = z.infer<typeof ProjectFilesQuery>;

/** Project catalogue entries keep their issue as the source of download permissions. */
export const ProjectFileDto = z.object({
  id: uuid,
  filename: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  uploadedById: uuid.nullable(),
  uploaderName: z.string().nullable(),
  type: ProjectFileType,
  issue: z.object({
    id: uuid,
    key: z.string(),
    title: z.string(),
    archived: z.boolean(),
  }),
});
export type ProjectFileDto = z.infer<typeof ProjectFileDto>;
export type ProjectFile = ProjectFileDto;

export const ProjectFilesResultDto = z.object({
  items: z.array(ProjectFileDto),
  total: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type ProjectFilesResultDto = z.infer<typeof ProjectFilesResultDto>;
export type ProjectFilesResult = ProjectFilesResultDto;
