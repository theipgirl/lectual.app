import type { NextRequest } from "next/server";
import { enterViewAs } from "@/lib/views/view-as-routes";

/** View as: Enter (a fixed path the proxy lets through; see src/lib/views/view-as-routes.ts). */
export async function POST(req: NextRequest) {
  return enterViewAs(req);
}
