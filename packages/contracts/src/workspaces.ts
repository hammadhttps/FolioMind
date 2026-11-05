import { z } from "zod";
import { WORKSPACE_SOURCES_HARD_MAX } from "./chat";

/*
 * Research Workspace forms and notes (blueprint Sections 11, 24 and 28). Notes
 * are rich text stored as controlled JSON: only the node and mark types below
 * are accepted, so nothing a client sends can become markup or a link.
 */

export const WORKSPACE_PAGE_SIZE = 12;
export const SOURCE_PICKER_PAGE_SIZE = 20;
export const NOTE_MAX_CHARS = 20_000;

/** Section 28: name 1–80 characters, description up to 280. */
export const workspaceFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80, "Use 80 characters or fewer."),
  description: z.string().trim().max(280, "Use 280 characters or fewer.").optional(),
});
export type WorkspaceFormValues = z.infer<typeof workspaceFormSchema>;

export const workspaceUpdateSchema = workspaceFormSchema.extend({ workspaceId: z.uuid() });

export const workspaceSourceInputSchema = z.object({
  workspaceId: z.uuid(),
  versionId: z.uuid(),
});

export const SOURCE_PICKER_TYPES = ["all", "uploads", "saved", "imported"] as const;

export const sourcePickerQuerySchema = z.object({
  workspaceId: z.uuid(),
  q: z.string().trim().max(100).optional(),
  type: z.enum(SOURCE_PICKER_TYPES).catch("all"),
  cursor: z.string().max(500).optional(),
});

export const createProjectFromWorkspaceSchema = z.object({
  workspaceId: z.uuid(),
  versionIds: z
    .array(z.uuid())
    .min(1, "Select at least one source.")
    .max(WORKSPACE_SOURCES_HARD_MAX),
});

/* --- Note documents --------------------------------------------------- */

const MAX_NOTE_DEPTH = 12;

const textNode = z.object({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z.array(z.object({ type: z.enum(["bold", "italic"]) })).optional(),
});
const inlineNode = z.union([textNode, z.object({ type: z.literal("hardBreak") })]);

export type NoteNode =
  | { type: "paragraph"; content?: z.infer<typeof inlineNode>[] }
  | { type: "heading"; attrs: { level: 2 | 3 }; content?: z.infer<typeof inlineNode>[] }
  | { type: "blockquote"; content: NoteNode[] }
  | { type: "bulletList"; content: NoteListItem[] }
  | { type: "orderedList"; attrs?: { start?: number }; content: NoteListItem[] };
export type NoteListItem = { type: "listItem"; content: NoteNode[] };
export type NoteDoc = { type: "doc"; content: NoteNode[] };

const listItem: z.ZodType<NoteListItem> = z.lazy(() =>
  z.object({ type: z.literal("listItem"), content: z.array(blockNode).min(1) }),
);
const blockNode: z.ZodType<NoteNode> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("paragraph"), content: z.array(inlineNode).optional() }),
    z.object({
      type: z.literal("heading"),
      attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }),
      content: z.array(inlineNode).optional(),
    }),
    z.object({ type: z.literal("blockquote"), content: z.array(blockNode).min(1) }),
    z.object({ type: z.literal("bulletList"), content: z.array(listItem).min(1) }),
    z.object({
      type: z.literal("orderedList"),
      attrs: z.object({ start: z.number().int().optional() }).optional(),
      content: z.array(listItem).min(1),
    }),
  ]),
);

function depthOf(value: unknown, limit: number): number {
  if (limit < 0) return Infinity;
  if (Array.isArray(value)) return Math.max(0, ...value.map((item) => depthOf(item, limit)));
  if (typeof value === "object" && value !== null) {
    const { content } = value as { content?: unknown };
    return content === undefined ? 1 : 1 + depthOf(content, limit - 1);
  }
  return 0;
}

/** The note's text, for counting and for labels. */
export function noteDocText(doc: { content?: unknown }): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node !== "object" || node === null) return;
    const { text, content } = node as { text?: unknown; content?: unknown };
    if (typeof text === "string") parts.push(text);
    if (Array.isArray(content)) content.forEach(walk);
  };
  walk(doc);
  return parts.join(" ");
}

/** Allowed nodes only, bounded depth, up to 20,000 characters (Section 28). */
export const noteDocSchema: z.ZodType<NoteDoc> = z
  .unknown()
  .refine((value) => depthOf(value, MAX_NOTE_DEPTH) <= MAX_NOTE_DEPTH, "This note is too nested.")
  .pipe(z.object({ type: z.literal("doc"), content: z.array(blockNode) }))
  .refine((doc) => noteDocText(doc).length <= NOTE_MAX_CHARS, "Use 20,000 characters or fewer.");

export const updateNoteSchema = z.object({ noteId: z.uuid(), body: noteDocSchema });
export const saveAnswerNoteSchema = z.object({ workspaceId: z.uuid(), messageId: z.uuid() });

/** A source chip on a saved note; stays useful after the conversation is deleted. */
export const citationRefSchema = z.object({
  label: z.string(),
  versionId: z.uuid().nullable(),
  title: z.string(),
  pageStart: z.number().int(),
  pageEnd: z.number().int(),
});
export type CitationRef = z.infer<typeof citationRefSchema>;

const inlineFrom = (
  text: string,
): NonNullable<Extract<NoteNode, { type: "paragraph" }>["content"]> => {
  const nodes: NonNullable<Extract<NoteNode, { type: "paragraph" }>["content"]> = [];
  // **bold** and *italic*; everything else stays literal text.
  for (const part of text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g)) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      nodes.push({ type: "text", text: part.slice(2, -2), marks: [{ type: "bold" }] });
    } else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      nodes.push({ type: "text", text: part.slice(1, -1), marks: [{ type: "italic" }] });
    } else {
      nodes.push({ type: "text", text: part });
    }
  }
  return nodes;
};

/**
 * A saved answer as a note: paragraphs and simple lists, with its [S1] labels
 * kept as text so they match the note's source chips.
 */
export function answerToNoteDoc(body: string): NoteDoc {
  const content: NoteNode[] = [];
  const open: { list: { kind: "bulletList" | "orderedList"; items: NoteListItem[] } | null } = {
    list: null,
  };
  const flush = () => {
    if (open.list) content.push({ type: open.list.kind, content: open.list.items });
    open.list = null;
  };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const bullet = /^[-*+]\s+(.+)$/.exec(line)?.[1];
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line)?.[1];
    const item = bullet ?? ordered;
    if (item) {
      const kind = bullet ? "bulletList" : "orderedList";
      if (open.list?.kind !== kind) {
        flush();
        open.list = { kind, items: [] };
      }
      open.list.items.push({
        type: "listItem",
        content: [{ type: "paragraph", content: inlineFrom(item) }],
      });
      continue;
    }
    flush();
    content.push({ type: "paragraph", content: inlineFrom(line.replace(/^#{1,6}\s+/, "")) });
  }
  flush();
  return { type: "doc", content };
}

export const EMPTY_NOTE_DOC: NoteDoc = { type: "doc", content: [{ type: "paragraph" }] };

/** PDF Studio's two launch templates (Section 8). */
export const PROJECT_TEMPLATES = ["academic-report", "study-notes"] as const;
