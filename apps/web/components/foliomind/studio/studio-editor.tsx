"use client";

import {
  docReferences,
  projectDocSchema,
  type ProjectDoc,
  type RevisionSource,
} from "@foliomind/contracts";
import { projectExtensions } from "@foliomind/pdf/editor";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  Bold,
  Check,
  CircleAlert,
  Columns2,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Rows2,
  Save,
  Table as TableIcon,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import {
  resolveConflictAction,
  saveContentAction,
  saveRevisionAction,
  type SavedRevision,
} from "@/lib/projects/actions";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { useOpenCitation } from "../chat/use-open-citation";
import { Paper } from "../paper";

const AUTOSAVE_MS = 1200;

type SaveState = "saved" | "dirty" | "saving" | "error";

/** A document with no blocks isn't valid to the editor; it needs one empty paragraph. */
const toEditorDoc = (doc: ProjectDoc): ProjectDoc =>
  doc.content.length > 0 ? doc : { type: "doc", content: [{ type: "paragraph" }] };

export interface EditorHandle {
  /** Saves anything pending now. False when it couldn't be saved. */
  flush: () => Promise<boolean>;
  /** Puts in a document the server just wrote, such as an accepted proposal. */
  replace: (doc: ProjectDoc, counter: number) => void;
  saveRevision: () => Promise<SavedRevision | null>;
}

/**
 * The warm-paper editor (Section 20 #11). It offers only the nodes the schema
 * accepts, saves 1.2 seconds after typing against `revision_counter`, and turns
 * a conflict into a choice rather than an overwrite (Section 11). Clicking a
 * citation opens its source in the Reader.
 */
