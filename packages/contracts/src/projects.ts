import { z } from "zod";

/*
 * PDF Studio contracts (blueprint Sections 5, 6, 8, 11 and 28): project settings,
 * outlines, the allowed document tree, citations and proposals. The editor,
 * every save and the export all use the node set below, so nothing a client
 * sends can become markup, a script or a link.
 */

export const PROJECT_MODES = ["research", "general"] as const;
export type ProjectMode = (typeof PROJECT_MODES)[number];

/** PDF Studio's two launch templates (Section 8). */
export const PROJECT_TEMPLATES = ["academic-report", "study-notes"] as const;
export type ProjectTemplate = (typeof PROJECT_TEMPLATES)[number];

export const PROJECT_TEMPLATE_LABELS: Record<ProjectTemplate, string> = {
  "academic-report": "Academic Report",
  "study-notes": "Study Notes",
};

/** Recorded on each export (Section 12), so a later template change can't misdescribe it. */
export const PROJECT_TEMPLATE_REVISION = 1;

export const projectTemplateVersion = (template: ProjectTemplate): string =>
  `${template}@${PROJECT_TEMPLATE_REVISION}`;

export function templateFromVersion(version: string): ProjectTemplate {
  const key = version.split("@")[0];
  return (PROJECT_TEMPLATES as readonly string[]).includes(key ?? "")
    ? (key as ProjectTemplate)
    : "academic-report";
}

/** Section 5 row 10, plus `draft` for a project with no outline yet. */
export const PROJECT_STATUSES = [
  "draft",
  "outline",
  "drafting",
  "editing",
  "rendering",
  "complete",
  "failed",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  outline: "Outline",
  drafting: "Drafting",
  editing: "Editing",
  rendering: "Rendering",
  complete: "Complete",
  failed: "Failed",
};

/** The My Projects status filter (Section 24) and the statuses each option covers. */
export const PROJECT_STATUS_FILTERS = {
  draft: ["draft", "outline"],
  generating: ["drafting"],
  editing: ["editing"],
  rendering: ["rendering"],
  complete: ["complete"],
  failed: ["failed"],
} as const satisfies Record<string, readonly ProjectStatus[]>;

export const PROJECT_LENGTHS = ["short", "medium", "long"] as const;
export type ProjectLength = (typeof PROJECT_LENGTHS)[number];

/**
 * Provisional targets (Phase 8 skill): the model aims near these, and exact
 * lengths are never promised (Section 7). The section ranges stay within
 * Section 28's 3–15.
 */
export const PROJECT_LENGTH_TARGETS: Record<
  ProjectLength,
  { label: string; words: number; minSections: number; maxSections: number }
> = {
  short: { label: "Short", words: 800, minSections: 3, maxSections: 5 },
  medium: { label: "Medium", words: 2000, minSections: 5, maxSections: 8 },
  long: { label: "Long", words: 4000, minSections: 8, maxSections: 15 },
};

export const PROJECT_PAGE_SIZES = ["A4", "Letter"] as const;
export type ProjectPageSize = (typeof PROJECT_PAGE_SIZES)[number];

export const PROJECT_SOURCES_MAX = 5;
export const PROJECTS_PAGE_SIZE = 20;
export const PROJECT_PROMPT_MIN = 10;
export const PROJECT_PROMPT_MAX = 4000;
/** Bounds what a save can hold; Section 26's 5 MB HTML cap is checked at export. */
export const PROJECT_DOC_MAX_CHARS = 200_000;

