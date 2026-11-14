import { GLOBAL_SEARCH_LIMIT, type GlobalSearchResponse } from "@foliomind/contracts";
import type { Executor } from "@foliomind/db";
import { sql } from "drizzle-orm";
import type { Actor } from "../access";
import { likePattern } from "../keyset";

/*
 * Global search for the ⌘K dialog (blueprint Section 20 shared interactions):
 * permission-filtered results only. Books and publishers come from the public
 * catalog; My Library and Projects are the actor's own rows. Nothing private
 * of anyone else can match.
 */

export async function globalSearch(
  db: Executor,
  actor: Actor,
  term: string,
  limit: number = GLOBAL_SEARCH_LIMIT,
): Promise<GlobalSearchResponse> {
  const empty: GlobalSearchResponse = { books: [], publishers: [], library: [], projects: [] };
  if (actor.status !== "active") return empty;
  const pattern = likePattern(term);
  const [books, publishers, library, projects] = await Promise.all([
    db.execute<{ id: string; title: string; author: string }>(sql`
      select b.id, br.title, br.author
      from books b
      join book_revisions br on br.id = b.published_revision_id
      join publisher_profiles p on p.id = b.publisher_id
      where b.status = 'published' and b.deleted_at is null and br.status = 'approved'
        and p.status = 'approved'
        and (br.title ilike ${pattern} or br.author ilike ${pattern}
          or br.search_vector @@ websearch_to_tsquery('english', ${term}))
      order by (br.title ilike ${pattern}) desc, br.published_at desc, b.id
      limit ${limit}`),
    db.execute<{ slug: string; display_name: string }>(sql`
      select slug, display_name from publisher_profiles
      where status = 'approved' and display_name ilike ${pattern}
      order by display_name limit 3`),
    db.execute<{
      id: string;
      document_id: string | null;
      book_id: string | null;
      title: string;
      kind: "upload" | "imported" | "saved";
      readable: boolean;
    }>(sql`
      select li.id, li.document_id, li.book_id, coalesce(d.title, br.title) as title,
        case when li.book_id is not null then 'saved'
          when d.source_kind = 'url_import' then 'imported' else 'upload' end as kind,
        (d.current_version_id is not null) as readable
      from library_items li
      left join documents d on d.id = li.document_id
      left join books b on b.id = li.book_id
      left join book_revisions br on br.id = b.published_revision_id
      where li.user_id = ${actor.id}
        and (li.document_id is null or (d.status = 'active' and d.deleted_at is null))
        and (li.book_id is null or (b.status = 'published' and b.deleted_at is null))
        and coalesce(d.title, br.title) ilike ${pattern}
      order by li.created_at desc, li.id
      limit ${limit}`),
    db.execute<{ id: string; title: string }>(sql`
      select id, title from projects
      where owner_id = ${actor.id} and deleted_at is null and title ilike ${pattern}
      order by updated_at desc, id limit ${limit}`),
  ]);
  return {
    books: books.map((row) => ({
      id: row.id,
      title: row.title,
      author: row.author,
      href: `/books/${row.id}`,
    })),
    publishers: publishers.map((row) => ({
      slug: row.slug,
      name: row.display_name,
      href: `/publishers/${row.slug}`,
    })),
    library: library.map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      href: row.book_id
        ? `/books/${row.book_id}`
        : row.readable && row.document_id
          ? `/read/${row.document_id}`
          : `/dashboard/library?q=${encodeURIComponent(term)}`,
    })),
    projects: projects.map((row) => ({
      id: row.id,
      title: row.title,
      href: `/dashboard/projects/${row.id}`,
    })),
  };
}
