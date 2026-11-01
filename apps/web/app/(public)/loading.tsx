import { CoverGridSkeleton, PageHeadingSkeleton } from "@/components/foliomind/skeletons";

export default function PublicLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-8 px-[15px] py-6 sm:px-[18px] md:px-[25px] md:py-10 xl:px-9">
      <PageHeadingSkeleton />
      <CoverGridSkeleton />
    </div>
  );
}
