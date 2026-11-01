import { PageHeadingSkeleton, SplitSkeleton } from "@/components/foliomind/skeletons";

export default function PdfStudioLoading() {
  return (
    <div className="space-y-5">
      <PageHeadingSkeleton actions={2} />
      <SplitSkeleton rail="left" />
    </div>
  );
}
