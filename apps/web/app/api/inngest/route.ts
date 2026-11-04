import { serve } from "@foliomind/workflows/next";
import { connection, type NextRequest } from "next/server";
import { createBackgroundFunctions, serveOrigin } from "@/lib/jobs/functions";

/*
 * Where Inngest runs FolioMind's background functions (blueprint Section 9; see
 * lib/jobs/functions.ts). In production the SDK rejects any request without
 * Inngest's signature, so this route needs no session or rate limit; the proxy
 * exempts it. Built on the first request, never during the build.
 */

// Hobby's limit. One request stops starting steps after 60 s, so it ends well before this.
export const maxDuration = 300;

let handlers: ReturnType<typeof serve> | undefined;
function getHandlers() {
  handlers ??= serve({ ...createBackgroundFunctions(), serveOrigin: serveOrigin() });
  return handlers;
}

export async function GET(request: NextRequest, context: unknown) {
  await connection();
  return getHandlers().GET(request, context);
}

export async function POST(request: NextRequest, context: unknown) {
  return getHandlers().POST(request, context);
}

export async function PUT(request: NextRequest, context: unknown) {
  return getHandlers().PUT(request, context);
}
