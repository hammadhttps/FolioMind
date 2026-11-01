import { PageHeadingSkeleton, PanelSkeleton } from "@/components/foliomind/skeletons";

export default function PublishingLoading() {
  return (
    <div className="space-y-6">
      <PageHeadingSkeleton />
      <PanelSkeleton lines={2} />
      <PanelSkeleton lines={4} />
    </div>
  );
}
