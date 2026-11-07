import { generateOutline } from "@foliomind/ai/generation";
import {
  assertProjectJobCanContinue,
  commitProjectUsage,
  failProjectJob,
  jobAlreadySucceeded,
  jobErrorCodeFrom,
  loadGenerationContext,
  markJobPhase,
  saveGeneratedOutline,
  stopProjectJob,
} from "@foliomind/domain";
import type { Inngest } from "inngest";
import {
  notificationCreated,
  projectGenerationCancelled,
  projectOutlineRequested,
} from "../../events";
import { isStopped } from "../ingestion/shared";
import {
  findEvidence,
  generationDeps,
  guardedGeneration,
  heavyConcurrency,
  recordGeneration,
  type WorkerBDeps,
} from "./shared";

/*
 * `generate-outline` (blueprint Section 9): load sources → retrieve evidence →
 * Gemini structured outline → validate → save. These share one step so document
 * text never enters Inngest's run state. Nothing is drafted until the owner
 * approves the outline.
 */

export function createGenerateOutlineFunction(inngest: Inngest, deps: WorkerBDeps) {
  const { db } = deps;
  return inngest.createFunction(
    {
      id: "generate-outline",
      name: "Generate project outline",
      triggers: [projectOutlineRequested],
      retries: 3,
      idempotency: "event.data.operationKey",
      concurrency: [heavyConcurrency(deps.heavyConcurrency)],
      cancelOn: [{ event: projectGenerationCancelled, match: "data.jobId" }],
      onFailure: async ({ event, error, step }) => {
        const { jobId, projectId, ownerId, usageKey } = event.data.event.data;
        const failed = await step.run("record-failure", async () => {
          if (isStopped(error)) {
            await stopProjectJob(db, { jobId, projectId, usageKey });
            return false;
          }
          const code = jobErrorCodeFrom(error);
          deps.logger.warn({ jobId, projectId, code }, "outline failed");
          return failProjectJob(db, { jobId, projectId, usageKey, code, markProject: true });
        });
        if (!failed) return;
        await step.sendEvent("notify-failure", {
          id: `notify:generation_failed:${jobId}`,
          name: notificationCreated.name,
          data: {
            userId: ownerId,
            type: "generation_failed",
            subjectId: projectId,
            operationKey: `generation_failed:${jobId}`,
          },
        });
      },
    },
    async ({ event, step, runId, attempt }) => {
      const { projectId, ownerId, jobId, usageKey } = event.data;

      const result = await step.run("generate", () =>
        guardedGeneration(async () => {
          if (await jobAlreadySucceeded(db, jobId)) return { sections: 0 };
          await assertProjectJobCanContinue(db, jobId, projectId);
          await markJobPhase(db, jobId, "retrieving", {
            run: { runId, eventId: event.id, attempt },
          });
          const { project, sources } = await loadGenerationContext(db, { projectId, ownerId });
          const passages = await findEvidence(deps, {
            ownerId,
            question: project.prompt,
            sources,
          });

          await markJobPhase(db, jobId, "outlining");
          const { outline, run } = await generateOutline(generationDeps(deps), {
            title: project.title,
            prompt: project.prompt,
            audience: project.settings.audience,
            length: project.settings.length,
            mode: project.mode,
            passages,
          });
          await recordGeneration(deps, {
            ownerId,
            jobId,
            purpose: "project-outline",
            run,
            metadata: {
              projectId,
              sections: outline.length,
              passages: passages.length,
            },
          });

          await assertProjectJobCanContinue(db, jobId, projectId);
          await saveGeneratedOutline(db, { projectId, jobId, usageKey, outline });
          return { sections: outline.length };
        }),
      );

      // Its own step, so a failure here is retried without generating again.
      await step.run("commit-usage", () => commitProjectUsage(db, usageKey));
      return result;
    },
  );
}
