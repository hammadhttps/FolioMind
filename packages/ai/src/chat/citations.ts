import type { ExchangeCitation } from "@foliomind/domain";
import type { Passage } from "../retrieval/rerank";

/*
 * Section 8 step 6: every marker in an answer must point to a retrieved chunk.
 * Labels the model made up are removed, never saved, and the labels that remain
 * map to chunk IDs through the passages sent with that question, not through
 * anything in the answer's text.
 */

export interface LabeledPassage extends Passage {
  label: string;
}

/** S1…Sn, grouped by source and in page order, so the evidence reads like the documents. */
export function labelPassages(passages: readonly Passage[]): LabeledPassage[] {
  const sourceOrder = new Map<string, number>();
  for (const passage of passages) {
    if (!sourceOrder.has(passage.versionId)) sourceOrder.set(passage.versionId, sourceOrder.size);
  }
  return [...passages]
    .sort(
      (a, b) =>
        (sourceOrder.get(a.versionId) ?? 0) - (sourceOrder.get(b.versionId) ?? 0) ||
        a.pageStart - b.pageStart ||
        a.pageEnd - b.pageEnd,
    )
    .map((passage, index) => ({ ...passage, label: `S${index + 1}` }));
}

/** `[S1]`, `[S1, S2]` and `[S1; S2]`, and the odd spacing models sometimes add. */
const MARKER = /(\s*)\[\s*S\d+(?:\s*[,;]\s*S\d+)*\s*\]/g;
const MARKER_LABEL = /S\d+/g;
/**
 * Models sometimes write `(S1)` despite the instructions. It only counts when
 * every label in it was retrieved, because parentheses also appear in real text
 * such as "Table (S1)".
 */
const PARENTHESIZED = /\(\s*(S\d+(?:\s*[,;]\s*S\d+)*)\s*\)/g;

export interface MappedAnswer {
  body: string;
  citations: ExchangeCitation[];
  unknownLabels: string[];
}

export function mapCitations(text: string, passages: readonly LabeledPassage[]): MappedAnswer {
  const byLabel = new Map(passages.map((passage) => [passage.label, passage]));
  const used = new Map<string, ExchangeCitation>();
  const unknown = new Set<string>();

  const body = text
    .replace(PARENTHESIZED, (marker, labels: string) =>
      (labels.match(MARKER_LABEL) ?? []).every((label) => byLabel.has(label))
        ? `[${labels}]`
        : marker,
    )
    .replace(MARKER, (marker, space: string) => {
      const known = (marker.match(MARKER_LABEL) ?? []).filter((label) => {
        if (byLabel.has(label)) return true;
        unknown.add(label);
        return false;
      });
      for (const label of known) {
        const passage = byLabel.get(label);
        if (passage && !used.has(label)) {
          used.set(label, {
            label,
            chunkId: passage.chunkId,
            versionId: passage.versionId,
            pageStart: passage.pageStart,
            pageEnd: passage.pageEnd,
          });
        }
      }
      return known.length > 0 ? `${space}${known.map((label) => `[${label}]`).join("")}` : "";
    })
    .trim();
  return { body, citations: [...used.values()], unknownLabels: [...unknown] };
}

export interface Claim {
  id: number;
  text: string;
  labels: string[];
}

const SENTENCE_BREAK = /(?<=[.!?](?:\s*\[S\d+\])*)\s+(?!\[S\d+\])/;
const SINGLE_MARKER = /\[(S\d+)\]/g;

/** The answer's cited sentences, for the support check. Takes a body from `mapCitations`. */
export function extractClaims(body: string, limit = 12): Claim[] {
  const claims: Claim[] = [];
  for (const line of body.split(/\r?\n/)) {
    for (const sentence of line.split(SENTENCE_BREAK)) {
      const labels = [...new Set([...sentence.matchAll(SINGLE_MARKER)].map((match) => match[1]!))];
      if (labels.length === 0) continue;
      const text = sentence
        .replace(SINGLE_MARKER, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replace(/\s+/g, " ")
        .replace(/\s+([.,;:!?])/g, "$1")
        .trim();
      if (!text) continue;
      claims.push({ id: claims.length + 1, text, labels });
      if (claims.length >= limit) return claims;
    }
  }
  return claims;
}
