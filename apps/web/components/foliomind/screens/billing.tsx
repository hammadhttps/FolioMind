"use client";

import {
  billingSnapshotSchema,
  type BillingSnapshot,
  type UsageMetric,
} from "@foliomind/contracts";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Receipt } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDate } from "@/lib/format";
import { ManageBillingButton, UpgradeButton } from "../billing/upgrade-button";
import { EmptyState } from "../empty-state";
import { PageHeading } from "../page-heading";
import { Panel } from "../panel";
import { ProgressBar } from "../progress-bar";
import { StatusAlert } from "../status-alert";
import { StatusChip } from "../status-chip";

export interface UsageView {
  periodStart: string;
  periodEnd: string;
  metrics: { metric: UsageMetric; used: number; limit: number }[];
  documents: { used: number; limit: number };
  storage: { usedBytes: number; limitBytes: number };
}

export interface BillingData {
  snapshot: BillingSnapshot;
  usage: UsageView;
  configured: boolean;
  sandbox: boolean;
  /** Back from Stripe's success URL: Payment pending until the webhook sync confirms. */
  returned: boolean;
}

const METRIC_LABELS: Record<UsageMetric, string> = {
  ai_questions: "AI questions",
  generated_projects: "Generated PDF projects",
  section_regenerations: "Section regenerations",
  reexports: "Re-exports of edited content",
  url_imports: "Web article imports",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Active",
  past_due: "Payment overdue",
  unpaid: "Unpaid",
  incomplete: "Waiting for payment",
  incomplete_expired: "Expired",
  canceled: "Cancelled",
  paused: "Paused",
};

const POLL_MS = 3_000;
const POLL_FOR_MS = 2 * 60 * 1000;

const percent = (used: number, limit: number) => (limit > 0 ? (used / limit) * 100 : 0);

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).format(
    amount / 100,
  );

async function fetchSnapshot(): Promise<BillingSnapshot> {
  const response = await fetch("/api/billing/snapshot", { cache: "no-store" });
  if (!response.ok) throw new Error(`billing snapshot ${response.status}`);
  return billingSnapshotSchema.parse(await response.json());
}

const EMPTY: BillingData = {
  snapshot: {
    planCode: "free",
    subscription: null,
    pendingCheckout: false,
    paymentIssue: null,
    hasCustomer: false,
    invoices: [],
  },
  usage: {
    periodStart: new Date(0).toISOString(),
    periodEnd: new Date(0).toISOString(),
    metrics: [],
    documents: { used: 0, limit: 0 },
    storage: { usedBytes: 0, limitBytes: 0 },
  },
  configured: false,
  sandbox: true,
  returned: false,
};

/**
 * Billing and Usage (Sections 5 row 14 and 20 #14): the effective plan and
 * subscription from the webhook-synced snapshot, the billing period, this
 * period's allowances and the stored-file gauges, invoices, and Stripe's
 * Customer Portal. After Checkout it shows Payment pending and polls until the
 * sync confirms; visiting the success URL never grants Pro by itself.
 */
