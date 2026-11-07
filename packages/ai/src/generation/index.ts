import { randomUUID } from "node:crypto";
import {
  generatedOutlineSchema,
  generatedSectionSchema,
  outlineSectionSchema,
  PROJECT_LENGTH_TARGETS,
  PROJECT_TEMPLATE_LABELS,
  ProviderError,
  type OutlineSection,
  type ProjectBlock,
  type ProjectLength,
  type ProjectMode,
  type ProjectTemplate,
} from "@foliomind/contracts";
import type { z } from "zod";
import { labelPassages, type LabeledPassage } from "../chat/citations";
import type { GeminiClient, GeminiThinkingLevel, TokenUsage } from "../gemini";
import { isDailyQuotaError } from "../gemini";
import {
  buildOutlinePrompt,
  buildOutlineSystem,
  buildSectionPrompt,
  buildSectionSystem,
} from "../prompts/generation";
import type { Passage } from "../retrieval/rerank";
import { buildSectionNodes, uncoveredSectionNodes } from "./blocks";

export * from "./blocks";

/*
 * Outlines and draft sections (blueprint Section 8): structured output parsed
 * with Zod, on the generation model first and the fast model when its quota is
 * spent. The free tier allows 20 requests a day per model, and a draft makes
 * one request per section, so the second model is what lets a draft finish.
 */

export interface GenerationDeps {
  gemini: GeminiClient;
  /** `GEMINI_GENERATION_MODEL`. */
  model: string;
  /** `GEMINI_FAST_MODEL`. */
  fallbackModel?: string | undefined;
}

export interface GenerationRun {
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  /** Requests made, including any that failed; each one counts against the daily quota. */
  requests: number;
}

const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  thoughtTokens: a.thoughtTokens + b.thoughtTokens,
  totalTokens: a.totalTokens + b.totalTokens,
});

const zeroUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, totalTokens: 0 };

/** Bad JSON or the wrong shape: no HTTP status, and worth one more try. */
const isBadOutput = (error: unknown) =>
  error instanceof ProviderError && error.status === undefined && !error.retryable;

/**
 * Raised when the model keeps returning output that can't be used, so the job
 * can say so plainly instead of treating it as a provider outage.
 */
export class GenerationOutputError extends Error {
  constructor() {
    super("generation_failed");
    this.name = "GenerationOutputError";
  }
}

/** Raised when both models' quota is gone for the day: waiting a few minutes won't help. */
export class GenerationDailyLimitError extends Error {
  constructor() {
    super("provider_daily_limit");
    this.name = "GenerationDailyLimitError";
  }
}

interface StructuredCall {
  system: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  thinking: GeminiThinkingLevel;
}

/**
 * One try on each model for a quota failure; one extra try for a passing failure
 * or unusable output. A retried Inngest step comes back here from the start.
 */
async function callStructured<TSchema extends z.ZodType>(
  deps: GenerationDeps,
  schema: TSchema,
  call: StructuredCall,
): Promise<{ data: z.infer<TSchema>; run: GenerationRun }> {
  const started = Date.now();
  const models = [
    deps.model,
    ...(deps.fallbackModel && deps.fallbackModel !== deps.model ? [deps.fallbackModel] : []),
  ];
  let requests = 0;
  let usage = zeroUsage;
  let lastError: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      requests += 1;
      try {
        const result = await deps.gemini.generateStructured(schema, { model, ...call });
        usage = addUsage(usage, result.usage);
        return {
          data: result.data,
          run: { model: result.model, usage, latencyMs: Date.now() - started, requests },
        };
      } catch (error) {
        lastError = error;
        if (!(error instanceof ProviderError)) throw error;
        // A 429 means this model's quota: go straight to the next one.
        if (error.status === 429) break;
        if (!error.retryable && !isBadOutput(error)) throw error;
      }
    }
  }
  if (isDailyQuotaError(lastError)) throw new GenerationDailyLimitError();
  if (isBadOutput(lastError)) throw new GenerationOutputError();
  throw lastError;
}

const toPromptPassage = (passage: LabeledPassage) => ({
  label: passage.label,
  sourceTitle: passage.sourceTitle,
  pageStart: passage.pageStart,
  pageEnd: passage.pageEnd,
  heading: passage.heading,
  text: passage.text,
});

export interface DocumentBrief {
  title: string;
  prompt: string;
  audience: string;
  length: ProjectLength;
  mode: ProjectMode;
}

