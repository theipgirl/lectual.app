"use server";

import { getScopedClient } from "@/lib/db/scoped-client";
import { deckSeenStamp, withDeckSeen } from "@/lib/deal/nudge";
import { parseDealTimes } from "@/lib/deal/person-times";
import { getFirmTimeZone } from "@/lib/org/profile";

export type MarkDeckSeenResult = { wrote: boolean };

/**
 * Stamps `user_metadata.lectual_deck_seen` on the signed-in person's OWN account, so the deal-ready dot clears once they
 * have opened the deck after a deal. Draw-only: it decides whether a dot is drawn, never what anyone may see or do. Same
 * pattern as saveDealTimesAction (session client, no user or org argument, every other metadata key kept). The gate is
 * decided HERE from the stored stamp, the person's own deal times and the clock (the browser sends nothing), and it writes
 * only when the current deal opened after the stored stamp. Fails quietly: any problem is `wrote: false`, nothing shown.
 * The deck page does not mount the caller for Lectual staff acting inside a firm.
 */
export async function markDeckSeenAction(): Promise<MarkDeckSeenResult> {
  try {
    const supabase = await getScopedClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return { wrote: false };
    const stamp = deckSeenStamp({ now: new Date(), timeZone: await getFirmTimeZone(), times: parseDealTimes(user.user_metadata), meta: user.user_metadata });
    if (!stamp) return { wrote: false };
    const { error } = await supabase.auth.updateUser({ data: withDeckSeen(user.user_metadata, stamp) });
    return { wrote: !error };
  } catch {
    return { wrote: false };
  }
}
