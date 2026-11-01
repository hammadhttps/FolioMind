import { BookOpen } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/foliomind/empty-state";
import { PublicPage } from "@/components/foliomind/public-page";

export default function BookNotFound() {
  return (
    <PublicPage className="max-w-3xl py-16">
      <EmptyState
        icon={BookOpen}
        title="This book isn't available."
        description="It may not be published yet, or it was removed from the library."
        actions={
          <Button asChild variant="outline">
            <Link href="/library">Explore the library</Link>
          </Button>
        }
      />
    </PublicPage>
  );
}
