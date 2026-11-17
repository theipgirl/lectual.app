import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { parseDealTimes, type DealTimesPair } from "@/lib/deal/person-times";

/**
 * The signed-in person's deal times, read from their OWN account on the server (never from a form or a URL). Unreadable
 * reads as the defaults: this only decides when the deck is dealt, never who may approve.
 */
export async function readMyDealTimes(): Promise<DealTimesPair> {
  try {
    const supabase = await getScopedClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return parseDealTimes(user?.user_metadata);
  } catch {
    return parseDealTimes(null);
  }
}