/** Trims to the form's limits and drops anything empty, so the owner can edit what arrives. */
function toOutline(
  generated: z.infer<typeof generatedOutlineSchema>,
  limit: number,
): OutlineSection[] {
  return generated.sections
    .map((section) => ({
      id: randomUUID(),
      heading: section.heading
        .replace(/^\s*\d+[.)]\s*/, "")
        .trim()
        .slice(0, 150),
      notes: section.notes.trim().slice(0, 500),
    }))
    .filter((section) => outlineSectionSchema.safeParse(section).success)
    .slice(0, limit);
}

export async function generateOutline(
  deps: GenerationDeps,
  input: DocumentBrief & { passages: readonly Passage[] },
): Promise<{ outline: OutlineSection[]; run: GenerationRun }> {
  const target = PROJECT_LENGTH_TARGETS[input.length];
  const { data, run } = await callStructured(deps, generatedOutlineSchema, {
    system: buildOutlineSystem(input.mode),
    prompt: buildOutlinePrompt({
      title: input.title,
      brief: input.prompt,
      audience: input.audience,
      minSections: target.minSections,
      maxSections: target.maxSections,
      words: target.words,
      passages: labelPassages(input.passages).map(toPromptPassage),
    }),
    temperature: 0.3,
    // 15 headings with notes, plus low thinking, which counts toward this limit.
    maxOutputTokens: 4096,
    thinking: "low",
  });
  const outline = toOutline(data, 15);
  if (outline.length < 3) throw new GenerationOutputError();
  return { outline, run };
}

export interface SectionInput extends DocumentBrief {
  template: ProjectTemplate;
  outline: readonly OutlineSection[];
  section: OutlineSection;
  /** Empty in general mode; in research mode, what retrieval found for this section. */
  passages: readonly Passage[];
}

export interface GeneratedSectionResult {
  nodes: ProjectBlock[];
  citations: number;
  unknownLabels: string[];
  /** The sources didn't support it, so the section says that instead of guessing. */
  uncovered: boolean;
  run: GenerationRun | null;
}

/** Words per section, from the document's target and how many sections it has. */
export function sectionWords(length: ProjectLength, sections: number): number {
  return Math.round(PROJECT_LENGTH_TARGETS[length].words / Math.max(1, sections));
}

/**
 * One section. A research section with evidence but no citation is not grounded,
 * so it gets one more try and then the honest placeholder.
 */
export async function generateSection(
  deps: GenerationDeps,
  input: SectionInput,
): Promise<GeneratedSectionResult> {
  const { section } = input;
  const research = input.mode === "research";
  if (research && input.passages.length === 0) {
    return {
      nodes: uncoveredSectionNodes({ sectionId: section.id, heading: section.heading }),
      citations: 0,
      unknownLabels: [],
      uncovered: true,
      run: null,
    };
  }

  const labeled = labelPassages(input.passages);
  const words = sectionWords(input.length, input.outline.length);
  const request = () =>
    callStructured(deps, generatedSectionSchema, {
      system: buildSectionSystem(input.mode),
      prompt: buildSectionPrompt({
        title: input.title,
        brief: input.prompt,
        audience: input.audience,
        style: PROJECT_TEMPLATE_LABELS[input.template],
        outline: input.outline,
        heading: section.heading,
        notes: section.notes,
        words,
        passages: labeled.map(toPromptPassage),
      }),
      temperature: research ? 0.2 : 0.4,
      // JSON and labels add to the words; thinking is off, so all of this is output.
      maxOutputTokens: Math.min(8192, Math.max(2048, words * 4)),
      thinking: "minimal",
    });

  const first = await request();
  const builtFirst = buildSectionNodes(first.data, {
    sectionId: section.id,
    heading: section.heading,
    passages: research ? labeled : [],
  });
  if (!research || builtFirst.citations > 0) {
    return { ...builtFirst, uncovered: false, run: first.run };
  }

  const second = await request();
  const run: GenerationRun = {
    model: second.run.model,
    usage: addUsage(first.run.usage, second.run.usage),
    latencyMs: first.run.latencyMs + second.run.latencyMs,
    requests: first.run.requests + second.run.requests,
  };
  const builtSecond = buildSectionNodes(second.data, {
    sectionId: section.id,
    heading: section.heading,
    passages: labeled,
  });
  if (builtSecond.citations > 0) return { ...builtSecond, uncovered: false, run };
  return {
    nodes: uncoveredSectionNodes({ sectionId: section.id, heading: section.heading }),
    citations: 0,
    unknownLabels: builtSecond.unknownLabels,
    uncovered: true,
    run,
  };
}
