import {
  CoverGridSkeleton,
  PageHeadingSkeleton,
  ToolbarSkeleton,
} from "@/components/foliomind/skeletons";

export default function MyLibraryLoading() {
  return (
    <div className="space-y-6">
      <PageHeadingSkeleton />
      <ToolbarSkeleton />
      <CoverGridSkeleton />
    </div>
  );
}
