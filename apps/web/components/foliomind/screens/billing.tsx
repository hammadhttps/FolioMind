import { CreditCard } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ComingSoonButton } from "../coming-soon";
import { PageHeading } from "../page-heading";
import { Panel } from "../panel";
import { ProgressBar } from "../progress-bar";

/** Billing and Usage (Section 20 #14); entitlements arrive in Phase 4 and Stripe in Phase 10. */
export function BillingScreen() {
  return (
    <div className="space-y-6">
      <PageHeading
        title="Billing and usage"
        description="Your plan, this month's allowances and payment details."
      />

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
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="text-base font-semibold">—</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-base font-semibold">—</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Billing period</dt>
              <dd className="text-base font-semibold">—</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Payment method</dt>
              <dd className="text-base font-semibold">—</dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">
            Plan details appear here once billing opens.
          </p>
          <ComingSoonButton variant="outline" reason="The billing portal opens with Pro">
            <CreditCard aria-hidden="true" />
            Manage billing
          </ComingSoonButton>
        </Panel>

        <Panel
          title="Usage this month"
          description="Counts update as you work."
          contentClassName="space-y-4 pt-0"
        >
          <ProgressBar value={null} label="Owned source PDFs" />
          <ProgressBar value={null} label="Storage, including exports" />
          <ProgressBar value={null} label="AI questions" />
          <ProgressBar value={null} label="Generated PDF projects" />
          <ProgressBar value={null} label="Web article imports" />
        </Panel>
      </div>
    </div>
  );
}
