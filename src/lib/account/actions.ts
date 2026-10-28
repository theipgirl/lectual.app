"use server";

import { getScopedClient } from "@/lib/db/scoped-client";
import { NAME_MESSAGES, validateName } from "./name";

export type SaveNameResult = { ok: true; fullName: string } | { ok: false; error: string };

/**
 * Saves the signed-in person's name on their OWN account (`user_metadata.full_name`). Same pattern as
 * markTourSeenAction: the session's client only, no user or org argument, every other metadata key
 * kept, fixed sentences (a provider's message never reaches the screen).
 */
export async function saveFullNameAction(input: unknown): Promise<SaveNameResult> {
  const checked = validateName(input);
  if (!checked.ok) return checked;
  try {
    const supabase = await getScopedClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError) return { ok: false, error: NAME_MESSAGES.notSaved };
    if (!user) return { ok: false, error: NAME_MESSAGES.notSignedIn };
    const existing = (user.user_metadata ?? {}) as Record<string, unknown>;
    const { error } = await supabase.auth.updateUser({ data: { ...existing, full_name: checked.fullName } });
    if (error) return { ok: false, error: NAME_MESSAGES.notSaved };
    return { ok: true, fullName: checked.fullName };
  } catch {
    return { ok: false, error: NAME_MESSAGES.notSaved };
  }
}
