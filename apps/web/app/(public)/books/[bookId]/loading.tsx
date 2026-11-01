import { Skeleton } from "@/components/ui/skeleton";
import { PublicPage } from "@/components/foliomind/public-page";

export default function BookLoading() {
  return (
    <PublicPage className="space-y-6">
      <Skeleton className="h-8 w-44" />
      <div className="grid gap-8 md:grid-cols-[minmax(240px,360px)_minmax(0,1fr)] lg:gap-12">
        <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
        <div className="space-y-4">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-24 w-full max-w-2xl" />
          <div className="flex gap-3">
            <Skeleton className="h-11 w-40" />
            <Skeleton className="h-11 w-40" />
          </div>
        </div>
      </div>
    </PublicPage>
  );
}
