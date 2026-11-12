import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { LoeKindName } from "./kinds";
import { getApprovedLetter, type ApprovedRead } from "./templates-store";

/**
 * The signed-in person's firm's approved engagement letter of one kind, through their own scoped client (RLS: the active firm
 * only). Three-state and it NEVER throws: no session, a failed connection and a failed read are all `unavailable`, never
 * "no letter". For callers that hold no client of their own (Copilot's executor).
 */
export async function readApprovedLetterScoped(kind: LoeKindName): Promise<ApprovedRead> {
  try {
    return await getApprovedLetter(await getScopedClient(), kind);
  } catch {
    return { status: "unavailable" };
  }
}
