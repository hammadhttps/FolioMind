"use client";

import type { ProjectBlock } from "@foliomind/contracts";
import { projectExtensions } from "@foliomind/pdf/editor";
import { EditorContent, useEditor } from "@tiptap/react";

/**
 * A section as read-only text, for comparing a proposal with the current version.
 * It goes through the editor's schema, never through raw HTML.
 */
export default function DocPreview({ nodes, label }: { nodes: ProjectBlock[]; label: string }) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    content: { type: "doc", content: nodes },
    extensions: projectExtensions,
    editorProps: { attributes: { class: "fm-doc outline-none", "aria-label": label } },
  });
  return <EditorContent editor={editor} />;
}
