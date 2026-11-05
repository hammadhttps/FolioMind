import { prepareChatTurn, runChatTurn } from "@foliomind/ai/chat";
import {
  CHAT_ERRORS,
  chatRequestSchema,
  ServiceNotConfiguredError,
  type ChatEvent,
} from "@foliomind/contracts";
import { after } from "next/server";
import { z } from "zod";
import { getChatDeps } from "@/lib/chat/deps";
import { withRateLimit } from "@/lib/rate-limit";
import { apiError, rejectCrossOrigin } from "@/lib/request-guard";
import { getFreshUser } from "@/lib/session";

/** Two minutes is far beyond one answer; Gemini's own request timeout is 60 seconds. */
export const maxDuration = 120;

const encoder = new TextEncoder();
const frame = (event: ChatEvent) =>
  encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

/**
 * `POST /api/chat` (blueprint Sections 8, 11 and 23): one question, answered as
 * a stream of server-sent events. Identity, rate limit, input, scope and quota
 * are settled first, so refusals are ordinary HTTP errors. After that the turn
 * always runs to its end: when the reader disconnects it is aborted, and saving
 * and releasing the reservation still happen.
 */
export const POST = withRateLimit("chat", async (request: Request) => {
  const refused = rejectCrossOrigin(request);
  if (refused) return refused;
  const user = await getFreshUser();
  if (!user) return apiError(401, "unauthenticated", CHAT_ERRORS.unauthenticated);
  if (user.status !== "active") {
    return apiError(403, "account_inactive", CHAT_ERRORS.account_inactive);
  }

  const body = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      {
        error: {
          code: "invalid",
          message: CHAT_ERRORS.invalid,
          fieldErrors: z.flattenError(body.error).fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  let deps: ReturnType<typeof getChatDeps>;
  try {
    deps = getChatDeps();
  } catch (error) {
    if (error instanceof ServiceNotConfiguredError) {
      return apiError(503, "unavailable", "AI answers aren't configured on this server.");
    }
    throw error;
  }

  const prepared = await prepareChatTurn(deps, user, body.data);
  if (!prepared.ok) {
    return Response.json(
      {
        error: {
          code: prepared.code,
          message: prepared.message,
          ...(prepared.allowance ? { allowance: prepared.allowance } : {}),
        },
      },
      { status: prepared.status },
    );
  }

  // The reader may already have pressed Stop during the checks above, and a plain
  // listener would never hear about that. `any` starts out aborted in that case.
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal]);
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(frame(event));
        } catch {
          closed = true;
          abort.abort();
        }
      };
      const pump = (async () => {
        try {
          for await (const event of runChatTurn(deps, prepared.turn, signal)) send(event);
        } catch (error) {
          // The turn handles its own failures; this is its cleanup failing too.
          console.error(
            JSON.stringify({
              source: "chat",
              event: "chat.turn_crashed",
              error: error instanceof Error ? error.name : "unknown",
            }),
          );
          send({ type: "error", code: "failed", message: CHAT_ERRORS.failed, retryable: true });
        } finally {
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      })();
      // Keeps the function alive for saving after a disconnect.
      after(() => pump);
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