/** Stored in `projects.settings`; anything missing or malformed reads as its default. */
export const projectSettingsSchema = z.object({
  audience: z.string().trim().max(120, "Use 120 characters or fewer.").catch(""),
  length: z.enum(PROJECT_LENGTHS).catch("medium"),
  pageSize: z.enum(PROJECT_PAGE_SIZES).catch("A4"),
  cover: z.boolean().catch(false),
  contents: z.boolean().catch(false),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export const readProjectSettings = (stored: unknown): ProjectSettings =>
  projectSettingsSchema.parse(typeof stored === "object" && stored !== null ? stored : {});

/* --- Forms (Section 28) ----------------------------------------------- */

const projectTitle = z
  .string()
  .trim()
  .min(1, "Enter a title.")
  .max(120, "Use 120 characters or fewer.");

/** Title 1–120 characters; mode; 1–5 sources in research mode. */
export const createProjectSchema = z
  .object({
    title: projectTitle,
    mode: z.enum(PROJECT_MODES),
    versionIds: z.array(z.uuid()).max(PROJECT_SOURCES_MAX, "Select up to 5 sources."),
  })
  .superRefine((value, context) => {
    if (value.mode === "research" && value.versionIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["versionIds"],
        message: "Select at least one source, or choose general writing.",
      });
    }
  });
export type CreateProjectValues = z.infer<typeof createProjectSchema>;

export const renameProjectSchema = z.object({ projectId: z.uuid(), title: projectTitle });

/** Prompt 10–4000 characters; audience up to 120; length; template. */
export const studioSettingsFormSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(PROJECT_PROMPT_MIN, "Describe the document in at least 10 characters.")
    .max(PROJECT_PROMPT_MAX, "Use 4,000 characters or fewer."),
  audience: z.string().trim().max(120, "Use 120 characters or fewer."),
  length: z.enum(PROJECT_LENGTHS),
  template: z.enum(PROJECT_TEMPLATES),
  pageSize: z.enum(PROJECT_PAGE_SIZES),
  cover: z.boolean(),
  contents: z.boolean(),
  mode: z.enum(PROJECT_MODES),
});
export type StudioSettingsValues = z.infer<typeof studioSettingsFormSchema>;

export const saveStudioSettingsSchema = studioSettingsFormSchema.extend({
  projectId: z.uuid(),
  /** A half-written prompt can still be saved; generating checks it. */
  prompt: z.string().trim().max(PROJECT_PROMPT_MAX, "Use 4,000 characters or fewer."),
});

/** Heading 1–150 characters; notes up to 500. */
export const outlineSectionSchema = z.object({
  id: z.uuid(),
  heading: z
    .string()
    .trim()
    .min(1, "Give this section a heading.")
    .max(150, "Use 150 characters or fewer."),
  notes: z.string().trim().max(500, "Use 500 characters or fewer."),
});
export type OutlineSection = z.infer<typeof outlineSectionSchema>;

/** 3–15 sections. */
export const outlineSchema = z
  .array(outlineSectionSchema)
  .min(3, "An outline needs at least 3 sections.")
  .max(15, "An outline can have up to 15 sections.")
  .refine(
    (sections) => new Set(sections.map((section) => section.id)).size === sections.length,
    "Each section needs its own ID.",
  );

export const saveOutlineSchema = z.object({ projectId: z.uuid(), outline: outlineSchema });

/** A stored outline that fails to parse reads as no outline. */
export function readOutline(stored: unknown): OutlineSection[] {
  const parsed = z.array(outlineSectionSchema).safeParse(stored);
  return parsed.success ? parsed.data : [];
}

export const projectSourceInputSchema = z.object({ projectId: z.uuid(), versionId: z.uuid() });

export const projectSourceQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(["all", "uploads", "saved", "imported"]).catch("all"),
  cursor: z.string().max(500).optional(),
});

/* --- Document tree ---------------------------------------------------- */

const MAX_DOC_DEPTH = 12;

const textNode = z.object({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z.array(z.object({ type: z.enum(["bold", "italic"]) })).optional(),
});

/** A citation chip: chunk, version and page range, plus the label shown in the text. */
export const citationAttrsSchema = z.object({
  label: z.string().min(1).max(12),
  chunkId: z.uuid().nullable(),
  versionId: z.uuid(),
  pageStart: z.number().int().min(1),
  pageEnd: z.number().int().min(1),
  /**
   * Fingerprint of the sentence block when FolioMind drafted it. Editing the
   * block changes its fingerprint, so the citation stops counting as verified
   * (Section 8) while staying in place.
   */
  draftHash: z.string().max(16).nullable(),
});
export type CitationAttrs = z.infer<typeof citationAttrsSchema>;

