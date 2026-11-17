"use server";

import { getScopedClient } from "@/lib/db/scoped-client";
import { deckSeenStamp, withDeckSeen } from "@/lib/deal/nudge";
import { parseDealTimes } from "@/lib/deal/person-times";
import { resolveFirmSession } from "@/lib/firm/session";
import { orgHasModule } from "@/lib/org/modules";
import { getFirmTimeZone } from "@/lib/org/profile";

export type MarkDeckSeenResult = { wrote: boolean };

/**
 * Stamps `user_metadata.lectual_deck_seen` on the signed-in person's OWN account, so the deal-ready dot clears once they
 * have opened the deck after a deal. Draw-only: it decides whether a dot is drawn, never what anyone may see or do. Same
 * pattern as saveDealTimesAction (session client, no user or org argument, every other metadata key kept). The gate is
 * decided HERE from the stored stamp, the person's own deal times and the clock (the browser sends nothing), and it writes
 * only when the current deal opened after the stored stamp. Fails quietly: any problem is `wrote: false`, nothing shown.
 * Refused for Lectual staff acting inside a firm and for a firm without `role-views`.
 */
export async function markDeckSeenAction(): Promise<MarkDeckSeenResult> {
  try {
    // Refused on the server, not only by what the page mounts: an ok firm session, never Lectual staff acting inside a firm,
    // and only a firm with the `role-views` rollout switch (the deck, and so the dot, exist only there).
    const session = await resolveFirmSession();
    if (session.kind !== "ok" || session.actingAsStaff) return { wrote: false };
    if (!(await orgHasModule("role-views"))) return { wrote: false };
    const user = session.user;
    const supabase = await getScopedClient();
    const stamp = deckSeenStamp({ now: new Date(), timeZone: await getFirmTimeZone(), times: parseDealTimes(user.user_metadata), meta: user.user_metadata });
    if (!stamp) return { wrote: false };
    const { error } = await supabase.auth.updateUser({ data: withDeckSeen(user.user_metadata, stamp) });
    return { wrote: !error };
  } catch {
    return { wrote: false };
  }
}