export default function StudioEditor({
  projectId,
  doc,
  counter,
  counterRef,
  readOnly,
  sources,
  handleRef,
  onChange,
  onSaved,
  onRevisionSaved,
  preview = false,
}: {
  projectId: string;
  /** The server's document, or null when the poll says it hasn't changed. */
  doc: ProjectDoc | null;
  counter: number;
  counterRef: MutableRefObject<number>;
  readOnly: boolean;
  sources: readonly RevisionSource[];
  handleRef: MutableRefObject<EditorHandle | null>;
  onChange?: (doc: ProjectDoc) => void;
  onSaved?: () => void;
  onRevisionSaved?: () => void;
  preview?: boolean;
}) {
  const [state, setState] = useState<SaveState>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [savingRevision, setSavingRevision] = useState(false);
  const dirty = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const openCitation = useOpenCitation();

  const save = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // One save at a time: a later edit waits, then saves on top of the new counter.
    if (saving.current) await saving.current;
    const editor = editorRef.current;
    if (!editor || !dirty.current || preview) return !dirty.current;

    const parsed = projectDocSchema.safeParse(editor.getJSON());
    if (!parsed.success) {
      setState("error");
      setMessage(parsed.error.issues[0]?.message ?? "This text can't be saved as it is.");
      return false;
    }
    dirty.current = false;
    setState("saving");
    const run = (async () => {
      const result = await saveContentAction({
        projectId,
        baseCounter: counterRef.current,
        content: parsed.data,
      }).catch(() => null);
      if (result?.ok) {
        counterRef.current = result.data.counter;
        setMessage(null);
        setState(dirty.current ? "dirty" : "saved");
        onSaved?.();
        return true;
      }
      dirty.current = true;
      setState("error");
      if (result?.code === "conflict") {
        setConflict(true);
        return false;
      }
      if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
      setMessage(
        (result && "formError" in result ? result.formError : undefined) ??
          "We couldn't save your changes. Keep this page open and we'll try again.",
      );
      return false;
    })();
    saving.current = run;
    const saved = await run;
    saving.current = null;
    return saved;
  }, [counterRef, onSaved, preview, projectId]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    content: toEditorDoc(doc ?? { type: "doc", content: [] }),
    extensions: [
      ...projectExtensions,
      Placeholder.configure({
        placeholder: "Your draft appears here. Approve an outline, or start writing.",
      }),
    ],
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Document text",
        class: "fm-doc min-h-[420px] outline-none md:min-h-[600px]",
      },
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name !== "citation") return false;
        void openCitation({
          versionId: (node.attrs.versionId as string | null) ?? null,
          pageStart: Number(node.attrs.pageStart ?? 1),
        });
        return true;
      },
    },
    onUpdate: ({ editor: current, transaction }) => {
      // Tiptap also emits this for things that change nothing, such as `setEditable`.
      if (!transaction.docChanged) return;
      dirty.current = true;
      setState("dirty");
      const parsed = projectDocSchema.safeParse(current.getJSON());
      if (parsed.success) onChange?.(parsed.data);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  const replace = useCallback(
    (next: ProjectDoc, nextCounter: number) => {
      counterRef.current = nextCounter;
      dirty.current = false;
      if (timer.current) clearTimeout(timer.current);
      setState("saved");
      setMessage(null);
      editorRef.current?.commands.setContent(toEditorDoc(next), { emitUpdate: false });
      onChange?.(next);
    },
    [counterRef, onChange],
  );

  // A newer document from the server (the draft filling in, another tab) when nothing is unsaved.
  useEffect(() => {
    if (!editor || !doc) return;
    if (counter <= counterRef.current || dirty.current) return;
    replace(doc, counter);
  }, [editor, doc, counter, counterRef, replace]);

  const saveRevision = useCallback(async (): Promise<SavedRevision | null> => {
    if (!(await save())) {
      toast.error("Save your changes first. We couldn't save them just now.");
      return null;
    }
    const result = await saveRevisionAction(projectId).catch(() => null);
    if (result?.ok) {
      // Citation numbers may have been tidied, and only then does the text change.
      if (result.data.counter !== counterRef.current) {
        replace(result.data.content, result.data.counter);
      }
      onRevisionSaved?.();
      return result.data;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else toast.error(result?.formError ?? "We couldn't save a revision. Please try again.");
    return null;
  }, [counterRef, onRevisionSaved, projectId, replace, save]);

  useEffect(() => {
    handleRef.current = { flush: save, replace, saveRevision };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, replace, save, saveRevision]);

  // Leaving before the timer fires: try to save, and warn while anything is unsaved (Section 28).
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      void save();
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current) void save();
    };
  }, [save]);

  async function resolve(choice: "keep-mine" | "use-theirs") {
    const content = projectDocSchema.safeParse(editorRef.current?.getJSON());
    if (!content.success) return;
    const result = await resolveConflictAction({
      projectId,
      choice,
      content: content.data,
    }).catch(() => null);
    setConflict(false);
    if (result?.ok) {
      replace(result.data.content, result.data.counter);
      toast.success("The other version is saved as a revision.");
      onSaved?.();
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else toast.error("We couldn't sort that out. Please reload this page.");
  }

  async function onSaveRevision() {
    setSavingRevision(true);
    const saved = await saveRevision();
    setSavingRevision(false);
    if (saved) {
      toast.success(
        saved.created
          ? `Saved as revision ${saved.revision.revisionNo}.`
          : `Nothing changed since revision ${saved.revision.revisionNo}.`,
      );
    }
  }

  return (
    <section aria-label="Editor" className="min-w-0 overflow-hidden rounded-xl border bg-muted">
      <div className="flex flex-wrap items-center gap-1 border-b bg-card px-2 py-1.5">
        <Toolbar editor={editor} disabled={readOnly} />
        <div className="ml-auto flex items-center gap-2 pl-2">
          <SaveStatus state={state} message={message} readOnly={readOnly} />
          <Button
            size="sm"
            variant="outline"
            disabled={readOnly || savingRevision || preview}
            onClick={() => void onSaveRevision()}
          >
            {savingRevision ? <Spinner aria-hidden="true" /> : <Save aria-hidden="true" />}
            Save revision
          </Button>
        </div>
      </div>
      <div className="p-3 md:p-8">
        <Paper className="min-w-0">
          <EditorContent editor={editor} />
        </Paper>
        <References editor={editor} sources={sources} openCitation={openCitation} />
      </div>

      <AlertDialog open={conflict}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This project changed in another tab.</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits here haven&apos;t been saved. Choose which text to keep. The other version
              is saved as a revision, so nothing is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => void resolve("use-theirs")}>
              Use the other tab&apos;s text
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void resolve("keep-mine")}>
              Keep this tab&apos;s text
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function SaveStatus({
  state,
  message,
  readOnly,
}: {
  state: SaveState;
  message: string | null;
  readOnly: boolean;
}) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
      {readOnly ? (
        "Read only"
      ) : state === "saving" ? (
        <>
          <Spinner aria-hidden="true" className="size-3.5" />
          Saving
        </>
      ) : state === "saved" ? (
        <>
          <Check aria-hidden="true" className="size-3.5 text-success" />
          Saved
        </>
      ) : state === "error" ? (
        <span className="flex items-center gap-1 text-error" title={message ?? undefined}>
          <CircleAlert aria-hidden="true" className="size-3.5" />
          Not saved
        </span>
      ) : (
        "Not saved"
      )}
    </p>
  );
}

