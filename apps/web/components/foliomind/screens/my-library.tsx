"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  collectionFormSchema,
  documentTitleSchema,
  type ActionResult,
  type CollectionFormValues,
} from "@foliomind/contracts";
import { SEARCH_MIN_LENGTH } from "@foliomind/contracts/search-params";
import {
  ExternalLink,
  FileUp,
  FolderPlus,
  Library,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { debounce, useQueryStates } from "nuqs";
import { useCallback, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  createCollectionAction,
  deleteCollectionAction,
  deleteDocumentAction,
  loadMoreLibraryAction,
  reimportDocumentAction,
  renameDocumentAction,
  setCollectionMembershipAction,
  updateCollectionAction,
} from "@/lib/library/actions";
import type { LibraryCard } from "@/lib/library/view";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { libraryParsers } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { AppDialog } from "../app-dialog";
import { BookCard } from "../book-card";
import { EmptyState } from "../empty-state";
import { FilterTabs } from "../filter-tabs";
import { PageHeading } from "../page-heading";
import { SearchField } from "../search-field";
import { useIsPreview } from "../session-user";
import { StatusAlert } from "../status-alert";
import { ProcessingStatus } from "../processing-status";
import { UploadDialog, type UploadAllowanceView } from "../upload-dialog";

const TYPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "uploads", label: "Uploads" },
  { value: "saved", label: "Saved" },
  { value: "imported", label: "Imported" },
];

const KIND_LABELS = { upload: "Upload", imported: "Imported", saved: "Saved" } as const;

export interface CollectionView {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
}

export interface MyLibraryProps {
  initial: { items: LibraryCard[]; nextCursor: string | null };
  collections: CollectionView[];
  allowance: UploadAllowanceView | null;
}

/** Shows a failed action's reason; rate limits use the Section 23 toast. */
function reportFailure(
  result: Extract<ActionResult<unknown>, { ok: false }> | null,
  fallback: string,
) {
  if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
  else toast.error(result?.formError ?? fallback);
}

/**
 * My Library (Section 20 #7): the user's uploads now and saved books from
 * Phase 9, with URL-bound search, filters and sort (Section 24), Load more,
 * collections and per-item actions. Processing items can already be read; AI
 * features wait for ingestion (Phase 6).
 */
export function MyLibraryScreen({ initial, collections, allowance }: MyLibraryProps) {
  const [params, setParams] = useQueryStates(libraryParsers, { shallow: false });
  const [term, setTerm] = useState(params.q);
  const filtered =
    Boolean(params.q) ||
    params.type !== "all" ||
    params.status !== "all" ||
    Boolean(params.collection);

  function onSearch(value: string) {
    setTerm(value);
    const trimmed = value.trim();
    void setParams(
      { q: trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : null },
      { history: "replace", limitUrlUpdates: value ? debounce(300) : undefined },
    );
  }

  function clearFilters() {
    setTerm("");
    void setParams({ q: null, type: null, status: null, collection: null });
  }

  const uploadButton = (
    <UploadDialog
      allowance={allowance}
      trigger={
        <Button>
          <FileUp aria-hidden="true" />
          Upload PDF
        </Button>
      }
    />
  );

  return (
    <div className="space-y-6">
      <PageHeading
        title="Your personal bookshelf."
        description="Your uploads, imported articles and saved books in one place."
        actions={uploadButton}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchField
          value={term}
          onValueChange={onSearch}
          label="Search your library"
          placeholder="Search by title"
          className="lg:max-w-sm"
        />
        <FilterTabs
          label="Document type"
          options={TYPE_OPTIONS}
          value={params.type}
          onValueChange={(type) =>
            void setParams({ type: type === "all" ? null : (type as typeof params.type) })
          }
        />
        <div className="flex flex-col gap-3 sm:flex-row lg:ml-auto">
          <Select
            value={params.status}
            onValueChange={(status) =>
              void setParams({ status: status === "all" ? null : (status as typeof params.status) })
            }
          >
            <SelectTrigger className="h-10 w-full bg-card sm:w-44" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="attention">Needs attention</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={params.sort}
            onValueChange={(sort) =>
              void setParams({ sort: sort === "opened" ? null : (sort as typeof params.sort) })
            }
          >
            <SelectTrigger className="h-10 w-full bg-card sm:w-48" aria-label="Sort by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="opened">Recently opened</SelectItem>
              <SelectItem value="added">Recently added</SelectItem>
              <SelectItem value="title">Title</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <CollectionsBar
        collections={collections}
        selected={params.collection}
        onSelect={(collection) => void setParams({ collection })}
      />

      <LibraryResults
        initial={initial}
        collections={collections}
        filters={params}
        filtered={filtered}
        onClearFilters={clearFilters}
        emptyActions={
          <>
            <UploadDialog
              allowance={allowance}
              trigger={<Button variant="outline">Upload PDF</Button>}
            />
            <Button asChild variant="ghost">
              <Link href="/library">Explore the library</Link>
            </Button>
          </>
        }
      />
    </div>
  );
}

