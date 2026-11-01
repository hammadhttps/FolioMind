import { Skeleton } from "@/components/ui/skeleton";
import { PublicPage } from "@/components/foliomind/public-page";

export default function PricingLoading() {
  return (
    <PublicPage className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Skeleton className="h-[520px] rounded-xl" />
        <Skeleton className="h-[520px] rounded-xl" />
      </div>
    </PublicPage>
  );
}
