import { PageHeadingSkeleton, PanelSkeleton } from "@/components/foliomind/skeletons";

export default function AdminLoading() {
  return (
    <div className="space-y-6">
      <PageHeadingSkeleton actions={0} />
      <PanelSkeleton lines={4} />
    </div>
  );
}
