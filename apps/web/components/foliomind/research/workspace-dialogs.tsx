"use client";

import { workspaceFormSchema, type WorkspaceFormValues } from "@foliomind/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { showRateLimitToast } from "@/lib/rate-limit-toast";
import {
  createWorkspaceAction,
  deleteWorkspaceAction,
  updateWorkspaceAction,
} from "@/lib/workspaces/actions";
import type { WorkspaceCardView } from "@/lib/workspaces/view";
import { AppDialog } from "../app-dialog";
import { StatusAlert } from "../status-alert";

/**
 * Create and rename share one form (Section 28): name 1–80 characters, an
 * optional description up to 280, the same schema on client and server.
 */
export function WorkspaceFormDialog({
  trigger,
  open,
  onOpenChange,
  workspace,
  onCreated,
  onUpdated,
}: {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Present when renaming. */
  workspace?: { id: string; name: string; description: string | null } | null;
  onCreated?: (workspace: WorkspaceCardView) => void;
  onUpdated?: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  return (
    <AppDialog
      {...(trigger ? { trigger } : {})}
      open={isOpen}
      onOpenChange={setOpen}
      title={workspace ? "Rename workspace" : "New workspace"}
      description={
        workspace
          ? "Your sources, notes and conversations stay as they are."
          : "A workspace keeps sources, questions and notes on one topic together."
      }
    >
      {isOpen ? (
        <WorkspaceForm
          key={workspace?.id ?? "new"}
          workspace={workspace ?? null}
          onCancel={() => setOpen(false)}
          onCreated={(created) => {
            setOpen(false);
            onCreated?.(created);
          }}
          onUpdated={() => {
            setOpen(false);
            onUpdated?.();
          }}
        />
      ) : null}
    </AppDialog>
  );
}

function WorkspaceForm({
  workspace,
  onCancel,
  onCreated,
  onUpdated,
}: {
  workspace: { id: string; name: string; description: string | null } | null;
  onCancel: () => void;
  onCreated: (workspace: WorkspaceCardView) => void;
  onUpdated: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<WorkspaceFormValues>({
    resolver: zodResolver(workspaceFormSchema),
    mode: "onTouched",
    defaultValues: { name: workspace?.name ?? "", description: workspace?.description ?? "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function submit(values: WorkspaceFormValues) {
    setFormError(null);
    const result = workspace
      ? await updateWorkspaceAction({ ...values, workspaceId: workspace.id }).catch(() => null)
      : await createWorkspaceAction(values).catch(() => null);
    if (!result?.ok) {
      if (result?.code === "rate_limited") {
        showRateLimitToast(result.retryAfterSeconds);
        return;
      }
      const name = result?.fieldErrors?.name?.[0];
      if (name) form.setError("name", { message: name });
      else setFormError(result?.formError ?? "We couldn't save that. Please try again.");
      return;
    }
    if (workspace) onUpdated();
    else onCreated((result as { data: WorkspaceCardView }).data);
  }

  return (
    <form noValidate className="space-y-4" onSubmit={form.handleSubmit(submit)}>
      {formError ? <StatusAlert tone="error">{formError}</StatusAlert> : null}
      <Field data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor="workspace-name">Name</FieldLabel>
        <Input
          id="workspace-name"
          autoFocus
          maxLength={80}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "workspace-name-error" : undefined}
          {...form.register("name")}
        />
        <FieldError id="workspace-name-error" errors={[errors.name]} />
      </Field>
      <Field data-invalid={errors.description ? true : undefined}>
        <FieldLabel htmlFor="workspace-description">Description (optional)</FieldLabel>
        <Textarea
          id="workspace-description"
          rows={2}
          maxLength={280}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? "workspace-description-error" : undefined}
          {...form.register("description")}
        />
        <FieldError id="workspace-description-error" errors={[errors.description]} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner aria-hidden="true" /> : null}
          {workspace ? "Save" : "Create workspace"}
        </Button>
      </div>
    </form>
  );
}

/** Deleting keeps the original documents (Section 11), and says so. */
export function DeleteWorkspaceDialog({
  workspace,
  onOpenChange,
  onDeleted,
}: {
  workspace: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  return (
    <AlertDialog open={workspace !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{workspace?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Its notes and conversations are removed. Your documents stay in your library, and PDFs
            you already created aren&apos;t affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={async () => {
              if (!workspace) return;
              const result = await deleteWorkspaceAction(workspace.id).catch(() => null);
              if (result?.ok) {
                toast.success("Workspace deleted.");
                onDeleted();
              } else if (result?.code === "rate_limited") {
                showRateLimitToast(result.retryAfterSeconds);
              } else {
                toast.error(result?.formError ?? "We couldn't delete it. Please try again.");
              }
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
