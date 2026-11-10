"use server";

import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { canSwitchView, prefAllowed, VIEW_PREVIEW_KEY, viewPrefValue, withPreview } from "@/lib/views";
import { VIEW_NOT_SAVED, VIEW_NOT_SIGNED_IN, VIEW_PREVIEW_NOT_ALLOWED } from "@/lib/ui/words";

export type SaveViewResult = { ok: true; pref: string } | { ok: false; error: string };

/**
 * Saves a Lectual staff member's preview for the firm they are standing in, on their OWN account:
 * `user_metadata.lectual_view_preview[<org id>] = "as:<role>"` (`technician` removes that firm's entry). The firm
 * comes from the session (resolveFirmSession, which asks the database whether the caller is platform staff), never
 * from the browser. Refused for every firm member (owner included) and for staff in a firm without role views.
 * Same pattern as saveFullNameAction: the session's client only, every other metadata key kept, fixed sentences.
 * The preview decides only what is drawn; every page and action keeps its own gate.
 */
export async function saveViewAction(input: unknown): Promise<SaveViewResult> {
  try {
    const session = await resolveFirmSession();
    if (session.kind === "signed-out") return { ok: false, error: VIEW_NOT_SIGNED_IN };
    if (session.kind !== "ok") return { ok: false, error: VIEW_NOT_SAVED };
    const firmHasRoleViews = (session.org.modules ?? []).includes("role-views");
    if (!canSwitchView({ actingAsStaff: session.actingAsStaff, firmHasRoleViews })) return { ok: false, error: VIEW_PREVIEW_NOT_ALLOWED };
    const pref = prefAllowed(input);
    if (!pref) return { ok: false, error: VIEW_NOT_SAVED };

    const supabase = await getScopedClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError) return { ok: false, error: VIEW_NOT_SAVED };
    if (!user) return { ok: false, error: VIEW_NOT_SIGNED_IN };
    // The session and this read are the same signed-in person; a mismatch means something changed under us.
    if (user.id !== session.user.id) return { ok: false, error: VIEW_NOT_SAVED };
    const existing = (user.user_metadata ?? {}) as Record<string, unknown>;
    const map = withPreview(existing[VIEW_PREVIEW_KEY], session.org.id, pref);
    const { error } = await supabase.auth.updateUser({ data: { ...existing, [VIEW_PREVIEW_KEY]: map } });
    if (error) return { ok: false, error: VIEW_NOT_SAVED };
    return { ok: true, pref: viewPrefValue(pref) };
  } catch {
    return { ok: false, error: VIEW_NOT_SAVED };
  }
}
