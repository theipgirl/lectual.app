import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getScopedClient } from "@/lib/db/scoped-client";
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
 * Auth is checked here even though getScopedClient() + RLS is the real
 * tenant boundary for every read the model can make (an unauthenticated
 * caller would just get zero rows back, never another org's data) — this is
 * the same defense-in-depth posture as the rest of the app: fail closed
 * before spending a model call on a request with no signed-in session.
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

  const supabase = await getScopedClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to use the copilot." }, { status: 401 });
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
