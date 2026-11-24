import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { cronAuthorized } from "@/lib/cron-auth";
import { LAWMATICS_FULL_RUN_HOUR, NOT_THIS_HOUR, shouldRunNow } from "@/lib/cron/ny-hour";
import { runLawmaticsDailySync, WALL_BUDGET_MS } from "@/lib/lawmatics/daily-sync";
import { consultPrepAfterSync } from "@/lib/consult-prep/trigger";

export const maxDuration = 300;

/**
 * The Lawmatics daily sync (vercel.json: 4 AM, 12 PM and 4 PM New York, one EST/EDT pair per hour). The 4 AM tick
 * runs every step: hired matters (a matter for every person marked Hired in a firm's OWN Lawmatics), then new
 * prospects (leads), then booked consults (calendar rows). The daytime ticks run new prospects and consults only.
 * Service role, per active connection, every write stamped with that connection's org_id
 * (src/lib/lawmatics/daily-sync.ts). Reads Lawmatics only. Fails closed without CRON_SECRET. The response carries
 * counts only: never a name, an email, a title, a link or Lawmatics' own error text.
 *
 * The job id and the path keep their old name (`lawmatics-matters`) so the schedule and the guard stay one list.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    return new NextResponse(null, { status: 401 });
  }
  // Two vercel.json entries per hour (EST and EDT); only the tick in one of this job's New York hours works.
  const hour = shouldRunNow("lawmatics-matters", new Date());
  if (hour === null) return NextResponse.json(NOT_THIS_HOUR);
  const mode = hour === LAWMATICS_FULL_RUN_HOUR ? "full" : "daytime";
  try {
    const s = await runLawmaticsDailySync({ mode, budgetMs: WALL_BUDGET_MS, afterConsults: consultPrepAfterSync });
    return NextResponse.json({
      ok: true,
      mode: s.mode,
      connections: s.connections,
      failedFirms: s.failedFirms,
      reauthNeeded: s.reauthNeeded,
      outOfTime: s.outOfTime,
      failures: s.failures,
      // The hired step's counts, under the names this route has always answered with.
      created: s.hired.created,
      linked: s.hired.linked,
      skipped: s.hired.skipped,
      leadsMoved: s.hired.leadsMoved,
      leadMovesFailed: s.hired.leadMovesFailed,
      hired: s.hired,
      prospects: s.prospects,
      consults: s.consults,
      consultPrep: s.consultPrep,
    });
  } catch {
    return NextResponse.json({ ok: false, reason: "connection read failed" }, { status: 500 });
  }
}
