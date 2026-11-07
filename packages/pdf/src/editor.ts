import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";

/*
 * PDF Studio's node set (Phase 8 skill): the same extensions build the editor in
 * the browser and the HTML on the server, so an export can only contain what the
 * editor could. `projectDocSchema` in @foliomind/contracts holds the same list
 * and refuses anything else on save. No React and no DOM here: the browser and
 * Node both import this file.
 */

/**
 * Tiptap types these callbacks with the DOM's HTMLElement, and the packages that
 * compile this file for Node don't all have the DOM's types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AttributeSource = any;

const textAttr = (attribute: string, key: string) => ({
  default: null,
  parseHTML: (element: AttributeSource) => element.getAttribute(attribute),
  renderHTML: (attributes: Record<string, unknown>) => ({ [attribute]: attributes[key] }),
});

const pageAttr = (attribute: string, key: string) => ({
  default: 1,
  parseHTML: (element: AttributeSource) => Number(element.getAttribute(attribute) ?? 1),
  renderHTML: (attributes: Record<string, unknown>) => ({ [attribute]: attributes[key] }),
});

/** An inline chip for one citation; the text around it stays editable. */
export const Citation = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: textAttr("data-label", "label"),
      chunkId: textAttr("data-chunk", "chunkId"),
      versionId: textAttr("data-version", "versionId"),
      pageStart: pageAttr("data-page-start", "pageStart"),
      pageEnd: pageAttr("data-page-end", "pageEnd"),
      draftHash: textAttr("data-draft", "draftHash"),
    };
  },

  parseHTML() {
    return [{ tag: "span[data-citation]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        {
          "data-citation": "",
          class: "fm-cite",
          title: `Open page ${String(node.attrs.pageStart ?? "")} of this source`,
        },
        HTMLAttributes,
      ),
      `[${String(node.attrs.label ?? "")}]`,
    ];
  },

  renderText({ node }) {
    return `[${String(node.attrs.label ?? "")}]`;
  },
});

/** The section a heading starts, so one section can be found and rewritten later. */
export const SectionHeadings = Extension.create({
  name: "sectionHeadings",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          sectionId: {
            default: null,
            // Pressing Enter at the end of a heading doesn't start the same section twice.
            keepOnSplit: false,
            parseHTML: (element: AttributeSource) => element.getAttribute("data-section"),
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.sectionId ? { "data-section": attributes.sectionId } : {},
          },
        },
      },
    ];
  },
});

export const projectExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    blockquote: false,
    code: false,
    codeBlock: false,
    hardBreak: false,
    horizontalRule: false,
    link: false,
    strike: false,
    underline: false,
  }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  SectionHeadings,
  Citation,
];