function Toolbar({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const update = () => redraw((value) => value + 1);
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  const chain = () => editor?.chain().focus();
  const items = [
    { name: "bold", label: "Bold", icon: Bold, run: () => chain()?.toggleBold().run() },
    { name: "italic", label: "Italic", icon: Italic, run: () => chain()?.toggleItalic().run() },
    {
      name: "heading",
      attrs: { level: 2 },
      label: "Section heading",
      icon: Heading2,
      run: () => chain()?.toggleHeading({ level: 2 }).run(),
    },
    {
      name: "heading",
      attrs: { level: 3 },
      label: "Subheading",
      icon: Heading3,
      run: () => chain()?.toggleHeading({ level: 3 }).run(),
    },
    {
      name: "bulletList",
      label: "Bulleted list",
      icon: List,
      run: () => chain()?.toggleBulletList().run(),
    },
    {
      name: "orderedList",
      label: "Numbered list",
      icon: ListOrdered,
      run: () => chain()?.toggleOrderedList().run(),
    },
  ];
  const inTable = editor?.isActive("table") ?? false;
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5">
      {items.map(({ name, attrs, label, icon: Icon, run }) => (
        <Toggle
          key={label}
          size="sm"
          aria-label={label}
          disabled={disabled || !editor}
          pressed={editor?.isActive(name, attrs) ?? false}
          onPressedChange={() => run()}
          className="[&_svg]:size-4"
        >
          <Icon aria-hidden="true" />
        </Toggle>
      ))}
      <Separator orientation="vertical" className="mx-1 h-6" />
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Insert a table"
        disabled={disabled || !editor || inTable}
        onClick={() => chain()?.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <TableIcon aria-hidden="true" />
      </Button>
      {inTable ? (
        <>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Add a row"
            disabled={disabled}
            onClick={() => chain()?.addRowAfter().run()}
          >
            <Rows2 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Add a column"
            disabled={disabled}
            onClick={() => chain()?.addColumnAfter().run()}
          >
            <Columns2 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Delete this table"
            disabled={disabled}
            onClick={() => chain()?.deleteTable().run()}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </>
      ) : null}
    </div>
  );
}

const pageLabel = (start: number, end: number) =>
  start === end ? `p. ${start}` : `pp. ${start}–${end}`;

/**
 * The document's citations as keyboard-usable links (Section 21), with edited
 * text marked: its citation stays but is no longer counted as verified (Section 8).
 */
function References({
  editor,
  sources,
  openCitation,
}: {
  editor: Editor | null;
  sources: readonly RevisionSource[];
  openCitation: ReturnType<typeof useOpenCitation>;
}) {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const update = () => redraw((value) => value + 1);
    editor.on("update", update);
    editor.on("create", update);
    return () => {
      editor.off("update", update);
      editor.off("create", update);
    };
  }, [editor]);
  if (!editor) return null;
  const parsed = projectDocSchema.safeParse(editor.getJSON());
  const references = parsed.success ? docReferences(parsed.data) : [];
  if (references.length === 0) return null;
  const titles = new Map(sources.map((source) => [source.versionId, source.title]));
  return (
    <div className="mx-auto mt-4 max-w-[720px] rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">Citations</h2>
      <ul className="mt-2 space-y-1">
        {references.map((reference) => (
          <li
            key={`${reference.versionId}:${reference.pageStart}:${reference.pageEnd}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm"
          >
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto min-w-0 p-0 text-left whitespace-normal"
              onClick={() =>
                void openCitation({
                  versionId: reference.versionId,
                  pageStart: reference.pageStart,
                })
              }
            >
              [{reference.label}] {titles.get(reference.versionId) ?? "Source"},{" "}
              {pageLabel(reference.pageStart, reference.pageEnd)}
            </Button>
            {reference.verified ? null : (
              <span className="text-xs text-muted-foreground">
                Edited since drafting: check it still matches
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
