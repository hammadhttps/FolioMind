import { Skeleton } from "@/components/ui/skeleton";
import {
  PageHeadingSkeleton,
  PanelSkeleton,
  TableSkeleton,
} from "@/components/foliomind/skeletons";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <PageHeadingSkeleton actions={2} />
      <Skeleton className="h-10 w-52" />
      <Skeleton className="h-56 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] 2xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <Skeleton className="h-52 rounded-xl" />
          <TableSkeleton rows={2} />
        </div>
        <PanelSkeleton />
      </div>
    </div>
  );
}
