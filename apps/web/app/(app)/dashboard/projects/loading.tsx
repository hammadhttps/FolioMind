import { PageHeadingSkeleton, TableSkeleton } from "@/components/foliomind/skeletons";

export default function MyProjectsLoading() {
  return (
    <div className="space-y-6">
      <PageHeadingSkeleton />
      <TableSkeleton />
    </div>
  );
}
