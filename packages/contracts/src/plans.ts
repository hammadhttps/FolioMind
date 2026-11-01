import { z } from "zod";

/*
 * Plans and allowances (blueprint Section 10). Limits are stored as versioned
 * JSON in `plans.limits`; bump `version` when commercial terms change. These
 * are provisional values for implementation and load testing.
 */

export const PLAN_CODES = ["free", "pro"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

const MIB = 1024 * 1024;

export const planLimitsSchema = z.object({
  version: z.literal(1),
  /** Owned source documents, uploads and imports together (a gauge). */
  ownedSourcePdfs: z.number().int().nonnegative(),
  /** Stored bytes including generated exports (a gauge). */
  storageBytes: z.number().int().nonnegative(),
  aiQuestionsPerMonth: z.number().int().nonnegative(),
  generatedProjectsPerMonth: z.number().int().nonnegative(),
  workspaceSourcesMax: z.number().int().positive(),
  sectionRegenerationsPerMonth: z.number().int().nonnegative(),
  reexportsPerMonth: z.number().int().nonnegative(),
  urlImportsPerMonth: z.number().int().nonnegative(),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

export const PLAN_LIMITS: Record<PlanCode, PlanLimits> = {
  free: {
    version: 1,
    ownedSourcePdfs: 5,
    storageBytes: 100 * MIB,
    aiQuestionsPerMonth: 30,
    generatedProjectsPerMonth: 2,
    workspaceSourcesMax: 2,
    sectionRegenerationsPerMonth: 10,
    reexportsPerMonth: 10,
    urlImportsPerMonth: 5,
  },
  pro: {
    version: 1,
    ownedSourcePdfs: 100,
    storageBytes: 2048 * MIB,
    aiQuestionsPerMonth: 500,
    generatedProjectsPerMonth: 25,
    workspaceSourcesMax: 5,
    sectionRegenerationsPerMonth: 100,
    reexportsPerMonth: 100,
    urlImportsPerMonth: 50,
  },
};

/**
 * Allowances counted per entitlement period in `usage_buckets`. Owned sources
 * and storage are gauges computed from current rows, never monthly buckets.
 */
export const USAGE_METRICS = {
  ai_questions: "aiQuestionsPerMonth",
  generated_projects: "generatedProjectsPerMonth",
  section_regenerations: "sectionRegenerationsPerMonth",
  reexports: "reexportsPerMonth",
  url_imports: "urlImportsPerMonth",
} as const satisfies Record<string, keyof PlanLimits>;

export type UsageMetric = keyof typeof USAGE_METRICS;
export const usageMetricSchema = z.enum(
  Object.keys(USAGE_METRICS) as [UsageMetric, ...UsageMetric[]],
);
