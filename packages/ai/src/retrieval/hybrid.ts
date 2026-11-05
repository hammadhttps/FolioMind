import type { Executor } from "@foliomind/db";
import { sql } from "drizzle-orm";
import { RETRIEVAL } from "./config";

/*
 * Hybrid search (Section 8 step 3): vector and full-text candidates inside the
 * authorized versions, merged with reciprocal rank fusion. Every statement here
 * is filtered to the version IDs it is given; callers get those from
 * `resolveSources`, never from a request.
 *
 * The vector search is exact, not HNSW. An approximate scan filtered to a few
 * versions can return too few rows when other users' chunks crowd the index,
 * and one question searches at most five documents of 150 pages each, which
 * exact cosine handles easily (Section 12 allows this for small sets).
 */

export interface RankedHit {
  chunkId: string;
  versionId: string;
}

export interface SearchInput {
  versionIds: readonly string[];
  /** Null when the query embedding failed: search continues on full text alone. */
  embedding: readonly number[] | null;
  queryText: string;
  /** Chunks covering the selected text's page join the candidates. */
  focusPage?: number | undefined;
}

export interface SearchResult {
  vector: RankedHit[];
  text: RankedHit[];
  focus: RankedHit[];
  merged: { chunkId: string; versionId: string; score: number }[];
}

const versionList = (versionIds: readonly string[]) =>
  sql.join(
    versionIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/**
 * Keeps `limit` hits overall, with a floor per source so one long document can't
 * crowd the others out of a comparison. One source gets a plain top `limit`.
 */
export function pickWithSourceFloor<T extends RankedHit>(
  ranked: readonly T[],
  versionIds: readonly string[],
  limit: number,
): T[] {
  if (versionIds.length <= 1) return ranked.slice(0, limit);
  const floor = Math.floor(limit / (2 * versionIds.length));
  const taken = new Set<string>();
  const counts = new Map<string, number>();
  for (const hit of ranked) {
    const count = counts.get(hit.versionId) ?? 0;
    if (count < floor) {
      counts.set(hit.versionId, count + 1);
      taken.add(hit.chunkId);
    }
  }
  for (const hit of ranked) {
    if (taken.size >= limit) break;
    taken.add(hit.chunkId);
  }
  return ranked.filter((hit) => taken.has(hit.chunkId));
}

/** Reciprocal rank fusion: a chunk's score is the sum of 1 / (k + rank) across lists. */
export function rrfMerge(
  lists: readonly (readonly RankedHit[])[],
  k: number = RETRIEVAL.rrfK,
): { chunkId: string; versionId: string; score: number }[] {
  const merged = new Map<string, { chunkId: string; versionId: string; score: number }>();
  for (const list of lists) {
    list.forEach((hit, index) => {
      const score = 1 / (k + index + 1);
      const existing = merged.get(hit.chunkId);
      if (existing) existing.score += score;
      else merged.set(hit.chunkId, { ...hit, score });
    });
  }
  return [...merged.values()].sort(
    (a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId),
  );
}

async function vectorSearch(
  db: Executor,
  versionIds: readonly string[],
  embedding: readonly number[],
  limit: number,
): Promise<RankedHit[]> {
  const vector = `[${embedding.join(",")}]`;
  const rows = await db.execute<{ id: string; document_version_id: string }>(sql`
    select id, document_version_id
    from (
      select
        c.id,
        c.document_version_id,
        c.embedding <=> ${vector}::vector as distance,
        row_number() over (
          partition by c.document_version_id
          order by c.embedding <=> ${vector}::vector
        ) as rank_in_source
      from document_chunks c
      where c.document_version_id in (${versionList(versionIds)})
        and c.embedding is not null
    ) ranked
    where rank_in_source <= ${limit}
    order by distance, id`);
  return rows.map((row) => ({ chunkId: row.id, versionId: row.document_version_id }));
}

/**
 * `websearch_to_tsquery` joins words with AND, which rarely matches a question
 * written in plain language, so its terms are switched to OR and ranking favours
 * chunks that hold more of them. Quoted phrases and exclusions still work.
 */
async function textSearch(
  db: Executor,
  versionIds: readonly string[],
  queryText: string,
  limit: number,
): Promise<RankedHit[]> {
  const rows = await db.execute<{ id: string; document_version_id: string }>(sql`
    with query as (
      select replace(websearch_to_tsquery('english', ${queryText})::text, ' & ', ' | ')::tsquery as q
    )
    select id, document_version_id
    from (
      select
        c.id,
        c.document_version_id,
        ts_rank_cd(c.search_vector, query.q) as rank,
        row_number() over (
          partition by c.document_version_id
          order by ts_rank_cd(c.search_vector, query.q) desc, c.id
        ) as rank_in_source
      from document_chunks c, query
      where c.document_version_id in (${versionList(versionIds)})
        and c.search_vector @@ query.q
    ) ranked
    where rank_in_source <= ${limit}
    order by rank desc, id`);
  return rows.map((row) => ({ chunkId: row.id, versionId: row.document_version_id }));
}

async function focusSearch(
  db: Executor,
  versionIds: readonly string[],
  page: number,
): Promise<RankedHit[]> {
  const rows = await db.execute<{ id: string; document_version_id: string }>(sql`
    select id, document_version_id
    from document_chunks
    where document_version_id in (${versionList(versionIds)})
      and page_start <= ${page} and page_end >= ${page}
    order by chunk_index
    limit 3`);
  return rows.map((row) => ({ chunkId: row.id, versionId: row.document_version_id }));
}

export async function hybridSearch(db: Executor, input: SearchInput): Promise<SearchResult> {
  if (input.versionIds.length === 0) return { vector: [], text: [], focus: [], merged: [] };
  const [vector, text, focus] = await Promise.all([
    input.embedding
      ? vectorSearch(db, input.versionIds, input.embedding, RETRIEVAL.vectorCandidates)
      : Promise.resolve<RankedHit[]>([]),
    textSearch(db, input.versionIds, input.queryText, RETRIEVAL.textCandidates),
    input.focusPage ? focusSearch(db, input.versionIds, input.focusPage) : Promise.resolve([]),
  ]);
  const vectorHits = pickWithSourceFloor(vector, input.versionIds, RETRIEVAL.vectorCandidates);
  const textHits = pickWithSourceFloor(text, input.versionIds, RETRIEVAL.textCandidates);
  return {
    vector: vectorHits,
    text: textHits,
    focus,
    merged: rrfMerge([vectorHits, textHits, focus]),
  };
}
