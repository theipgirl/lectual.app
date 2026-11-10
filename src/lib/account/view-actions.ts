"use server";

import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { prefAllowed, VIEW_PREF_KEY, viewPrefValue } from "@/lib/views";
import { VIEW_NOT_SAVED, VIEW_NOT_SIGNED_IN, VIEW_PREVIEW_NOT_ALLOWED } from "@/lib/ui/words";

export type SaveViewResult = { ok: true; pref: string } | { ok: false; error: string };

/**
 * Saves the signed-in person's view choice on their OWN account (`user_metadata.lectual_view`):
 * `technician` | `auto` | `as:<role>`. Same pattern as saveFullNameAction: the session's client only, no user or
 * org argument, every other metadata key kept, fixed sentences. A preview (`as:`) is refused for a person who may
 * not preview (canSwitchView, re-resolved here) and for a role whose view is not live. The choice decides only what
 * is drawn; every page and action keeps its own gate.
 */
export async function saveViewAction(input: unknown): Promise<SaveViewResult> {
  try {
    const session = await resolveFirmSession();
    if (session.kind === "signed-out") return { ok: false, error: VIEW_NOT_SIGNED_IN };
    if (session.kind !== "ok") return { ok: false, error: VIEW_NOT_SAVED };
    const pref = prefAllowed(input, session.role, session.actingAsStaff);
    if (!pref) {
      return { ok: false, error: typeof input === "string" && input.startsWith("as:") ? VIEW_PREVIEW_NOT_ALLOWED : VIEW_NOT_SAVED };
    }

    const supabase = await getScopedClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError) return { ok: false, error: VIEW_NOT_SAVED };
    if (!user) return { ok: false, error: VIEW_NOT_SIGNED_IN };
    const value = viewPrefValue(pref);
    const existing = (user.user_metadata ?? {}) as Record<string, unknown>;
    const { error } = await supabase.auth.updateUser({ data: { ...existing, [VIEW_PREF_KEY]: value } });
    if (error) return { ok: false, error: VIEW_NOT_SAVED };
    return { ok: true, pref: value };
  } catch {
    return { ok: false, error: VIEW_NOT_SAVED };
  }
}
