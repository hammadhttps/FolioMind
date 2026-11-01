import { PublicPage } from "@/components/foliomind/public-page";
import {
  CoverGridSkeleton,
  PageHeadingSkeleton,
  PanelSkeleton,
} from "@/components/foliomind/skeletons";

export default function PublisherLoading() {
  return (
    <PublicPage className="space-y-6">
      <PageHeadingSkeleton />
      <PanelSkeleton lines={2} />
      <CoverGridSkeleton />
    </PublicPage>
  );
}
