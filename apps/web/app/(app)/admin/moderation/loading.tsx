import { PageHeadingSkeleton, TableSkeleton } from "@/components/foliomind/skeletons";

export default function ModerationLoading() {
  return (
    <div className="space-y-6">
      <PageHeadingSkeleton actions={0} />
      <TableSkeleton />
    </div>
  );
}
