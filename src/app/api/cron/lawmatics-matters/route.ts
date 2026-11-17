import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { cronAuthorized } from "@/lib/cron-auth";
import { NOT_THIS_HOUR, shouldRunNow } from "@/lib/cron/ny-hour";
import { runHiredSync } from "@/lib/lawmatics/hired-sync";

export const maxDuration = 300;

/**
 * Daily (vercel.json): add a matter for every person marked Hired in a firm's OWN Lawmatics, and
 * link unlinked matters that are plainly the same one. Service role, per active connection, every
 * write stamped with that connection's org_id (src/lib/lawmatics/hired-sync.ts). Reads Lawmatics
 * only. Fails closed without CRON_SECRET. The response carries counts only.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    return new NextResponse(null, { status: 401 });
  }
  // Two vercel.json entries per job (EST and EDT); only the tick in this job's New York hour works.
  if (!shouldRunNow("lawmatics-matters", new Date())) return NextResponse.json(NOT_THIS_HOUR);
  try {
    const s = await runHiredSync();
    return NextResponse.json({
      ok: true,
      connections: s.connections,
      created: s.created,
      linked: s.linked,
      skipped: s.skipped,
      failedFirms: s.failedFirms,
      leadsMoved: s.leadsMoved,
      leadMovesFailed: s.leadMovesFailed,
    });
  } catch {
    return NextResponse.json({ ok: false, reason: "connection read failed" }, { status: 500 });
  }
}
