import { generateSection } from "@foliomind/ai/generation";
import { docSectionIds } from "@foliomind/contracts";
import {
  assertProjectJobCanContinue,
  commitProjectUsage,
  failProjectJob,
  finishDraft,
  jobAlreadySucceeded,
  jobErrorCodeFrom,
  JobStopped,
  loadGenerationContext,
  markJobPhase,
  saveDraftSection,
  startDraft,
  stopProjectJob,
  updateJobProgress,
} from "@foliomind/domain";
import type { Inngest } from "inngest";
import {
  notificationCreated,
  projectDraftRequested,
  projectGenerationCancelled,
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
 * `generate-draft` (blueprint Section 9): one step per section, so the editor
 * fills as each is written, a failure keeps what's done and a retry picks up the
 * rest. Each step re-checks the job, the owner and every source, and returns
 * only counts: the draft's text is written to Postgres, not to run state.
 */

export function createGenerateDraftFunction(inngest: Inngest, deps: WorkerBDeps) {
  const { db } = deps;
  return inngest.createFunction(
    {
      id: "generate-draft",
      name: "Generate project draft",
      triggers: [projectDraftRequested],
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
          deps.logger.warn({ jobId, projectId, code }, "draft failed");
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
      const { projectId, ownerId, jobId, usageKey, replace } = event.data;

      const plan = await step.run("plan", () =>
        guardedGeneration(async () => {
          await assertProjectJobCanContinue(db, jobId, projectId);
          await markJobPhase(db, jobId, "drafting", {
            run: { runId, eventId: event.id, attempt },
          });
          const { project } = await loadGenerationContext(db, { projectId, ownerId });
          await startDraft(db, { projectId, replace });
          // Retrying a failed draft leaves finished sections alone: they may be charged for already.
          const written = new Set(replace ? [] : docSectionIds(project.content));
          const sections = project.outline.map((section) => section.id);
          const remaining = sections.filter((id) => !written.has(id));
          await updateJobProgress(db, jobId, {
            sections: sections.length,
            sectionsDone: sections.length - remaining.length,
          });
          return { sections, remaining };
        }),
      );

      let done = plan.sections.length - plan.remaining.length;
      const summary = { citations: 0, uncovered: 0, requests: 0 };
      for (const sectionId of plan.remaining) {
        done += 1;
        const position = done;
        const written = await step.run(`section-${sectionId}`, () =>
          guardedGeneration(async () => {
            await assertProjectJobCanContinue(db, jobId, projectId);
            const { project, sources } = await loadGenerationContext(db, { projectId, ownerId });
            const section = project.outline.find((item) => item.id === sectionId);
            if (!section) throw new JobStopped("missing");

            const passages = await findEvidence(deps, {
              ownerId,
              question: `${section.heading}. ${section.notes}`,
              sources,
            });
            const result = await generateSection(generationDeps(deps), {
              title: project.title,
              prompt: project.prompt,
              audience: project.settings.audience,
              length: project.settings.length,
              mode: project.mode,
              template: project.templateKey,
              outline: project.outline,
              section,
              passages,
            });
            await recordGeneration(deps, {
              ownerId,
              jobId,
              purpose: "project-section",
              run: result.run,
              metadata: {
                projectId,
                sectionId,
                passages: passages.length,
                citations: result.citations,
                unknownLabels: result.unknownLabels.length,
                uncovered: result.uncovered,
              },
            });

            await assertProjectJobCanContinue(db, jobId, projectId);
            await saveDraftSection(db, {
              projectId,
              jobId,
              section: { sectionId, nodes: result.nodes },
              outlineIds: project.outline.map((item) => item.id),
              done: position,
              total: plan.sections.length,
            });
            return {
              citations: result.citations,
              uncovered: result.uncovered,
              requests: result.run?.requests ?? 0,
            };
          }),
        );
        summary.citations += written.citations;
        summary.uncovered += written.uncovered ? 1 : 0;
        summary.requests += written.requests;
      }

      await step.run("finish", () =>
        guardedGeneration(async () => {
          if (await jobAlreadySucceeded(db, jobId)) return;
          await assertProjectJobCanContinue(db, jobId, projectId);
          await markJobPhase(db, jobId, "composing");
          await finishDraft(db, { projectId, jobId, ownerId, usageKey });
        }),
      );
      await step.run("commit-usage", () => commitProjectUsage(db, usageKey));
      await step.sendEvent("notify-ready", {
        id: `notify:draft_ready:${jobId}`,
        name: notificationCreated.name,
        data: {
          userId: ownerId,
          type: "draft_ready",
          subjectId: projectId,
          operationKey: `draft_ready:${jobId}`,
        },
      });
      return summary;
    },
  );
}
