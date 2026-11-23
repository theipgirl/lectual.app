import type { NextRequest } from "next/server";
import { exitViewAs } from "@/lib/views/view-as-routes";

/** View as: Exit (a fixed path the proxy lets through; see src/lib/views/view-as-routes.ts). */
export async function POST(req: NextRequest) {
  return exitViewAs(req);
}
