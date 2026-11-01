import { Skeleton } from "@/components/ui/skeleton";

/** Prerendered placeholder for the workspace shell while the session is read. */
export function AppShellSkeleton() {
  return (
    <div className="flex min-h-svh w-full" aria-busy="true" aria-label="Loading your workspace">
      <div className="hidden w-(--app-sidebar-width) shrink-0 flex-col gap-6 border-r bg-card px-[18px] pt-[29px] md:flex">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-11 w-full" />
        <div className="grid gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-[43px] w-full" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-16 items-center gap-3 border-b bg-card px-[15px] sm:px-[18px] md:h-[75px] md:px-[25px] xl:px-9">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="ml-auto size-9 rounded-full" />
        </div>
        <div className="mx-auto w-full max-w-[1600px] px-[15px] py-6 sm:px-[18px] md:px-[25px] md:py-8 xl:px-9">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="mt-3 h-5 w-96 max-w-full" />
          <Skeleton className="mt-8 h-48 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
