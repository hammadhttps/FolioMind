import { z } from "zod";
import { jobStatusResponseSchema } from "./jobs";
import {
  outlineSectionSchema,
  PROJECT_MODES,
  PROJECT_STATUSES,
  PROJECT_TEMPLATES,
  projectAllowanceSchema,
  projectDocSchema,
  projectExportViewSchema,
  projectRevisionViewSchema,
  projectSettingsSchema,
  sectionProposalSchema,
} from "./projects";

/*
 * `GET /api/projects/:id`: everything PDF Studio shows, in one read, for the
 * page's first render and the poll while a job runs. The document is left out
 * when the client already holds this counter, because it's the largest part.
 */

export const projectSourceViewSchema = z.object({
  versionId: z.uuid(),
  title: z.string(),
  /** Readable and ready right now; anything else blocks new generation (Section 8). */
  available: z.boolean(),
});
export type ProjectSourceView = z.infer<typeof projectSourceViewSchema>;

export const GENERATION_CHARGES = ["none", "project", "regeneration"] as const;
export type GenerationCharge = (typeof GENERATION_CHARGES)[number];

export const studioStateSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  mode: z.enum(PROJECT_MODES),
  status: z.enum(PROJECT_STATUSES),
  prompt: z.string(),
  settings: projectSettingsSchema,
  template: z.enum(PROJECT_TEMPLATES),
  outline: z.array(outlineSectionSchema),
  revisionCounter: z.number().int(),
  content: projectDocSchema.nullable(),
  archived: z.boolean(),
  firstDraftDone: z.boolean(),
  sources: z.array(projectSourceViewSchema),
  proposals: z.array(sectionProposalSchema),
  /** The newest generation or export job: live, or how the last one ended. */
  job: jobStatusResponseSchema.nullable(),
  revisions: z.array(projectRevisionViewSchema),
  exports: z.array(projectExportViewSchema),
  allowance: projectAllowanceSchema,
  charges: z.object({
    outline: z.enum(GENERATION_CHARGES),
    draft: z.enum(GENERATION_CHARGES),
  }),
});
export type StudioState = z.infer<typeof studioStateSchema>;
