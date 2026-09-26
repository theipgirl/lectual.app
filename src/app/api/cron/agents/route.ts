import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { cronAuthorized } from "@/lib/cron-auth";
import { aiConfigured } from "@/lib/ai/claude";
import { runAllAgents } from "@/lib/agents/runner";
import { productionRunnerDeps } from "@/lib/agents/deps";

export const maxDuration = 300;

/**
 * Every 30 minutes (vercel.json): each enabled agent in each firm holding the
 * `agents` module. Counts only in the response; details are in agent_run.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    return new NextResponse(null, { status: 401 });
  }
  if (!aiConfigured()) {
    return NextResponse.json({ ok: false, reason: "ANTHROPIC_API_KEY is not configured" }, { status: 503 });
  }
  const outcomes = await runAllAgents(productionRunnerDeps());
  return NextResponse.json({
    ok: true,
    runs: outcomes.length,
    succeeded: outcomes.filter((o) => o.status === "ok").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "error").length,
  });
}
