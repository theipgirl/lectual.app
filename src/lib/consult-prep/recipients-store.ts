import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { Json } from "@/lib/db/types";
import { listMemberDirectory } from "@/lib/members/directory";
import { createBrainEntry, updateBrainEntry } from "@/lib/brain/entries";
import { canReceiveDeadlineAlerts } from "@/lib/today/deadline-alerts";
import { CONSULT_PREP_KEY, parseRecipientSetting } from "./recipients";

/**
 * Who gets the consult prep emails: a firm note (`crm_firm_brain_entry`, category `other`, key `consult_prep_recipients`,
 * `data = { user_ids, cc }`), read and written through the signed-in caller's scoped client (RLS keeps every row to the caller's
 * firm). No service role. The send path reads the same note with its own firm-fenced client (engine.ts).
 */

export type ConsultPrepSetting =
  | { status: "ok"; entryId: string | null; userIds: string[]; cc: string[] }
  | { status: "unavailable" };

/** The note and the member list (a removed member, or one now in a role that can't receive it, is dropped). Either failing = unavailable. */
export async function loadConsultPrepSetting(): Promise<ConsultPrepSetting> {
  try {
    const supabase = await getScopedClient();
    const [entryRes, members] = await Promise.all([
      supabase.from("crm_firm_brain_entry").select("id, data").eq("category", "other").eq("key", CONSULT_PREP_KEY).order("created_at").limit(1),
      listMemberDirectory(),
    ]);
    if (entryRes.error) return { status: "unavailable" };
    const entry = (entryRes.data ?? [])[0] ?? null;
    const stored = entry ? parseRecipientSetting(entry.data) : { userIds: [], cc: [] };
    const eligible = new Set(members.filter((m) => canReceiveDeadlineAlerts(m.role)).map((m) => m.userId.toLowerCase()));
    return { status: "ok", entryId: entry?.id ?? null, userIds: stored.userIds.filter((id) => eligible.has(id.toLowerCase())), cc: stored.cc };
  } catch {
    return { status: "unavailable" };
  }
}

/** Saves the setting (admin tier: `createBrainEntry` / `updateBrainEntry` re-check the role, and RLS is the boundary). The caller has already checked every id and address. */
export async function saveConsultPrepSetting(userIds: readonly string[], cc: readonly string[], entryId: string | null): Promise<void> {
  const data = { user_ids: [...new Set(userIds)], cc: [...new Set(cc)] } as unknown as Json;
  if (entryId) {
    await updateBrainEntry(entryId, { data });
    return;
  }
  await createBrainEntry({ category: "other", key: CONSULT_PREP_KEY, title: "Consult prep recipients", body: "", data });
}
