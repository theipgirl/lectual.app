import type { NextRequest } from "next/server";
import { handleCallback } from "@/lib/esign/routes";

/** Step two: the admin tier again, the state cookie, the host rule BEFORE the token POST, then the scoped write. */
export async function GET(req: NextRequest) {
  return handleCallback(req);
}
