"use client";

import { renameProjectSchema } from "@foliomind/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Ellipsis,
  FileDown,
  FolderOpen,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  deleteProjectAction,
  duplicateProjectAction,
  renameProjectAction,
  setProjectArchivedAction,
} from "@/lib/projects/actions";
import type { ProjectRow } from "@/lib/projects/view";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import { AppDialog } from "../app-dialog";
import { useIsPreview } from "../session-user";
import { StatusAlert } from "../status-alert";

const titleSchema = renameProjectSchema.pick({ title: true });
type TitleValues = z.infer<typeof titleSchema>;

/** Rename dialog (Section 28: title 1–120 characters), used here and in the Studio. */
export function RenameProjectDialog({
  projectId,
  title,
  open,
  onOpenChange,
  onRenamed,
}: {
  projectId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
}) {
  return (
    <AppDialog open={open} onOpenChange={onOpenChange} title="Rename project">
      {open ? (
        <RenameForm
          projectId={projectId}
          title={title}
          onCancel={() => onOpenChange(false)}
          onRenamed={() => {
            onOpenChange(false);
            onRenamed();
          }}
        />
      ) : null}
    </AppDialog>
  );
}

function RenameForm({
  projectId,
  title,
  onCancel,
  onRenamed,
}: {
  projectId: string;
  title: string;
  onCancel: () => void;
  onRenamed: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<TitleValues>({
    resolver: zodResolver(titleSchema),
    mode: "onTouched",
    defaultValues: { title },
  });
  const { errors, isSubmitting } = form.formState;
  async function submit(values: TitleValues) {
    setFormError(null);
    const result = await renameProjectAction({ projectId, ...values }).catch(() => null);
    if (result?.ok) {
      onRenamed();
      return;
    }
    if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
    else setFormError(result?.formError ?? "We couldn't rename it. Please try again.");
  }
  return (
    <form onSubmit={(event) => void form.handleSubmit(submit)(event)} className="space-y-4">
      {formError ? <StatusAlert tone="error">{formError}</StatusAlert> : null}
      <Field data-invalid={errors.title ? true : undefined}>
        <FieldLabel htmlFor="rename-project-title">Title</FieldLabel>
        <Input
          id="rename-project-title"
          autoFocus
          maxLength={120}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "rename-project-error" : undefined}
          {...form.register("title")}
        />
        <FieldError id="rename-project-error" errors={[errors.title]} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner aria-hidden="true" /> : null}
          Rename
        </Button>
      </div>
    </form>
  );
}

/** Open, download, duplicate, rename, archive and delete (Phase 8 skill). */
export function ProjectRowActions({ project }: { project: ProjectRow }) {
  const router = useRouter();
  const preview = useIsPreview();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, start] = useTransition();

  function run(
    action: () => Promise<{
      ok: boolean;
      code?: string;
      formError?: string;
      retryAfterSeconds?: number;
    } | null>,
    done: string,
  ) {
    if (preview) return;
    start(async () => {
      const result = await action().catch(() => null);
      if (result?.ok) {
        toast.success(done);
        router.refresh();
        return;
      }
      if (result?.code === "rate_limited") showRateLimitToast(result.retryAfterSeconds);
      else toast.error(result?.formError ?? "That didn't work. Please try again.");
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${project.title}`}>
            {pending ? (
              <Spinner aria-hidden="true" className="size-4" />
            ) : (
              <Ellipsis className="size-4" aria-hidden="true" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/dashboard/projects/${project.id}`}>
              <FolderOpen aria-hidden="true" />
              Open
            </Link>
          </DropdownMenuItem>
          {project.latestExportId ? (
            <DropdownMenuItem asChild>
              <a
                href={`/api/projects/${project.id}/exports/${project.latestExportId}/download`}
                download
              >
                <FileDown aria-hidden="true" />
                Download latest PDF
              </a>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() => run(() => duplicateProjectAction(project.id), "Project duplicated.")}
          >
            <Copy aria-hidden="true" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Pencil aria-hidden="true" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run(
                () =>
                  setProjectArchivedAction({
                    projectId: project.id,
                    archived: !project.archived,
                  }),
                project.archived ? "Project restored." : "Project archived.",
              )
            }
          >
            {project.archived ? (
              <ArchiveRestore aria-hidden="true" />
            ) : (
              <Archive aria-hidden="true" />
            )}
            {project.archived ? "Restore" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameProjectDialog
        projectId={project.id}
        title={project.title}
        open={renaming}
        onOpenChange={setRenaming}
        onRenamed={() => router.refresh()}
      />

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              “{project.title}”, its revisions and its exports will be removed. PDFs you&apos;ve
              already downloaded stay yours, and your source documents aren&apos;t touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => run(() => deleteProjectAction(project.id), "Project deleted.")}
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
