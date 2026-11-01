import { Suspense } from "react";
import { AuthNotice } from "@/components/foliomind/auth-notice";
import { PublicFooter } from "@/components/foliomind/public-footer";
import { PublicHeader } from "@/components/foliomind/public-header";

/** Guest pages: public header and footer (blueprint Section 5). */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-svh flex-col">
      <PublicHeader />
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        {children}
      </main>
      <PublicFooter />
      <Suspense fallback={null}>
        <AuthNotice />
      </Suspense>
    </div>
  );
}