const citationNode = z.object({ type: z.literal("citation"), attrs: citationAttrsSchema });
const inlineNode = z.discriminatedUnion("type", [textNode, citationNode]);
export type ProjectInline = z.infer<typeof inlineNode>;

export type ParagraphNode = { type: "paragraph"; content?: ProjectInline[] };
export type HeadingNode = {
  type: "heading";
  attrs: { level: 1 | 2 | 3; sectionId?: string | null };
  content?: ProjectInline[];
};
export type ListItemNode = { type: "listItem"; content: ProjectBlock[] };
export type BulletListNode = { type: "bulletList"; content: ListItemNode[] };
export type OrderedListNode = {
  type: "orderedList";
  attrs?: { start?: number };
  content: ListItemNode[];
};
export type TableCellNode = {
  type: "tableCell" | "tableHeader";
  attrs?: { colspan?: number; rowspan?: number; colwidth?: number[] | null };
  content: ProjectBlock[];
};
export type TableRowNode = { type: "tableRow"; content: TableCellNode[] };
export type TableNode = { type: "table"; content: TableRowNode[] };
export type ProjectBlock =
  ParagraphNode | HeadingNode | BulletListNode | OrderedListNode | TableNode;
export type ProjectDoc = { type: "doc"; content: ProjectBlock[] };

const listItemNode: z.ZodType<ListItemNode> = z.lazy(() =>
  z.object({ type: z.literal("listItem"), content: z.array(blockNode).min(1) }),
);
const cellAttrs = z
  .object({
    colspan: z.number().int().min(1).max(20).optional(),
    rowspan: z.number().int().min(1).max(100).optional(),
    colwidth: z.array(z.number().int().nonnegative()).max(20).nullable().optional(),
  })
  .optional();
const tableCellNode: z.ZodType<TableCellNode> = z.lazy(() =>
  z.object({
    type: z.enum(["tableCell", "tableHeader"]),
    attrs: cellAttrs,
    content: z.array(blockNode).min(1),
  }),
) as z.ZodType<TableCellNode>;
const tableRowNode: z.ZodType<TableRowNode> = z.object({
  type: z.literal("tableRow"),
  content: z.array(tableCellNode).min(1),
});
const blockNode: z.ZodType<ProjectBlock> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("paragraph"), content: z.array(inlineNode).optional() }),
    z.object({
      type: z.literal("heading"),
      attrs: z.object({
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        sectionId: z.uuid().nullable().optional(),
      }),
      content: z.array(inlineNode).optional(),
    }),
    z.object({ type: z.literal("bulletList"), content: z.array(listItemNode).min(1) }),
    z.object({
      type: z.literal("orderedList"),
      attrs: z.object({ start: z.number().int().optional() }).optional(),
      content: z.array(listItemNode).min(1),
    }),
    z.object({ type: z.literal("table"), content: z.array(tableRowNode).min(1) }),
  ]),
) as z.ZodType<ProjectBlock>;

function depthOf(value: unknown, limit: number): number {
  if (limit < 0) return Infinity;
  if (Array.isArray(value)) return Math.max(0, ...value.map((item) => depthOf(item, limit)));
  if (typeof value === "object" && value !== null) {
    const { content } = value as { content?: unknown };
    return content === undefined ? 1 : 1 + depthOf(content, limit - 1);
  }
  return 0;
}

const walkNodes = (node: unknown, visit: (node: Record<string, unknown>) => void): void => {
  if (typeof node !== "object" || node === null) return;
  visit(node as Record<string, unknown>);
  const { content } = node as { content?: unknown };
  if (Array.isArray(content)) for (const child of content) walkNodes(child, visit);
};

/** The document's words, without citation chips. */
export function projectDocText(doc: { content?: unknown }): string {
  const parts: string[] = [];
  walkNodes(doc, (node) => {
    if (typeof node.text === "string") parts.push(node.text);
  });
  return parts.join(" ");
}

