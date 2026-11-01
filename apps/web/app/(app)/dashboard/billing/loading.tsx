import { PageHeadingSkeleton, PanelSkeleton } from "@/components/foliomind/skeletons";

export default function BillingLoading() {
  return (
    <div className="space-y-6">
      <PageHeadingSkeleton actions={0} />
      <div className="grid gap-5 lg:grid-cols-2">
        <PanelSkeleton lines={4} />
        <PanelSkeleton lines={5} />
      </div>
    </div>
  );
}
