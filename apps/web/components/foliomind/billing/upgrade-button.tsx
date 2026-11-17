"use client";

import { CreditCard, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { handleRateLimitResponse } from "@/lib/rate-limit-toast";

async function openStripe(path: string): Promise<boolean> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: "pro" }),
  }).catch(() => null);
  if (!response) {
    toast.error("We couldn't reach FolioMind. Check your connection and try again.");
    return false;
  }
  if (handleRateLimitResponse(response)) return false;
  const body = (await response.json().catch(() => null)) as {
    url?: string;
    error?: { message?: string };
  } | null;
  if (!response.ok || !body?.url) {
    toast.error(body?.error?.message ?? "That didn't work. Please try again.");
    return false;
  }
  // Stripe hosts Checkout and the Portal; FolioMind never sees card details.
  window.location.assign(body.url);
  return true;
}

/** Upgrade to Pro (Section 10): a server-created Stripe Checkout session. */
export function UpgradeButton({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="lg"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        if (!(await openStripe("/api/billing/checkout"))) setBusy(false);
      }}
    >
      {busy ? <Spinner aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
      {children ?? "Upgrade to Pro"}
    </Button>
  );
}

/** Manage billing (Section 10 step 5): Stripe's Customer Portal for the user's own customer. */
export function ManageBillingButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        if (!(await openStripe("/api/billing/portal"))) setBusy(false);
      }}
    >
      {busy ? <Spinner aria-hidden="true" /> : <CreditCard aria-hidden="true" />}
      Manage billing
    </Button>
  );
}
