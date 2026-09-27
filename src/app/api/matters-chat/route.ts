import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveFirmSession } from "@/lib/firm/session";
import { answerMattersChatQuestion } from "@/lib/agents/matters-chat";
import { AiNotConfiguredError } from "@/lib/ai/claude";

export const runtime = "nodejs";

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
});

/**
 * The AI copilot's question-answering endpoint (/dashboard/copilot/). Ported
 * from lectual's home-page "search your matters" copilot API route — see
 * @/lib/agents/matters-chat for the tool set, the UPL-firewall system
 * prompt, and why every answer carries citations.
 *
 * Access is checked here (resolveFirmSession, the dashboard's own door) even
 * though getScopedClient() + RLS is the real tenant boundary for every read
 * the model can make (a caller with no firm would just get zero rows back,
 * never another org's data) — fail closed before spending a model call on a
 * request that has no firm workspace to read.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
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

  try {
    const result = await answerMattersChatQuestion(parsed.data.question);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: "The copilot isn't configured for this deployment yet." }, { status: 503 });
    }
    console.error("[matters-chat] failed to answer question", err);
    return NextResponse.json({ error: "Something went wrong answering that — try again." }, { status: 500 });
  }
}