function LibraryResults({
  initial,
  collections,
  filters,
  filtered,
  onClearFilters,
  emptyActions,
}: {
  initial: MyLibraryProps["initial"];
  collections: CollectionView[];
  filters: Record<string, string | null>;
  filtered: boolean;
  onClearFilters: () => void;
  emptyActions: React.ReactNode;
}) {
  const router = useRouter();
  const preview = useIsPreview();
  // Pages appended by Load more belong to the first page they continued; new
  // server data (filters changed or a refresh) starts over without an effect.
  const [more, setMore] = useState<{
    after: string | null;
    items: LibraryCard[];
    nextCursor: string | null;
  }>({ after: null, items: [], nextCursor: null });
  const appended = more.after === initial.nextCursor && more.after !== null ? more : null;
  const [overrides, setOverrides] = useState<Record<string, Partial<LibraryCard> | "removed">>({});
  const [loading, startLoading] = useTransition();

  const items = [...initial.items, ...(appended?.items ?? [])]
    .filter((item) => overrides[item.id] !== "removed")
    .map((item) => {
      const override = overrides[item.id];
      return override && override !== "removed" ? { ...item, ...override } : item;
    });
  const nextCursor = appended ? appended.nextCursor : initial.nextCursor;
  const refresh = useCallback(() => router.refresh(), [router]);

  function override(id: string, value: Partial<LibraryCard> | "removed" | null) {
    setOverrides((current) => {
      const next = { ...current };
      if (value === null) delete next[id];
      else next[id] = value;
      return next;
    });
  }

  function loadMore() {
    if (!nextCursor || preview) return;
    startLoading(async () => {
      const params = Object.fromEntries(
        Object.entries(filters).flatMap(([key, value]) => (value ? [[key, value]] : [])),
      );
      const result = await loadMoreLibraryAction(params, nextCursor).catch(() => null);
      if (!result?.ok) {
        reportFailure(result, "We couldn't load more documents. Please try again.");
        return;
      }
      setMore({
        after: initial.nextCursor,
        items: [...(appended?.items ?? []), ...result.data.items],
        nextCursor: result.data.nextCursor,
      });
    });
  }

  if (items.length === 0) {
    return (
      <>
        <p className="sr-only" aria-live="polite">
          {filtered ? "No documents match these filters." : "Your library is empty."}
        </p>
        {filtered ? (
          <EmptyState
            icon={Library}
            title="No documents match these filters."
            description="Try a broader search or clear your filters."
            actions={
              <Button variant="outline" onClick={onClearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Library}
            title="Nothing on your shelf yet."
            description="Upload a PDF, import an article or save a book from the library to start reading."
            actions={emptyActions}
          />
        )}
      </>
    );
  }

  return (
    <section aria-label="Library items" className="space-y-6">
      <p className="sr-only" aria-live="polite">
        Showing {items.length} {items.length === 1 ? "document" : "documents"}
        {nextCursor ? ", more available" : ""}.
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {items.map((item) => (
          <BookCard
            key={item.id}
            id={item.documentId ?? item.bookId ?? item.id}
            title={item.title}
            author={item.author}
            label={KIND_LABELS[item.kind]}
            href={
              item.documentId
                ? item.readable
                  ? `/read/${item.documentId}`
                  : "/dashboard/library?status=processing"
                : `/books/${item.bookId}`
            }
            badge={<ProcessingStatus item={item} onFinished={refresh} />}
            action={
              <ItemMenu
                item={item}
                collections={collections}
                onChange={(value) => override(item.id, value)}
                onSettled={refresh}
              />
            }
          />
        ))}
      </div>
      {nextCursor ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loading}>
            {loading ? <Spinner aria-hidden="true" /> : null}
            Load more
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ItemMenu({
  item,
  collections,
  onChange,
  onSettled,
}: {
  item: LibraryCard;
  collections: CollectionView[];
  onChange: (value: Partial<LibraryCard> | "removed" | null) => void;
  onSettled: () => void;
}) {
  const preview = useIsPreview();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);

  async function toggleCollection(collectionId: string, member: boolean) {
    if (preview) return;
    const collectionIds = member
      ? [...item.collectionIds, collectionId]
      : item.collectionIds.filter((id) => id !== collectionId);
    onChange({ collectionIds });
    const result = await setCollectionMembershipAction({
      collectionId,
      libraryItemId: item.id,
      member,
    }).catch(() => null);
    if (!result?.ok) {
      onChange(null);
      reportFailure(result, "We couldn't update that collection.");
      return;
    }
    onSettled();
  }

  async function reimport() {
    if (!item.documentId || preview) return;
    const result = await reimportDocumentAction(item.documentId).catch(() => null);
    if (!result?.ok) {
      reportFailure(result, "We couldn't start the re-import. Please try again.");
      return;
    }
    toast.success("Re-importing the article. The current copy stays readable until it's done.");
    onSettled();
  }

  async function remove() {
    if (!item.documentId || preview) return;
    onChange("removed");
    const result = await deleteDocumentAction(item.documentId).catch(() => null);
    if (!result?.ok) {
      onChange(null);
      reportFailure(result, "We couldn't delete that document. Please try again.");
      return;
    }
    toast.success("Document deleted.");
    onSettled();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            className="bg-card/90 shadow-card backdrop-blur"
            aria-label={`Actions for ${item.title}`}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {item.documentId && item.readable ? (
            <DropdownMenuItem asChild>
              <Link href={`/read/${item.documentId}`}>Open in reader</Link>
            </DropdownMenuItem>
          ) : null}
          {item.documentId ? (
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <Pencil aria-hidden="true" />
              Rename…
            </DropdownMenuItem>
          ) : null}
          {item.sourceUrl ? (
            <>
              <DropdownMenuItem asChild>
                <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                  <ExternalLink aria-hidden="true" />
                  Open original page
                </a>
              </DropdownMenuItem>
              {item.job?.live ? null : (
                <DropdownMenuItem onSelect={() => void reimport()}>
                  <RefreshCw aria-hidden="true" />
                  Re-import
                </DropdownMenuItem>
              )}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Collections
          </DropdownMenuLabel>
          {collections.map((collection) => (
            <DropdownMenuCheckboxItem
              key={collection.id}
              checked={item.collectionIds.includes(collection.id)}
              onCheckedChange={(checked) => void toggleCollection(collection.id, checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {collection.name}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <FolderPlus aria-hidden="true" />
            New collection…
          </DropdownMenuItem>
          {item.documentId ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2 aria-hidden="true" />
                Delete…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {item.documentId ? (
        <RenameDialog
          open={renaming}
          onOpenChange={setRenaming}
          documentId={item.documentId}
          title={item.title}
          onRenamed={(title) => {
            onChange({ title });
            onSettled();
          }}
        />
      ) : null}
      <CollectionDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(id) => void toggleCollection(id, true)}
      />
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{item.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It leaves your library right away and can no longer be opened, along with your
              highlights and notes. Copies you already downloaded aren&apos;t affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const renameFormSchema = z.object({ title: documentTitleSchema });

function RenameDialog({
  open,
  onOpenChange,
  documentId,
  title,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  title: string;
  onRenamed: (title: string) => void;
}) {
  const preview = useIsPreview();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<{ title: string }>({
    resolver: zodResolver(renameFormSchema),
    mode: "onTouched",
    values: { title },
  });
  const error = form.formState.errors.title;

  async function onSubmit(values: { title: string }) {
    setFormError(null);
    if (preview) return;
    const result = await renameDocumentAction({ documentId, title: values.title }).catch(
      () => null,
    );
    if (result?.ok) {
      onRenamed(result.data.title);
      onOpenChange(false);
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    const message = result?.fieldErrors?.title?.[0];
    if (message) form.setError("title", { message }, { shouldFocus: true });
    else setFormError(result?.formError ?? "We couldn't rename it. Please try again.");
  }

  return (
    <AppDialog open={open} onOpenChange={onOpenChange} title="Rename document">
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError ? <StatusAlert tone="error">{formError}</StatusAlert> : null}
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="rename-title">Title</FieldLabel>
          <Input
            id="rename-title"
            maxLength={200}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "rename-title-error" : undefined}
            {...form.register("title")}
          />
          {error ? <FieldError id="rename-title-error">{error.message}</FieldError> : null}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Spinner aria-hidden="true" /> : null}
            Save
          </Button>
        </div>
      </form>
    </AppDialog>
  );
}

function CollectionDialog({
  open,
  onOpenChange,
  collection,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection?: CollectionView;
  onSaved?: (id: string) => void;
}) {
  const router = useRouter();
  const preview = useIsPreview();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CollectionFormValues>({
    resolver: zodResolver(collectionFormSchema),
    mode: "onTouched",
    values: { name: collection?.name ?? "", description: collection?.description ?? "" },
  });
  const nameError = form.formState.errors.name;
  const descriptionError = form.formState.errors.description;

  async function onSubmit(values: CollectionFormValues) {
    setFormError(null);
    if (preview) return;
    const result = await (
      collection ? updateCollectionAction(collection.id, values) : createCollectionAction(values)
    ).catch(() => null);
    if (result?.ok) {
      toast.success(collection ? "Collection updated." : "Collection created.");
      onOpenChange(false);
      form.reset({ name: "", description: "" });
      onSaved?.(result.data.id);
      router.refresh();
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    const message = result?.fieldErrors?.name?.[0];
    if (message) form.setError("name", { message }, { shouldFocus: true });
    else setFormError(result?.formError ?? "We couldn't save the collection. Please try again.");
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={collection ? "Edit collection" : "New collection"}
      description="Group documents for a project, course or topic. Documents can be in several collections."
    >
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        {formError ? <StatusAlert tone="error">{formError}</StatusAlert> : null}
        <Field data-invalid={nameError ? true : undefined}>
          <FieldLabel htmlFor="collection-name">Name</FieldLabel>
          <Input
            id="collection-name"
            maxLength={60}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "collection-name-error" : undefined}
            {...form.register("name")}
          />
          {nameError ? (
            <FieldError id="collection-name-error">{nameError.message}</FieldError>
          ) : null}
        </Field>
        <Field data-invalid={descriptionError ? true : undefined}>
          <FieldLabel htmlFor="collection-description">Description (optional)</FieldLabel>
          <Textarea
            id="collection-description"
            maxLength={280}
            rows={3}
            aria-invalid={descriptionError ? true : undefined}
            {...form.register("description")}
          />
          {descriptionError ? <FieldError>{descriptionError.message}</FieldError> : null}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Spinner aria-hidden="true" /> : null}
            {collection ? "Save" : "Create collection"}
          </Button>
        </div>
      </form>
    </AppDialog>
  );
}

function CollectionsBar({
  collections,
  selected,
  onSelect,
}: {
  collections: CollectionView[];
  selected: string | null;
  onSelect: (collectionId: string | null) => void;
}) {
  const router = useRouter();
  const preview = useIsPreview();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const current = collections.find((collection) => collection.id === selected);

  async function remove() {
    if (!current || preview) return;
    const result = await deleteCollectionAction(current.id).catch(() => null);
    if (!result?.ok) {
      reportFailure(result, "We couldn't delete that collection.");
      return;
    }
    toast.success("Collection deleted. Its documents are still in your library.");
    onSelect(null);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Collections">
      <span className="mr-1 text-sm font-medium text-muted-foreground">Collections</span>
      <Pill pressed={!selected} onClick={() => onSelect(null)}>
        Everything
      </Pill>
      {collections.map((collection) => (
        <Pill
          key={collection.id}
          pressed={collection.id === selected}
          onClick={() => onSelect(collection.id)}
        >
          {collection.name}
          <span className="text-muted-foreground tabular-nums">{collection.itemCount}</span>
        </Pill>
      ))}
      <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
        <FolderPlus aria-hidden="true" />
        New collection
      </Button>
      {current ? (
        <>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" />
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        </>
      ) : null}

      <CollectionDialog open={creating} onOpenChange={setCreating} />
      {current ? (
        <CollectionDialog open={editing} onOpenChange={setEditing} collection={current} />
      ) : null}
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the “{current?.name}” collection?</AlertDialogTitle>
            <AlertDialogDescription>
              Only the collection is removed. Its documents stay in your library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Delete collection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Pill({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/70",
        pressed
          ? "border-primary bg-primary-subtle text-primary-subtle-foreground"
          : "bg-card hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
