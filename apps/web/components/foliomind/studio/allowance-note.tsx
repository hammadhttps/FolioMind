import type { GenerationCharge, ProjectAllowance } from "@foliomind/contracts";
import Link from "next/link";

/**
 * What the next step will spend, before it's spent (Section 6 step 9). When an
 * allowance has run out it says so, with where to go next.
 */
export function AllowanceNote({
  charge,
  allowance,
}: {
  charge: GenerationCharge | "reexport";
  allowance: ProjectAllowance;
}) {
  if (charge === "none") {
    return <p className="text-sm text-muted-foreground">Included with this project.</p>;
  }
  const { label, usage } =
    charge === "project"
      ? { label: "generated project", usage: allowance.projects }
      : charge === "regeneration"
        ? { label: "regeneration", usage: allowance.regenerations }
        : { label: "re-export", usage: allowance.reexports };
  if (usage.used >= usage.limit) {
    return (
      <p className="text-sm text-error" role="status">
        You&apos;ve used all {usage.limit} {label}s for this month.{" "}
        <Link href="/pricing" className="underline underline-offset-2">
          Compare plans
        </Link>
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      Uses 1 of your {usage.limit} {label}s this month. You&apos;ve used {usage.used}.
    </p>
  );
}
