import type { PlanLimits } from "@foliomind/contracts";
import { Check, FlaskConical, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { UpgradeButton } from "../billing/upgrade-button";
import { ComingSoonButton } from "../coming-soon";
import { PageHeading } from "../page-heading";
import { SignInDialog } from "../sign-in-dialog";
import { StatusAlert } from "../status-alert";

const MIB = 1024 * 1024;
const bytes = (value: number) =>
  value >= 1024 * MIB ? `${value / (1024 * MIB)} GiB` : `${Math.round(value / MIB)} MiB`;

/** The Section 10 allowances, read from the `plans` rows. */
function allowanceRows(limits: PlanLimits) {
  return [
    { label: "Owned source PDFs", value: String(limits.ownedSourcePdfs) },
    { label: "Storage, including exports", value: bytes(limits.storageBytes) },
    { label: "AI questions per month", value: String(limits.aiQuestionsPerMonth) },
    { label: "Generated PDF projects per month", value: String(limits.generatedProjectsPerMonth) },
    { label: "Sources per research workspace", value: String(limits.workspaceSourcesMax) },
    {
      label: "Section regenerations per month",
      value: String(limits.sectionRegenerationsPerMonth),
    },
    { label: "Re-exports of edited content per month", value: String(limits.reexportsPerMonth) },
    { label: "Web article imports per month", value: String(limits.urlImportsPerMonth) },
  ];
}

export interface PricingData {
  limits: { free: PlanLimits; pro: PlanLimits };
  /** "$9 / month" from Stripe, or null while no price is configured. */
  priceLabel: string | null;
  sandbox: boolean;
  viewer: { signedIn: boolean; planCode: "free" | "pro" | null };
  checkoutCancelled?: boolean;
}

/**
 * Pricing (Sections 5 row 5 and 20 #5): Free and an emphasized Pro with
 * allowances from the plans table and the price as Stripe has it. Without a
 * configured price the button stays unavailable. While Stripe runs in test
 * mode the page says so: no real charges are made.
 */
export function PricingScreen({ data, freeAction }: { data: PricingData; freeAction: ReactNode }) {
  const { viewer } = data;
  const isPro = viewer.planCode === "pro";
  let proAction: ReactNode;
  if (!data.priceLabel) {
    proAction = (
      <ComingSoonButton
        size="lg"
        className="w-full"
        reason="Pro checkout opens once pricing is final"
      >
        <Sparkles aria-hidden="true" />
        Upgrade to Pro
      </ComingSoonButton>
    );
  } else if (!viewer.signedIn) {
    proAction = (
      <SignInDialog returnTo="/pricing">
        <Button size="lg" className="w-full">
          <Sparkles aria-hidden="true" />
          Upgrade to Pro
        </Button>
      </SignInDialog>
    );
  } else if (isPro) {
    proAction = (
      <Button asChild size="lg" variant="outline" className="w-full">
        <Link href="/dashboard/billing">Manage your plan</Link>
      </Button>
    );
  } else {
    proAction = <UpgradeButton className="w-full" />;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <PageHeading
        className="text-center sm:flex-col sm:items-center"
        title="Plans for every kind of reader."
        description="Start free. Move to Pro when you need more sources, questions and projects."
      />

      {data.sandbox && data.priceLabel ? (
        <StatusAlert tone="info" title="Test mode: no real charges">
          Payments run in Stripe&apos;s test mode while FolioMind is in preview. Use a Stripe test
          card such as 4242 4242 4242 4242 with any future date and any CVC.
        </StatusAlert>
      ) : null}
      {data.checkoutCancelled ? (
        <StatusAlert tone="info" title="Checkout cancelled">
          Nothing was charged. You can upgrade whenever you&apos;re ready.
        </StatusAlert>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <PlanCard
          name="FolioMind Free"
          current={viewer.signedIn && !isPro}
          price={<span className="text-3xl font-semibold">Free</span>}
          terms="No card required."
          allowances={allowanceRows(data.limits.free)}
          action={freeAction}
        />
        <PlanCard
          featured
          current={isPro}
          name="FolioMind Pro"
          price={
            data.priceLabel ? (
              <span className="text-3xl font-semibold">{data.priceLabel}</span>
            ) : (
              <span className="text-lg font-semibold">Launch pricing is being finalized.</span>
            )
          }
          terms="Billed monthly. Cancel any time; access continues until the end of the paid period."
          allowances={allowanceRows(data.limits.pro)}
          action={proAction}
          badge={
            data.sandbox && data.priceLabel ? (
              <Badge variant="info">
                <FlaskConical aria-hidden="true" data-icon="inline-start" />
                Test mode
              </Badge>
            ) : null
          }
        />
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Allowances are provisional while we finish cost testing. Reading, editing and downloading
        your existing exports never use AI questions. After a downgrade, everything you made stays
        readable and downloadable; new work fits the Free allowances.
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
  current = false,
  badge,
}: {
  name: string;
  price: ReactNode;
  terms: string;
  allowances: { label: string; value: string }[];
  action: ReactNode;
  featured?: boolean;
  current?: boolean;
  badge?: ReactNode;
}) {
  return (
    <Card className={cn("gap-6 p-6 md:p-7", featured && "border-primary ring-2 ring-primary/25")}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">{name}</h2>
          <div className="flex flex-wrap gap-2">
            {current ? <Badge variant="success">Your plan</Badge> : null}
            {badge}
            {featured && !current ? (
              <Badge variant="highlight">
                <Sparkles aria-hidden="true" data-icon="inline-start" />
                More room
              </Badge>
            ) : null}
          </div>
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
