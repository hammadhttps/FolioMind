import { sql, type SQL } from "drizzle-orm";
import { decodeCursor, encodeCursor } from "./library";

/*
 * Keyset Previous/Next for tables (blueprint Section 24): an opaque cursor of
 * `{sortValue, id}`, `limit + 1` rows to know a page lies beyond, and the same
 * order walked in reverse for Previous. Rows must select `sort_value` (the sort
 * key as text) and `id`.
 */

export interface KeysetQuery {
  /** The sort expression, such as `b.updated_at` or `lower(br.title)`. */
  sortKey: SQL;
  /** The tiebreaker column, such as `b.id`. */
  idColumn: SQL;
  ascending: boolean;
  /** How the cursor's text value is compared: as a timestamp, a date or plain text. */
  valueType: "timestamptz" | "date" | "text";
  after?: string | undefined;
  before?: string | undefined;
  limit: number;
}

export interface KeysetPlan {
  /** Add to the WHERE clause when present. */
  filter: SQL | null;
  /** `order by` clause for the walk. */
  orderBy: SQL;
  backward: boolean;
  hasCursor: boolean;
}

export function keysetPlan(query: KeysetQuery): KeysetPlan {
  const backward = Boolean(query.before) && !query.after;
  const cursor = decodeCursor(query.after ?? query.before);
  const walkAscending = query.ascending !== backward;
  let filter: SQL | null = null;
  if (cursor) {
    const value =
      query.valueType === "timestamptz"
        ? sql`${cursor.v}::timestamptz`
        : query.valueType === "date"
          ? sql`${cursor.v}::date`
          : sql`${cursor.v}`;
    filter = walkAscending
      ? sql`(${query.sortKey}, ${query.idColumn}) > (${value}, ${cursor.id}::uuid)`
      : sql`(${query.sortKey}, ${query.idColumn}) < (${value}, ${cursor.id}::uuid)`;
  }
  const direction = walkAscending ? sql`asc` : sql`desc`;
  return {
    filter,
    orderBy: sql`${query.sortKey} ${direction}, ${query.idColumn} ${direction}`,
    backward,
    hasCursor: cursor !== null,
  };
}

export interface KeysetPage<T> {
  items: T[];
  nextCursor: string | null;
  prevCursor: string | null;
}

export function keysetPage<TRow extends { sort_value: string; id: string }, T>(
  rows: TRow[],
  plan: KeysetPlan,
  limit: number,
  map: (row: TRow) => T,
): KeysetPage<T> {
  const hasExtra = rows.length > limit;
  const page = rows.slice(0, limit);
  if (plan.backward) page.reverse();
  const first = page[0];
  const last = page.at(-1);
  const hasNext = plan.backward ? plan.hasCursor : hasExtra;
  const hasPrev = plan.backward ? hasExtra : plan.hasCursor;
  return {
    items: page.map(map),
    nextCursor: hasNext && last ? encodeCursor({ v: last.sort_value, id: last.id }) : null,
    prevCursor: hasPrev && first ? encodeCursor({ v: first.sort_value, id: first.id }) : null,
  };
}

/** `%term%` for ILIKE with the wildcard characters escaped. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
