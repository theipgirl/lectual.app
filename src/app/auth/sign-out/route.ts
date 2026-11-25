import type { NextRequest } from "next/server";
import { signOutRoute } from "@/lib/views/view-as-routes";

/** Sign out (a fixed path; ends any View as preview first). Replaces the old signOutAction. */
export async function POST(req: NextRequest) {
  return signOutRoute(req);
}
