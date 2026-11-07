import {
  projectDocSchema,
  stampDraftedCitations,
  type CitationAttrs,
  type GeneratedSection,
  type ProjectBlock,
  type ProjectInline,
} from "@foliomind/contracts";
import { mapCitations, type LabeledPassage } from "../chat/citations";

/*
 * Gemini's section as editor nodes (Phase 8 skill). `[S1]` markers map to real
 * chunk IDs and page ranges through the passages sent with that request, labels
 * the model made up are dropped, and the result must pass the same schema every
 * save does. The model's text only ever becomes text nodes.
 */

export interface BuiltSection {
  nodes: ProjectBlock[];
  /** Citation chips placed; a research section with none has no evidence behind it. */
  citations: number;
  unknownLabels: string[];
}

/** Longest a generated table gets: wider or longer ones stop being readable in print. */
const MAX_TABLE_COLUMNS = 6;
const MAX_TABLE_ROWS = 30;

const TOKEN = /(\*\*|\*|\[S\d+\])/g;

interface InlineContext {
  byLabel: ReadonlyMap<string, LabeledPassage>;
  citations: { count: number };
  unknown: Set<string>;
  passages: readonly LabeledPassage[];
}

const citationAttrs = (passage: LabeledPassage): CitationAttrs => ({
  label: passage.label,
  chunkId: passage.chunkId,
  versionId: passage.versionId,
  pageStart: passage.pageStart,
  pageEnd: passage.pageEnd,
  draftHash: null,
});

/** **bold**, *italic* and [S1], which may overlap; everything else stays literal. */
function inlineNodes(raw: string, context: InlineContext): ProjectInline[] {
  const mapped = mapCitations(raw, context.passages);
  for (const label of mapped.unknownLabels) context.unknown.add(label);
  const nodes: ProjectInline[] = [];
  const tokens = mapped.body.split(TOKEN);
  let bold = false;
  let italic = false;
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    const marks = [
      ...(bold ? [{ type: "bold" as const }] : []),
      ...(italic ? [{ type: "italic" as const }] : []),
    ];
    nodes.push({ type: "text", text: buffer, ...(marks.length > 0 ? { marks } : {}) });
    buffer = "";
  };
  tokens.forEach((token, index) => {
    if (token === "**") {
      flush();
      bold = !bold;
      return;
    }
    if (token === "*") {
      const next = tokens[index + 1] ?? "";
      // An asterisk with space on the side it would attach to is literal, as in "2 * 3".
      const opens = !italic && next !== "" && !/^\s/.test(next);
      const closes = italic && buffer !== "" && !/\s$/.test(buffer);
      if (opens || closes) {
        flush();
        italic = !italic;
      } else {
        buffer += token;
      }
      return;
    }
    const label = /^\[(S\d+)\]$/.exec(token)?.[1];
    if (label) {
      const passage = context.byLabel.get(label);
      if (passage) {
        buffer = buffer.trimEnd();
        flush();
        nodes.push({ type: "citation", attrs: citationAttrs(passage) });
        context.citations.count += 1;
      }
      return;
    }
    buffer += token;
  });
  flush();
  return nodes;
}

const cleanLine = (text: string) => text.replace(/^\s*#{1,6}\s+/, "").trim();

const paragraph = (content: ProjectInline[]): ProjectBlock =>
  content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };

function cellNode(type: "tableCell" | "tableHeader", text: string, context: InlineContext) {
  return { type, content: [paragraph(inlineNodes(text, context))] };
}

export function buildSectionNodes(
  generated: GeneratedSection,
  input: { sectionId: string; heading: string; passages: readonly LabeledPassage[] },
): BuiltSection {
  const context: InlineContext = {
    byLabel: new Map(input.passages.map((passage) => [passage.label, passage])),
    citations: { count: 0 },
    unknown: new Set(),
    passages: input.passages,
  };
  const nodes: ProjectBlock[] = [
    {
      type: "heading",
      attrs: { level: 2, sectionId: input.sectionId },
      content: [{ type: "text", text: input.heading }],
    },
  ];

  for (const block of generated.blocks) {
    if (block.type === "paragraph") {
      for (const part of (block.text ?? "").split(/\n\s*\n/)) {
        const content = inlineNodes(cleanLine(part), context);
        if (content.length > 0) nodes.push(paragraph(content));
      }
    } else if (block.type === "subheading") {
      const text = cleanLine(block.text ?? "").replace(/\*+/g, "");
      if (text) {
        nodes.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text }] });
      }
    } else if (block.type === "bullets" || block.type === "numbered") {
      const items = (block.items ?? [])
        .map((item) => inlineNodes(cleanLine(item), context))
        .filter((content) => content.length > 0)
        .map((content) => ({ type: "listItem" as const, content: [paragraph(content)] }));
      if (items.length > 0) {
        nodes.push({
          type: block.type === "bullets" ? "bulletList" : "orderedList",
          content: items,
        });
      }
    } else if (block.type === "table") {
      const header = (block.header ?? []).slice(0, MAX_TABLE_COLUMNS);
      const rows = (block.rows ?? []).slice(0, MAX_TABLE_ROWS);
      const columns = header.length || Math.min(rows[0]?.length ?? 0, MAX_TABLE_COLUMNS);
      if (columns === 0 || rows.length === 0) continue;
      nodes.push({
        type: "table",
        content: [
          ...(header.length > 0
            ? [
                {
                  type: "tableRow" as const,
                  content: header.map((text) => cellNode("tableHeader", text, context)),
                },
              ]
            : []),
          // A row with too few cells would break the table, so every row is made to fit.
          ...rows.map((row) => ({
            type: "tableRow" as const,
            content: Array.from({ length: columns }, (_, column) =>
              cellNode("tableCell", row[column] ?? "", context),
            ),
          })),
        ],
      });
    }
  }

  // Same check as every save: nothing but the allowed tree leaves this function.
  const checked = projectDocSchema.parse({ type: "doc", content: nodes });
  return {
    nodes: checked.content.map(stampDraftedCitations),
    citations: context.citations.count,
    unknownLabels: [...context.unknown],
  };
}

/** The honest fill for a section the sources don't cover. FolioMind never guesses (Section 8). */
export function uncoveredSectionNodes(input: {
  sectionId: string;
  heading: string;
}): ProjectBlock[] {
  return [
    {
      type: "heading",
      attrs: { level: 2, sectionId: input.sectionId },
      content: [{ type: "text", text: input.heading }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Your sources don't appear to cover this section. Add a source that does and regenerate it, or write it yourself.",
          marks: [{ type: "italic" }],
        },
      ],
    },
  ];
}
