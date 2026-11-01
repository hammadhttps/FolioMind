import type { ReactNode } from "react";
import { getSessionUser } from "@/lib/session";

/**
 * Renders `signedIn` or `signedOut` from the session. Reads request data, so
 * wrap it in <Suspense fallback={signedOut}> to keep the guest view prerendered.
 */
export async function SessionSwitch({
  signedIn,
  signedOut,
}: {
  signedIn: ReactNode;
  signedOut: ReactNode;
}) {
  const user = await getSessionUser();
  return <>{user ? signedIn : signedOut}</>;
}