export function BillingScreen({ data = EMPTY }: { data?: BillingData }) {
  const router = useRouter();
  // Stops polling after two minutes; the page then says Stripe hasn't confirmed yet.
  const [expired, setExpired] = useState(false);
  const waiting =
    data.snapshot.planCode === "free" && (data.returned || data.snapshot.pendingCheckout);
  const { data: live } = useQuery({
    queryKey: ["billing-snapshot"],
    queryFn: fetchSnapshot,
    enabled: waiting,
    initialData: data.snapshot,
    refetchInterval: (query) => (query.state.data?.planCode === "pro" || expired ? false : POLL_MS),
  });
  const snapshot = live ?? data.snapshot;
  const confirmed = waiting && snapshot.planCode === "pro";
  useEffect(() => {
    if (!confirmed) return;
    toast.success("Payment confirmed. Welcome to FolioMind Pro.");
    router.replace("/dashboard/billing");
    router.refresh();
  }, [confirmed, router]);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setExpired(true), POLL_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [waiting]);
  const stillWaiting = waiting && !confirmed && expired;

  const subscription = snapshot.subscription;
  const isPro = snapshot.planCode === "pro";
  const statusLabel = subscription
    ? subscription.cancelAtPeriodEnd && subscription.status === "active"
      ? `Cancels on ${formatDate(subscription.periodEnd)}`
      : (STATUS_LABELS[subscription.status] ?? subscription.status)
    : "No subscription";

  return (
    <div className="space-y-6">
      <PageHeading
        title="Billing and usage"
        description="Your plan, this period's allowances and payment details."
      />

      {data.sandbox && data.configured ? (
        <StatusAlert tone="info" title="Test mode: no real charges">
          Billing runs in Stripe&apos;s test mode. Test cards work; real cards are never charged.
        </StatusAlert>
      ) : null}
      {waiting && !confirmed ? (
        <StatusAlert
          tone="info"
          title="Payment pending"
          className="[&_svg]:motion-safe:animate-pulse"
        >
          {stillWaiting
            ? "Stripe hasn't confirmed the payment yet. Pro starts as soon as it does; you can leave this page."
            : "We're waiting for Stripe to confirm your payment. This page updates by itself."}
        </StatusAlert>
      ) : null}
      {snapshot.paymentIssue === "payment_failed" ? (
        <StatusAlert tone="error" title="Your last payment didn't go through">
          Update your payment method in Manage billing.{" "}
          {subscription?.paidThrough
            ? `Pro stays on until ${formatDate(subscription.paidThrough)}.`
            : null}
        </StatusAlert>
      ) : null}
      {snapshot.paymentIssue === "action_required" ? (
        <StatusAlert tone="warning" title="Confirm your payment">
          Your bank needs you to confirm the payment. Open Manage billing to finish it.
        </StatusAlert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Your plan"
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/pricing">Compare plans</Link>
            </Button>
          }
          contentClassName="space-y-4 pt-0"
        >
          <dl className="grid grid-cols-2 gap-4 px-5 text-sm">
            <div>
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="mt-1">
                {isPro ? (
                  <StatusChip status="ready" label="FolioMind Pro" />
                ) : (
                  <span className="text-base font-semibold">FolioMind Free</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-base font-semibold">{statusLabel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Billing period</dt>
              <dd className="text-base font-semibold">
                {formatDate(data.usage.periodStart)} – {formatDate(data.usage.periodEnd)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Paid through</dt>
              <dd className="text-base font-semibold">
                {isPro && subscription?.paidThrough ? formatDate(subscription.paidThrough) : "—"}
              </dd>
            </div>
          </dl>
          <p className="px-5 text-sm text-muted-foreground">
            {isPro
              ? "Cancel any time in Manage billing; Pro continues until the end of the paid period."
              : "Free allowances reset at the start of each calendar month (UTC)."}
          </p>
          <div className="flex flex-wrap gap-2 px-5 pb-5">
            {snapshot.hasCustomer && data.configured ? <ManageBillingButton /> : null}
            {!isPro && data.configured && !waiting ? <UpgradeButton /> : null}
          </div>
        </Panel>

        <Panel
          title="Usage this period"
          description={`Resets on ${formatDate(data.usage.periodEnd)}. Files and storage count what you keep now.`}
          contentClassName="space-y-4 px-5 pt-0 pb-5"
        >
          <ProgressBar
            value={percent(data.usage.documents.used, data.usage.documents.limit)}
            label="Owned source PDFs"
            valueLabel={`${data.usage.documents.used} of ${data.usage.documents.limit}`}
          />
          <ProgressBar
            value={percent(data.usage.storage.usedBytes, data.usage.storage.limitBytes)}
            label="Storage, including exports"
            valueLabel={`${formatBytes(data.usage.storage.usedBytes)} of ${formatBytes(data.usage.storage.limitBytes)}`}
          />
          {data.usage.metrics.map((row) => (
            <ProgressBar
              key={row.metric}
              value={percent(row.used, row.limit)}
              label={METRIC_LABELS[row.metric]}
              valueLabel={`${row.used} of ${row.limit}`}
            />
          ))}
        </Panel>
      </div>

      <Panel title="Invoices" description="Stripe's hosted invoices for your Pro subscription.">
        {snapshot.invoices.length === 0 ? (
          <EmptyState variant="plain" icon={Receipt} title="No invoices yet." />
        ) : (
          <ul className="divide-y px-5 pb-3">
            {snapshot.invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm"
              >
                <span className="font-medium">
                  {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
                </span>
                <span className="tabular-nums">{money(invoice.amountPaid, invoice.currency)}</span>
                <span className="text-muted-foreground capitalize">{invoice.status}</span>
                {invoice.hostedInvoiceUrl ? (
                  <a
                    href={invoice.hostedInvoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-link underline-offset-4 hover:underline"
                  >
                    View invoice
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
