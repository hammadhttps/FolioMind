"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { authNoticeMessage, signInErrorMessage } from "@/lib/auth/sign-in-errors";

/** Shows `?auth_notice=` / `?auth_error=` once as a toast, then removes them from the URL. */
export function AuthNotice() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const shown = useRef(false);

  const notice = searchParams.get("auth_notice");
  const error = searchParams.get("auth_error");

  useEffect(() => {
    if (shown.current || (!notice && !error)) return;
    shown.current = true;

    if (error) {
      toast.error(signInErrorMessage(error));
    } else if (notice) {
      const message = authNoticeMessage(notice);
      if (message) toast.info(message, { duration: 12_000 });
    }

    const remaining = new URLSearchParams(searchParams.toString());
    remaining.delete("auth_notice");
    remaining.delete("auth_error");
    const query = remaining.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [notice, error, pathname, router, searchParams]);

  return null;
}
