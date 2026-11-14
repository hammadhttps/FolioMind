import { describe, expect, it } from "vitest";
import { suspendUserSchema } from "./admin";
import {
  applicationDecisionSchema,
  bookDraftSchema,
  bookSubmissionSchema,
  moderationDecisionSchema,
  publisherApplicationSchema,
  reportFormSchema,
  takedownSchema,
} from "./publishing";
import {
  adminSearchParamsSchema,
  catalogSearchParamsSchema,
  moderationSearchParamsSchema,
  publisherBooksSearchParamsSchema,
} from "./search-params";

const ID = "00000000-0000-4000-8000-000000000001";
const BIO = "An independent press publishing field guides and essays about rivers and places.";

describe("publisher application (Section 28)", () => {
  it("normalizes the address and requires the rights statement", () => {
    const parsed = publisherApplicationSchema.parse({
      displayName: " Fieldnotes Press ",
      slug: " Fieldnotes-Press ",
      bio: BIO,
      website: "",
      rightsConfirmed: true,
    });
    expect(parsed).toMatchObject({ displayName: "Fieldnotes Press", slug: "fieldnotes-press" });
    expect(parsed.website).toBeUndefined();
    const refused = publisherApplicationSchema.safeParse({
      displayName: "X Press",
      slug: "-bad_slug",
      bio: "Too short",
      website: "ftp://example.com",
      rightsConfirmed: false,
    });
    expect(refused.success).toBe(false);
    const fields = refused.error?.issues.map((issue) => issue.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["slug", "bio", "website", "rightsConfirmed"]));
  });
});

describe("book drafts and submissions", () => {
  const draft = {
    bookId: ID,
    title: "Field Notes",
    author: "",
    description: "",
    language: "en",
    categories: [],
    licenseStatement: "",
  };

  it("saves an unfinished draft but refuses to submit it", () => {
    expect(bookDraftSchema.safeParse(draft).success).toBe(true);
    const submitted = bookSubmissionSchema.safeParse({ ...draft, rightsConfirmed: true });
    expect(submitted.success).toBe(false);
    expect(submitted.error?.issues.map((issue) => issue.path[0])).toEqual(
      expect.arrayContaining(["author", "description", "categories", "licenseStatement"]),
    );
  });

  it("limits categories to three and languages to ISO 639-1 codes on the list", () => {
    expect(bookDraftSchema.safeParse({ ...draft, categories: ["a", "b", "c", "d"] }).success).toBe(
      false,
    );
    expect(bookDraftSchema.safeParse({ ...draft, language: "xx" }).success).toBe(false);
    expect(bookDraftSchema.safeParse({ ...draft, language: "es" }).success).toBe(true);
  });
});

describe("reports and decisions", () => {
  it("needs details only for 'other', and at least 10 characters when given", () => {
    expect(reportFormSchema.safeParse({ bookId: ID, reason: "copyright" }).success).toBe(true);
    expect(reportFormSchema.safeParse({ bookId: ID, reason: "other" }).success).toBe(false);
    expect(
      reportFormSchema.safeParse({ bookId: ID, reason: "copyright", details: "short" }).success,
    ).toBe(false);
  });

  it("requires a reason for reject and takedown, never for approve", () => {
    expect(moderationDecisionSchema.safeParse({ revisionId: ID, action: "approve" }).success).toBe(
      true,
    );
    expect(moderationDecisionSchema.safeParse({ revisionId: ID, action: "reject" }).success).toBe(
      false,
    );
    expect(
      moderationDecisionSchema.safeParse({ revisionId: ID, action: "approve", reason: "ok" })
        .success,
    ).toBe(false);
    expect(takedownSchema.safeParse({ bookId: ID, action: "takedown" }).success).toBe(false);
    expect(
      applicationDecisionSchema.safeParse({
        profileId: ID,
        action: "reject",
        reason: "Describe the rights you hold.",
      }).success,
    ).toBe(true);
  });

  it("checks a suspension's reason and optional date", () => {
    expect(suspendUserSchema.safeParse({ userId: ID, reason: "Spam" }).success).toBe(false);
    expect(
      suspendUserSchema.parse({ userId: ID, reason: "Repeated spam reports", endsOn: "" }).endsOn,
    ).toBeUndefined();
    expect(
      suspendUserSchema.safeParse({ userId: ID, reason: "Repeated spam reports", endsOn: "soon" })
        .success,
    ).toBe(false);
  });
});

describe("Phase 9 URL params fall back to defaults (Section 24)", () => {
  it("parses catalog, publisher, moderation and admin params safely", () => {
    expect(catalogSearchParamsSchema.parse({ publisher: "Bad Slug!", page: "0" })).toMatchObject({
      publisher: undefined,
      page: 1,
    });
    expect(publisherBooksSearchParamsSchema.parse({ sort: "relevance" }).sort).toBe("newest");
    expect(moderationSearchParamsSchema.parse({ type: "x", review: "nope" })).toMatchObject({
      type: "submission",
      status: "open",
      review: undefined,
    });
    expect(adminSearchParamsSchema.parse({ tab: "users", from: "2026-13-40" })).toMatchObject({
      tab: "users",
      from: undefined,
    });
  });
});
