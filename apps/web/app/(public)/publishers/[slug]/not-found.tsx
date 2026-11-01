import { Building2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/foliomind/empty-state";
import { PublicPage } from "@/components/foliomind/public-page";

export default function PublisherNotFound() {
  return (
    <PublicPage className="max-w-3xl py-16">
      <EmptyState
        icon={Building2}
        title="We couldn't find that publisher."
        description="The link may be incomplete, or the profile isn't public yet."
        actions={
          <Button asChild variant="outline">
            <Link href="/library">Explore the library</Link>
          </Button>
        }
      />
    </PublicPage>
  );
}
