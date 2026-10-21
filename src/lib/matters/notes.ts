import { getScopedClient } from "@/lib/db/scoped-client";
import { noteEntry, validateNote, type NoteKind } from "@/lib/pipeline/lead-input";
import { logActivity } from "./activity";
import { requireMatterWriteRole } from "./matters";
import { recordNotFoundError } from "./not-found";

export type AddMatterNoteInput = {
  /** 'note' | 'call_logged' | 'email_sent' | 'meeting'. A meeting is stored as a `note` row tagged `entry: "meeting"`. */
  kind?: NoteKind | string | null;
  body?: string | null;
  /** Optional heading; used as the summary of a logged call or email. */
  subject?: string | null;
};

/**
 * Writes a human-authored entry onto a MATTER's timeline: a note, a logged call,
 * a logged email or a meeting. The matter-side twin of addLeadNote, with the
 * same kinds, validation and limits, and the same payload keys.
 *
 * Differences from the lead version, on purpose: a matter note raises no @mention
 * notification (those are keyed to a lead), and the row carries only the matter
 * id, so it bumps no lead's last touch.
 *
 * The matter id is resolved through the caller's scoped client first, so another
 * firm's matter is "not found" and nothing is written. The activity row IS the
 * mutation, so logActivity is called directly and a failed insert reaches the
 * person who typed the entry. Nothing is sent anywhere: a logged call or email
 * records something a person already did outside the product.
 */
export async function addMatterNote(matterId: string, input: AddMatterNoteInput): Promise<void> {
  const validated = validateNote({
    kind: typeof input.kind === "string" ? input.kind : "note",
    body: input.body,
    subject: input.subject,
  });
  if (!validated.ok) {
    throw new Error(Object.values(validated.fieldErrors)[0] ?? "Check the entry.");
  }

  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data: matter, error } = await supabase.from("crm_matter").select("id").eq("id", matterId).maybeSingle();
  if (error) throw error;
  if (!matter) throw recordNotFoundError("matter");

  const { kind, body, subject } = validated.value;
  const entry = noteEntry(kind, body, subject);
  await logActivity({ type: entry.type, matterId, actorType: "user", payload: entry.payload });
}
