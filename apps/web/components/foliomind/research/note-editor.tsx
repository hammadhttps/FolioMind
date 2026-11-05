"use client";

import { NOTE_MAX_CHARS, noteDocSchema, type NoteDoc } from "@foliomind/contracts";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Check, CircleAlert, Italic, List, ListOrdered } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { updateNoteAction } from "@/lib/workspaces/actions";

const AUTOSAVE_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * An auto-saved note (Section 28: rich text up to 20,000 characters). The editor
 * only offers the nodes `noteDocSchema` accepts, and pasted links and images are
 * dropped because no extension here can hold them.
 */
export default function NoteEditor({
  noteId,
  initial,
  label,
  preview = false,
}: {
  noteId: string;
  initial: NoteDoc;
  label: string;
  preview?: boolean;
}) {
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<unknown>(null);

  const save = useCallback(async () => {
    timer.current = null;
    const body = pending.current;
    if (body === null) return;
    pending.current = null;
    const parsed = noteDocSchema.safeParse(body);
    if (!parsed.success) {
      setState("error");
      setMessage(parsed.error.issues[0]?.message ?? "This note can't be saved as it is.");
      return;
    }
    setState("saving");
    const result = await updateNoteAction({ noteId, body: parsed.data }).catch(() => null);
    if (result?.ok) {
      setMessage(null);
      setState("saved");
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    // Keep the text queued, so the next edit or leaving the page tries again.
    pending.current = pending.current ?? parsed.data;
    setState("error");
    setMessage(result?.formError ?? "We couldn't save this note. Keep this page open and retry.");
  }, [noteId]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !preview,
    content: initial,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
        strike: false,
        underline: false,
      }),
      Placeholder.configure({ placeholder: "Write a note…" }),
    ],
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        class:
          "fm-note min-h-16 rounded-md px-2.5 py-2 text-sm/relaxed outline-none focus-visible:ring-3 focus-visible:ring-ring/70",
      },
    },
    onUpdate: ({ editor: current }) => {
      pending.current = current.getJSON();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
    },
  });

  // Leaving before the timer fires still saves.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current !== null) void save();
    },
    [save],
  );

  return (
    <div className="space-y-1.5">
      {preview ? null : <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
      <p
        className="flex min-h-4 items-center gap-1 text-xs text-muted-foreground"
        aria-live="polite"
      >
        {state === "saving" ? (
          <>
            <Spinner aria-hidden="true" className="size-3" />
            Saving…
          </>
        ) : state === "saved" ? (
          <>
            <Check aria-hidden="true" className="size-3 text-success" />
            Saved
          </>
        ) : state === "error" ? (
          <span className="flex items-center gap-1 text-error">
            <CircleAlert aria-hidden="true" className="size-3" />
            {message ?? `Use ${NOTE_MAX_CHARS.toLocaleString()} characters or fewer.`}
          </span>
        ) : null}
      </p>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const update = () => redraw((value) => value + 1);
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);
  if (!editor) return <div className="h-7" />;
  const items = [
    {
      name: "bold",
      label: "Bold",
      icon: Bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      name: "italic",
      label: "Italic",
      icon: Italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      name: "bulletList",
      label: "Bulleted list",
      icon: List,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      name: "orderedList",
      label: "Numbered list",
      icon: ListOrdered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
  ];
  return (
    <div role="toolbar" aria-label="Formatting" className="flex gap-0.5">
      {items.map(({ name, label, icon: Icon, run }) => (
        <Toggle
          key={name}
          size="sm"
          aria-label={label}
          pressed={editor.isActive(name)}
          onPressedChange={run}
          className="size-7 min-w-7 p-0"
        >
          <Icon aria-hidden="true" className="size-3.5" />
        </Toggle>
      ))}
    </div>
  );
}
