import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveFirmSession } from "@/lib/firm/session";
import { streamMattersChatQuestion, type CopilotProgress } from "@/lib/agents/matters-chat";
import { aiConfigured } from "@/lib/ai/claude";
import { encodeSse, type CopilotStreamEvent } from "@/lib/copilot/sse";

export const runtime = "nodejs";

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
  // Earlier turns of the visible thread. Text only; the server trims it
  // (buildHistory) and nothing in it grants a read the caller doesn't have.
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) }))
    .max(50)
    .optional(),
  // The page the drawer is open on. Only the pathname is used: the record id is
  // parsed from it again on the server, and unknown fields are dropped.
  context: z
    .object({
      pathname: z.string().max(300),
      leadId: z.string().max(64).optional(),
      matterId: z.string().max(64).optional(),
    })
    .optional(),
});

const STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

const STREAM_FAILED = "Something went wrong answering that — try again.";

function toStreamEvent(ev: CopilotProgress): CopilotStreamEvent {
  switch (ev.type) {
    case "delta":
      return { event: "delta", data: { text: ev.text } };
    case "tool":
      return { event: "tool", data: { name: ev.name, label: ev.label, status: ev.status } };
    case "context":
      return { event: "context", data: { status: ev.status } };
  }
}

/**
 * The AI copilot's question-answering endpoint (/dashboard/copilot/ and the
 * drawer on every other dashboard page). Ported from lectual's home-page
 * "search your matters" copilot API route — see @/lib/agents/matters-chat for
 * the tool set, the UPL-firewall system prompt, and why every answer carries
 * citations.
 *
 * Answers over Server-Sent Events (@/lib/copilot/sse): `tool` status, `delta`
 * text as the model writes it, `context` (only when the drawer sent a lead or
 * matter page), then one closing `final` with the authoritative answer and its
 * citations, or an `error`. Everything that can be refused is refused as plain
 * JSON BEFORE the stream opens, with the same statuses as ever.
 *
 * Access is checked here (resolveFirmSession, the dashboard's own door) even
 * though getScopedClient() + RLS is the real tenant boundary for every read
 * the model can make (a caller with no firm would just get zero rows back,
 * never another org's data) — fail closed before spending a model call on a
 * request that has no firm workspace to read.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ask a question (1–2000 characters)." }, { status: 422 });
  }

  // The same door the dashboard layout opens: signed in is not enough. A
  // signed-in account with no firm (a founder, a revoked member) would
  // otherwise spend a model call to be told, wrongly, that the firm has no
  // matters — RLS would hand every tool an empty result.
  const session = await resolveFirmSession();
  if (session.kind === "signed-out") {
    return NextResponse.json({ error: "Sign in to use the copilot." }, { status: 401 });
  }
  if (session.kind === "no-access") {
    return NextResponse.json({ error: "You don't have access to a firm workspace." }, { status: 403 });
  }

  if (!aiConfigured()) {
    return NextResponse.json({ error: "The copilot isn't configured for this deployment yet." }, { status: 503 });
  }

  const { question, history, context } = parsed.data;
  const orgId = session.org.id;
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (ev: CopilotStreamEvent) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(ev)));
        } catch {
          cancelled = true;
        }
      };

      // Not awaited: the first frames must reach the browser while the model is
      // still writing, so `start` returns at once and this runs on its own.
      void (async () => {
        try {
          const result = await streamMattersChatQuestion({
            question,
            history,
            pathname: context?.pathname,
            orgId,
            onEvent: (ev) => send(toStreamEvent(ev)),
            shouldStop: () => cancelled,
          });
          send({ event: "final", data: result });
        } catch (err) {
          console.error("[matters-chat] failed to answer question", err);
          send({ event: "error", data: { message: STREAM_FAILED } });
        } finally {
          try {
            controller.close();
          } catch {
            // already closed by a disconnect
          }
        }
      })();
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, { status: 200, headers: STREAM_HEADERS });
}
