import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { firmMailFrom } from "./mail-config";

/**
 * The Settings status line for the emailed signing link (Sprint A item 8, v3 B3). The SCOPED client only: it never calls the
 * probe or any `signing_*` rpc and imports nothing from the admin client. In order:
 *   (a) the deployment switch is not exactly "on" -> `switch_off` (no read);
 *   (b) no `RESEND_API_KEY`, or no `FIRM_CLIENT_MAIL_FROM` entry for the session's firm -> `no_mail` (no read);
 *   (c) ONE scoped read of the firm's approved words (RLS fences it to the active firm): a missing table -> `not_set_up`; any
 *       other error -> `unreadable`; none -> `no_words`; one -> `on`.
 * `on` can be shown while 0117 is only partly applied (this reader cannot see that): the gate then sends clients in-app.
 */

export type WordsStatus = "switch_off" | "no_mail" | "not_set_up" | "no_words" | "unreadable" | "on";

export async function signingWordsStatus(
  orgId: string,
  db: SupabaseClient<Database>,
  env: { LOE_EMAIL_SIGNING?: string; RESEND_API_KEY?: string; FIRM_CLIENT_MAIL_FROM?: string; SITE_URL?: string } = process.env as Record<string, string | undefined>,
): Promise<WordsStatus> {
  if (env.LOE_EMAIL_SIGNING !== "on") return "switch_off";
  if (!env.RESEND_API_KEY || !env.RESEND_API_KEY.trim() || !firmMailFrom(orgId, env)) return "no_mail";
  try {
    const { data, error } = await db.from("client_proposal_signing_words").select("id").eq("status", "approved").limit(1);
    if (error) return error.code === "42P01" || error.code === "PGRST205" ? "not_set_up" : "unreadable";
    return Array.isArray(data) && data.length > 0 ? "on" : "no_words";
  } catch {
    return "unreadable";
  }
}
