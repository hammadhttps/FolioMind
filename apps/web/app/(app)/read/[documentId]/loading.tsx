import { PageHeadingSkeleton, SplitSkeleton } from "@/components/foliomind/skeletons";

export default function ReaderLoading() {
  return (
    <div className="space-y-5">
      <PageHeadingSkeleton actions={2} />
      <SplitSkeleton rail="right" />
    </div>
  );
}