/**
 * The allowed tree, and nothing else (Phase 8 skill): unknown node and mark
 * types are refused, unknown attributes dropped, depth and length bounded.
 */
export const projectDocSchema: z.ZodType<ProjectDoc> = z
  .unknown()
  .refine((value) => depthOf(value, MAX_DOC_DEPTH) <= MAX_DOC_DEPTH, "This document is too nested.")
  .pipe(z.object({ type: z.literal("doc"), content: z.array(blockNode) }))
  .refine(
    (doc) => projectDocText(doc).length <= PROJECT_DOC_MAX_CHARS,
    "This document is too long to save.",
  );

export const EMPTY_PROJECT_DOC: ProjectDoc = { type: "doc", content: [] };

/** What's stored, or an empty document when nothing valid is. */
export function readProjectDoc(stored: unknown): ProjectDoc {
  const parsed = projectDocSchema.safeParse(stored);
  return parsed.success ? parsed.data : EMPTY_PROJECT_DOC;
}

export const docHasText = (doc: ProjectDoc): boolean => projectDocText(doc).trim().length > 0;

export const saveProjectContentSchema = z.object({
  projectId: z.uuid(),
  /** The `revision_counter` this edit started from (Section 11). */
  baseCounter: z.number().int().nonnegative(),
  content: projectDocSchema,
});

/* --- Sections inside a document --------------------------------------- */

export interface DocSection {
  sectionId: string;
  nodes: ProjectBlock[];
}

/** Splits at headings carrying a section ID; a section runs until the next one. */
export function splitDocSections(doc: ProjectDoc): {
  preamble: ProjectBlock[];
  sections: DocSection[];
} {
  const preamble: ProjectBlock[] = [];
  const sections: DocSection[] = [];
  for (const node of doc.content) {
    const sectionId = node.type === "heading" ? node.attrs.sectionId : null;
    if (sectionId) sections.push({ sectionId, nodes: [node] });
    else if (sections.length > 0) sections.at(-1)!.nodes.push(node);
    else preamble.push(node);
  }
  return { preamble, sections };
}

export const docSectionIds = (doc: ProjectDoc): string[] =>
  splitDocSections(doc).sections.map((section) => section.sectionId);

export function sectionNodes(doc: ProjectDoc, sectionId: string): ProjectBlock[] | null {
  return (
    splitDocSections(doc).sections.find((section) => section.sectionId === sectionId)?.nodes ?? null
  );
}

/**
 * Puts a section's nodes in the document: in place when it exists, otherwise
 * before the first later section of the outline, so a draft fills in order.
 */
export function upsertDocSection(
  doc: ProjectDoc,
  section: DocSection,
  outlineIds: readonly string[],
): ProjectDoc {
  const { preamble, sections } = splitDocSections(doc);
  const existing = sections.findIndex((item) => item.sectionId === section.sectionId);
  if (existing >= 0) {
    sections[existing] = section;
  } else {
    const order = outlineIds.indexOf(section.sectionId);
    const before = sections.findIndex((item) => {
      const position = outlineIds.indexOf(item.sectionId);
      return position > order;
    });
    if (order >= 0 && before >= 0) sections.splice(before, 0, section);
    else sections.push(section);
  }
  return { type: "doc", content: [...preamble, ...sections.flatMap((item) => item.nodes)] };
}

/* --- Citations -------------------------------------------------------- */

