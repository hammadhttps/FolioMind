import { PublicPage } from "@/components/foliomind/public-page";
import {
  CoverGridSkeleton,
  PageHeadingSkeleton,
  ToolbarSkeleton,
} from "@/components/foliomind/skeletons";

export default function ExploreLoading() {
  return (
    <PublicPage className="space-y-6">
      <PageHeadingSkeleton />
      <ToolbarSkeleton />
      <CoverGridSkeleton />
    </PublicPage>
  );
}
