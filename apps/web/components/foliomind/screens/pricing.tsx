import { Check, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ComingSoonButton } from "../coming-soon";
import { PageHeading } from "../page-heading";

/** Section 10 provisional allowances; not finalized commercial promises. */
const ALLOWANCES = [
  { label: "Owned source PDFs", free: "5", pro: "100" },
  { label: "Storage, including exports", free: "100 MiB", pro: "2 GiB" },
  { label: "AI questions per month", free: "30", pro: "500" },
  { label: "Generated PDF projects per month", free: "2", pro: "25" },
  { label: "Sources per research workspace", free: "2", pro: "5" },
  { label: "Section regenerations per month", free: "10", pro: "100" },
  { label: "Re-exports of edited content per month", free: "10", pro: "100" },
  { label: "Web article imports per month", free: "5", pro: "50" },
] as const;

/**
 * Pricing (Section 20 #5): Free and an emphasized Pro. The Pro price is not
 * shown until it is finalized, and checkout opens with Stripe in Phase 10.
 */
export function PricingScreen({ freeAction }: { freeAction: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <PageHeading
        className="text-center sm:flex-col sm:items-center"
        title="Plans for every kind of reader."
        description="Start free. Move to Pro when you need more sources, questions and projects."
      />

      <div className="grid gap-5 md:grid-cols-2">
        <PlanCard
          name="FolioMind Free"
          price={<span className="text-3xl font-semibold">Free</span>}
          terms="No card required."
          allowances={ALLOWANCES.map((row) => ({ label: row.label, value: row.free }))}
          action={freeAction}
        />
        <PlanCard
          featured
          name="FolioMind Pro"
          price={<span className="text-lg font-semibold">Launch pricing is being finalized.</span>}
          terms="Billed monthly. Cancel any time; access continues until the end of the paid period."
          allowances={ALLOWANCES.map((row) => ({ label: row.label, value: row.pro }))}
          action={
            <ComingSoonButton
              size="lg"
              className="w-full"
              reason="Pro checkout opens once pricing is final"
            >
              <Sparkles aria-hidden="true" />
              Upgrade to Pro
            </ComingSoonButton>
          }
        />
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Allowances are provisional while we finish cost testing. Reading, editing and downloading
        your existing exports never use AI questions.
      </p>
    </div>
  );
}

function PlanCard({
  name,
  price,
  terms,
  allowances,
  action,
  featured = false,
}: {
  name: string;
  price: ReactNode;
  terms: string;
  allowances: { label: string; value: string }[];
  action: ReactNode;
  featured?: boolean;
}) {
  return (
    <Card className={cn("gap-6 p-6 md:p-7", featured && "border-primary ring-2 ring-primary/25")}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{name}</h2>
          {featured ? (
            <Badge variant="highlight">
              <Sparkles aria-hidden="true" data-icon="inline-start" />
              More room
            </Badge>
          ) : null}
        </div>
        <div className="min-h-9">{price}</div>
        <p className="text-sm text-muted-foreground">{terms}</p>
      </div>
      <ul className="space-y-2.5 text-[0.9375rem]">
        {allowances.map((row) => (
          <li key={row.label} className="flex items-start gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            <span className="flex-1">{row.label}</span>
            <span className="font-semibold tabular-nums">{row.value}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto">{action}</div>
    </Card>
  );
}