/** FNV-1a: a small, stable fingerprint that works the same in the browser and on the server. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Text of one paragraph or heading, without its chips, ignoring spacing differences. */
function blockFingerprint(content: readonly ProjectInline[] | undefined): string {
  const text = (content ?? [])
    .map((node) => (node.type === "text" ? node.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return fingerprint(text);
}

/** Stamps every citation with its block's fingerprint, as drafted. */
export function stampDraftedCitations<T extends ProjectBlock>(block: T): T {
  if (block.type === "paragraph" || block.type === "heading") {
    if (!block.content?.some((node) => node.type === "citation")) return block;
    const draftHash = blockFingerprint(block.content);
    return {
      ...block,
      content: block.content.map((node) =>
        node.type === "citation" ? { ...node, attrs: { ...node.attrs, draftHash } } : node,
      ),
    };
  }
  if (block.type === "bulletList" || block.type === "orderedList") {
    return {
      ...block,
      content: block.content.map((item) => ({
        ...item,
        content: item.content.map(stampDraftedCitations),
      })),
    };
  }
  if (block.type === "table") {
    return {
      ...block,
      content: block.content.map((row) => ({
        ...row,
        content: row.content.map((cell) => ({
          ...cell,
          content: cell.content.map(stampDraftedCitations),
        })),
      })),
    };
  }
  return block;
}

export interface DocCitation extends CitationAttrs {
  /** The sentence is as FolioMind drafted it; edited text is not counted as verified (Section 8). */
  verified: boolean;
}

/** Every citation in reading order, repeats included. */
export function collectCitations(doc: ProjectDoc): DocCitation[] {
  const found: DocCitation[] = [];
  walkNodes(doc, (node) => {
    if (node.type !== "paragraph" && node.type !== "heading") return;
    const content = (node as { content?: ProjectInline[] }).content;
    if (!content) return;
    const hash = blockFingerprint(content);
    for (const child of content) {
      if (child.type === "citation") {
        found.push({ ...child.attrs, verified: child.attrs.draftHash === hash });
      }
    }
  });
  return found;
}

const citationKey = (attrs: Pick<CitationAttrs, "versionId" | "pageStart" | "pageEnd">) =>
  `${attrs.versionId}:${attrs.pageStart}:${attrs.pageEnd}`;

/**
 * Numbers citations by first appearance: the same source and pages share one
 * number, which is the number in the export's References section.
 */
export function renumberCitations(doc: ProjectDoc): ProjectDoc {
  const numbers = new Map<string, number>();
  const relabel = <T>(node: T): T => {
    const value = node as unknown as {
      type?: string;
      attrs?: CitationAttrs;
      content?: unknown[];
    };
    if (value.type === "citation" && value.attrs) {
      const key = citationKey(value.attrs);
      if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
      return { ...node, attrs: { ...value.attrs, label: String(numbers.get(key)) } };
    }
    if (Array.isArray(value.content)) {
      return { ...node, content: value.content.map(relabel) };
    }
    return node;
  };
  return relabel(doc);
}

export interface DocReference {
  label: string;
  chunkId: string | null;
  versionId: string;
  pageStart: number;
  pageEnd: number;
  /** False once any sentence citing it has been edited. */
  verified: boolean;
}

/** One row per distinct source and page range; takes a document from `renumberCitations`. */
export function docReferences(doc: ProjectDoc): DocReference[] {
  const references = new Map<string, DocReference>();
  for (const citation of collectCitations(doc)) {
    const key = citationKey(citation);
    const known = references.get(key);
    if (known) known.verified &&= citation.verified;
    else {
      references.set(key, {
        label: citation.label,
        chunkId: citation.chunkId,
        versionId: citation.versionId,
        pageStart: citation.pageStart,
        pageEnd: citation.pageEnd,
        verified: citation.verified,
      });
    }
  }
  return [...references.values()];
}

/* --- Revisions, proposals and generated output ------------------------- */

export const revisionSourceSchema = z.object({ versionId: z.uuid(), title: z.string() });
export type RevisionSource = z.infer<typeof revisionSourceSchema>;

export const revisionCitationSchema = z.object({
  label: z.string(),
  chunkId: z.uuid().nullable(),
  versionId: z.uuid(),
  pageStart: z.number().int(),
  pageEnd: z.number().int(),
  verified: z.boolean(),
});

/** A regenerated section waiting beside the current text for the owner's decision (Section 5 row 11). */
export const sectionProposalSchema = z.object({
  sectionId: z.uuid(),
  jobId: z.uuid(),
  nodes: z.array(blockNode).min(1),
  createdAt: z.iso.datetime(),
});
export type SectionProposal = z.infer<typeof sectionProposalSchema>;

export function readProposals(stored: unknown): SectionProposal[] {
  const parsed = z.array(sectionProposalSchema).safeParse(stored);
  return parsed.success ? parsed.data : [];
}

/** Gemini's outline (Section 8). Trimmed to the form's limits after parsing. */
export const generatedOutlineSchema = z.object({
  sections: z.array(z.object({ heading: z.string(), notes: z.string() })),
});
export type GeneratedOutline = z.infer<typeof generatedOutlineSchema>;

/**
 * Gemini's section: flat blocks because they're the shape models fill most
 * reliably. `text`, `items` and table cells hold **bold**, *italic* and [S1]
 * markers; everything else stays literal text.
 */
export const generatedSectionSchema = z.object({
  blocks: z.array(
    z.object({
      type: z.enum(["paragraph", "subheading", "bullets", "numbered", "table"]),
      text: z.string().optional(),
      items: z.array(z.string()).optional(),
      header: z.array(z.string()).optional(),
      rows: z.array(z.array(z.string())).optional(),
    }),
  ),
});
export type GeneratedSection = z.infer<typeof generatedSectionSchema>;

/* --- API -------------------------------------------------------------- */

/** `POST /api/projects/:id/generate`. */
export const projectGenerateRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("outline") }),
  z.object({
    kind: z.literal("draft"),
    /** The owner confirmed replacing a finished draft (Section 20 #11). */
    replace: z.boolean().default(false),
  }),
  z.object({ kind: z.literal("section"), sectionId: z.uuid() }),
]);
export type ProjectGenerateRequest = z.infer<typeof projectGenerateRequestSchema>;

