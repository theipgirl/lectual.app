"use server";

import { getScopedClient } from "@/lib/db/scoped-client";
import { validateDealTimes, withDealTimes, type DealTimesPair } from "@/lib/deal/person-times";
import { DEAL_TIMES_NOT_SAVED, DEAL_TIMES_NOT_SIGNED_IN } from "@/lib/ui/words";

export type SaveDealTimesResult = { ok: true; times: DealTimesPair } | { ok: false; error: string };

/**
 * Saves the signed-in person's two deal times on their OWN account (`user_metadata.lectual_deal_times`). Same pattern as
 * saveFullNameAction: the session's client only, no user or org argument, every other metadata key kept, fixed sentences.
 * It decides only when the deck is dealt to this person. The input is checked again here (the browser is not trusted).
 */
export async function saveDealTimesAction(input: unknown): Promise<SaveDealTimesResult> {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>).times : null;
  const checked = Array.isArray(raw) && raw.length === 2 ? validateDealTimes(raw[0], raw[1]) : validateDealTimes(null, null);
  if (!checked.ok) return checked;
  try {
    const supabase = await getScopedClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError) return { ok: false, error: DEAL_TIMES_NOT_SAVED };
    if (!user) return { ok: false, error: DEAL_TIMES_NOT_SIGNED_IN };
    const { error } = await supabase.auth.updateUser({ data: withDealTimes(user.user_metadata, checked.times) });
    if (error) return { ok: false, error: DEAL_TIMES_NOT_SAVED };
    return { ok: true, times: checked.times };
  } catch {
    return { ok: false, error: DEAL_TIMES_NOT_SAVED };
  }
}
