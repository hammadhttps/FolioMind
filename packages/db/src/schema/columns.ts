import { sql, type SQLWrapper } from "drizzle-orm";
import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

/*
 * Column helpers shared by the Section 12 tables: UUID keys defaulting to
 * gen_random_uuid(), timestamptz audit columns and a tsvector type for the
 * generated full-text columns.
 */

export const id = () => uuid("id").primaryKey().defaultRandom();

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const createdAt = () => timestamptz("created_at").notNull().defaultNow();

/** Drizzle sets it on every update it issues; raw SQL updates set it explicitly. */
export const updatedAt = () =>
  timestamptz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });

/** Read-only in application code: Postgres generates the value. */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** `column IN ('a', 'b')` for check constraints over checked text columns. */
export function inValues(column: SQLWrapper, values: readonly string[]) {
  return sql`${column} in (${sql.join(
    values.map((value) => sql.raw(`'${value.replaceAll("'", "''")}'`)),
    sql`, `,
  )})`;
}