/** `POST /api/projects/:id/exports`: one exact, immutable revision. */
export const projectExportRequestSchema = z.object({ revisionId: z.uuid() });

export const PROJECT_REFUSALS = {
  account_inactive: "Your account can't do that right now.",
  not_found: "This project isn't available anymore.",
  archived: "This project is archived. Restore it to keep working.",
  busy: "This project is already working on something. Wait for it to finish, or stop it first.",
  no_prompt: "Describe the document in at least 10 characters first.",
  no_outline: "Generate and approve an outline first.",
  no_sources: "Add at least one source, or switch to general writing.",
  source_unavailable:
    "A source in this project isn't available anymore. Remove it or pick another, then try again.",
  replace_required: "Replacing your draft needs your confirmation.",
  section_missing: "That section isn't in the document anymore.",
  no_generation: "AI generation isn't set up here yet.",
  quota_projects: "You've used all your generated projects for this month.",
  quota_regenerations: "You've used all your regenerations for this month.",
  quota_reexports: "You've used all your re-exports for this month.",
  no_revision: "That revision isn't available.",
  empty_document: "Write something first. There's nothing to export yet.",
  storage_limit: "This would go over your storage allowance. Delete something or upgrade.",
} as const;
export type ProjectRefusal = keyof typeof PROJECT_REFUSALS;

export const projectAllowanceSchema = z.object({
  planCode: z.string(),
  projects: z.object({ used: z.number(), limit: z.number() }),
  regenerations: z.object({ used: z.number(), limit: z.number() }),
  reexports: z.object({ used: z.number(), limit: z.number() }),
  resetsAt: z.iso.datetime(),
});
export type ProjectAllowance = z.infer<typeof projectAllowanceSchema>;

export const EXPORT_STATUSES = ["queued", "rendering", "ready", "failed"] as const;

export const projectExportViewSchema = z.object({
  id: z.uuid(),
  revisionId: z.uuid(),
  revisionNo: z.number().int(),
  template: z.enum(PROJECT_TEMPLATES),
  status: z.enum(EXPORT_STATUSES),
  pageCount: z.number().int().nullable(),
  bytes: z.number().nullable(),
  createdAt: z.iso.datetime(),
  errorMessage: z.string().nullable(),
});
export type ProjectExportView = z.infer<typeof projectExportViewSchema>;

export const projectRevisionViewSchema = z.object({
  id: z.uuid(),
  revisionNo: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type ProjectRevisionView = z.infer<typeof projectRevisionViewSchema>;
