import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describeWithDatabase, testDb } from "./db";

describeWithDatabase("migrations from an empty database", () => {
  it("create every Section 12 table, both extensions and the seeded plans", async () => {
    const db = testDb();
    const [tables] = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from information_schema.tables where table_schema = 'public'`,
    );
    expect(tables?.count).toBe(48);

    const extensions = await db.execute<{ extname: string }>(
      sql`select extname from pg_extension where extname in ('vector', 'pg_trgm') order by extname`,
    );
    expect(extensions.map((row) => row.extname)).toEqual(["pg_trgm", "vector"]);

    const plans = await db.execute<{ code: string; stripe_price_id: string | null }>(
      sql`select code, stripe_price_id from plans order by code`,
    );
    expect(plans.map((row) => [row.code, row.stripe_price_id])).toEqual([
      ["free", null],
      ["pro", null],
    ]);
  });

  it("build the HNSW cosine index and both full-text GIN indexes", async () => {
    const indexes = await testDb().execute<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes
          where indexname in ('document_chunks_embedding_idx', 'document_chunks_search_idx', 'book_revisions_search_idx')
          order by indexname`,
    );
    expect(indexes.map((row) => row.indexname)).toEqual([
      "book_revisions_search_idx",
      "document_chunks_embedding_idx",
      "document_chunks_search_idx",
    ]);
    expect(indexes[1]?.indexdef).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
  });
});
