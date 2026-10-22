"use server";

import { getScopedClient } from "@/lib/db/scoped-client";
import { buildTourMeta, isTourOutcome } from "./tour";

export type MarkTourSeenResult = { ok: true } | { ok: false; error: string };

const NOT_SAVED = "We couldn't save that you've seen the tour.";
const NOT_SIGNED_IN = "You are not signed in.";

/**
 * Records that the signed-in person has seen the tour, on their OWN account
 * (`user_metadata.lectual_tour`). The session's client is the only one used:
 * there is no user id or org id argument, and other metadata keys are kept.
 * The flag is a preference; nothing reads it to allow or deny anything.
 */
export async function markTourSeenAction(outcome: unknown): Promise<MarkTourSeenResult> {
  if (!isTourOutcome(outcome)) return { ok: false, error: NOT_SAVED };
  try {
    const supabase = await getScopedClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError) return { ok: false, error: NOT_SAVED };
    if (!user) return { ok: false, error: NOT_SIGNED_IN };

    const existing = (user.user_metadata ?? {}) as Record<string, unknown>;
    const { error } = await supabase.auth.updateUser({
      data: { ...existing, lectual_tour: buildTourMeta(outcome, new Date()) },
    });
    if (error) return { ok: false, error: NOT_SAVED };
    return { ok: true };
  } catch {
    return { ok: false, error: NOT_SAVED };
  }
}
