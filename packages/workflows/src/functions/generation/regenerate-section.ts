import { generateSection } from "@foliomind/ai/generation";
import { sectionNodes } from "@foliomind/contracts";
import {
  assertProjectJobCanContinue,
  commitProjectUsage,
  failProjectJob,
  jobAlreadySucceeded,
  jobErrorCodeFrom,
  JobFailure,
  loadGenerationContext,
  markJobPhase,
  saveSectionProposal,
  stopProjectJob,
} from "@foliomind/domain";
import type { Inngest } from "inngest";
import { projectGenerationCancelled, projectSectionRequested } from "../../events";
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
 * `regenerate-section` (blueprint Sections 5 and 9): retrieve → generate →
 * validate → save as a proposal. It never touches the document: the owner sees
 * the proposal beside their text and confirms before anything is replaced.
 */

export function createRegenerateSectionFunction(inngest: Inngest, deps: WorkerBDeps) {
  const { db } = deps;
  return inngest.createFunction(
    {
      id: "regenerate-section",
      name: "Regenerate project section",
      triggers: [projectSectionRequested],
      retries: 3,
      idempotency: "event.data.operationKey",
      concurrency: [heavyConcurrency(deps.heavyConcurrency)],
      cancelOn: [{ event: projectGenerationCancelled, match: "data.jobId" }],
      onFailure: async ({ event, error, step }) => {
        const { jobId, projectId, usageKey } = event.data.event.data;
        await step.run("record-failure", async () => {
          if (isStopped(error)) {
            await stopProjectJob(db, { jobId, projectId, usageKey });
            return;
          }
          const code = jobErrorCodeFrom(error);
          deps.logger.warn({ jobId, projectId, code }, "section regeneration failed");
          // The document is untouched, so the project itself hasn't failed.
          await failProjectJob(db, { jobId, projectId, usageKey, code, markProject: false });
        });
      },
    },
    async ({ event, step, runId, attempt }) => {
      const { projectId, ownerId, jobId, usageKey, sectionId } = event.data;

      const result = await step.run("generate", () =>
        guardedGeneration(async () => {
          if (await jobAlreadySucceeded(db, jobId)) return { citations: 0 };
          await assertProjectJobCanContinue(db, jobId, projectId);
          await markJobPhase(db, jobId, "revising", {
            run: { runId, eventId: event.id, attempt },
          });
          const { project, sources } = await loadGenerationContext(db, { projectId, ownerId });
          const current = sectionNodes(project.content, sectionId);
          if (!current) throw new JobFailure("generation_failed");
          // The owner may have renamed it in the editor; their heading stays.
          const headingNode = current[0];
          const heading =
            headingNode?.type === "heading"
              ? (headingNode.content ?? [])
                  .map((node) => (node.type === "text" ? node.text : ""))
                  .join("")
                  .trim()
              : "";
          const planned = project.outline.find((item) => item.id === sectionId);
          const section = {
            id: sectionId,
            heading: heading || planned?.heading || "Section",
            notes: planned?.notes ?? "",
          };

          const passages = await findEvidence(deps, {
            ownerId,
            question: `${section.heading}. ${section.notes}`,
            sources,
          });
          const generated = await generateSection(generationDeps(deps), {
            title: project.title,
            prompt: project.prompt,
            audience: project.settings.audience,
            length: project.settings.length,
            mode: project.mode,
            template: project.templateKey,
            outline: project.outline.length > 0 ? project.outline : [section],
            section,
            passages,
          });
          await recordGeneration(deps, {
            ownerId,
            jobId,
            purpose: "project-section",
            run: generated.run,
            metadata: {
              projectId,
              sectionId,
              regeneration: true,
              passages: passages.length,
              citations: generated.citations,
              uncovered: generated.uncovered,
            },
          });

          await assertProjectJobCanContinue(db, jobId, projectId);
          await saveSectionProposal(db, { projectId, jobId, sectionId, nodes: generated.nodes });
          return { citations: generated.citations };
        }),
      );

      await step.run("commit-usage", () => commitProjectUsage(db, usageKey));
      return result;
    },
  );
}
