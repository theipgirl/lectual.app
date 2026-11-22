import type { NextRequest } from "next/server";
import { handleConnect } from "@/lib/esign/routes";

/** Step one of "Connect Adobe Acrobat Sign": admin tier only (checked here), a signed state cookie, then Adobe's own sign-in. */
export async function GET(req: NextRequest) {
  return handleConnect(req);
}
