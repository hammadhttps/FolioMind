import type { RetrievalMetadata } from "../retrieval";
import { RETRIEVAL } from "../retrieval/config";

/*
 * Abstention (Section 8 step 7): when nothing retrieved is relevant, FolioMind
 * says so instead of inventing an answer, and without paying for a Gemini call.
 * No numeric confidence is ever shown.
 */

export function shouldAbstain(
  metadata: Pick<RetrievalMetadata, "selectedPassages" | "topScore" | "rerankFailed">,
  threshold: number = RETRIEVAL.abstainScore,
): boolean {
  if (metadata.selectedPassages === 0) return true;
  // Without rerank scores there's no signal here; the model reports the gap instead.
  if (metadata.rerankFailed || metadata.topScore === null) return false;
  return metadata.topScore < threshold;
}

export function abstentionMessage(scope: "document" | "workspace"): string {
  return scope === "workspace"
    ? "I couldn't find anything about this in the selected sources, so I won't guess. Try rephrasing the question, or add a source that covers it."
    : "I couldn't find anything about this in this document, so I won't guess. Try rephrasing the question, or add a source that covers it to a research workspace.";
}
