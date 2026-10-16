import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getAdminClient } from "@/lib/db/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { rootKeyOrNull } from "@/lib/mailbox/config";
import { zoomClientCredentials } from "@/lib/meetings/config";
import { runMeetingImports } from "@/lib/meetings/import";

export const maxDuration = 300;

/**
 * Daily (vercel.json): import new meetings for every ACTIVE Fathom / Zoom
 * connection, in every firm. Service role, and every write is stamped with
 * the org_id of the connection row being imported (src/lib/meetings/import.ts).
 * Fails closed without CRON_SECRET. The response carries counts only.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    return new NextResponse(null, { status: 401 });
  }
  const root = rootKeyOrNull();
  if (!root) return NextResponse.json({ ok: false, reason: "MAILBOX_TOKEN_KEY is not configured" }, { status: 503 });
  try {
    const summary = await runMeetingImports({ admin: getAdminClient(), root, zoomCreds: zoomClientCredentials() });
    return NextResponse.json({ ok: true, connections: summary.connections, succeeded: summary.ok, failed: summary.failed, inserted: summary.inserted });
  } catch {
    return NextResponse.json({ ok: false, reason: "connection read failed" }, { status: 500 });
  }
}
