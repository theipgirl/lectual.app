"use server";

import { previewSafe } from "@/lib/views/preview-safe";
import { revalidatePath } from "next/cache";
import { friendlyLeadWriteError } from "@/app/dashboard/leads/errors";
import { getScopedClient } from "@/lib/db/scoped-client";
import { keeperForWrite, resolveLeadId } from "@/lib/leads/live";
import { validateLeadEdit } from "@/lib/pipeline/lead-input";
import { CAN_WRITE_LEAD, resolveCurrentRole, updateLead } from "@/lib/pipeline/leads";
import { applyTag, removeTag } from "@/lib/pipeline/tags";
import {
  LEAD_MERGED_WRITE,
  MERGE_POINTER_UNREADABLE,
  RECORD_CARD_CHECK_FIELDS,
  RECORD_CARD_GONE,
  RECORD_CARD_NAME_CHARS,
  RECORD_CARD_NO_PERMISSION,
  RECORD_CARD_RENAME_FAILED,
  RECORD_CARD_RENAME_NOTHING,
  RECORD_CARD_TAG_ADD_FAILED,
  RECORD_CARD_TAG_ALREADY,
  RECORD_CARD_TAG_CHOOSE,
  RECORD_CARD_TAG_NOT_FIRM,
  RECORD_CARD_TAG_NOT_ON,
  RECORD_CARD_TAG_REMOVE_FAILED,
} from "@/lib/ui/words";

/**
 * The two NEW card actions (Sprint 10). Every other card edit calls an action that already exists (the edit-to-action
 * table in docs/pge/2026-11-17-agentic-ip-os/sprint-10.md). Both: role re-resolved FIRST on every call, scoped client
 * only (no service role), a merged lead followed to its keeper, fixed sentences only (no raw error text), nothing sent.
 */

export type CardActionState = { saved?: true; error?: string; fieldErrors?: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Control characters and bidi overrides / isolates. Refused in a card's rename ONLY: `validateLeadEdit` is shared by every
 * lead form and is deliberately left as it is.
 */
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

/** The ONLY fields a card's inline rename may post. Email, phone and website are never read here, so they can't be blanked. */
const RENAME_FIELDS = ["firstName", "lastName", "businessName"] as const;

async function mayWriteLead(): Promise<boolean> {
  const db = await getScopedClient();
  const role = await resolveCurrentRole(db);
  return CAN_WRITE_LEAD.includes(role);
}

function refresh(leadId: string) {
  revalidatePath("/dashboard/intake/");
  revalidatePath(`/dashboard/leads/${leadId}/`);
  // The Weekly review opens the same card.
  revalidatePath("/dashboard/review/");
}

/**
 * The card's inline name / business edit. `editLeadAction` posts EVERY editable field, so an inline edit through it
 * would blank the email, phone and website; this passes ONLY `first_name`, `last_name` and `business_name` (those that
 * were posted) to `updateLead`, the partial patch, which re-checks the role, re-validates and logs `lead_updated`.
 */
export const renameLeadAction = previewSafe(async function renameLeadAction(_prev: CardActionState, formData: FormData): Promise<CardActionState> {
  const leadId = String(formData.get("leadId") ?? "").trim();
  try {
    if (!(await mayWriteLead())) return { error: RECORD_CARD_NO_PERMISSION };
  } catch {
    return { error: RECORD_CARD_NO_PERMISSION };
  }
  if (!UUID.test(leadId)) return { error: RECORD_CARD_GONE };

  const values: Partial<Record<(typeof RENAME_FIELDS)[number], string>> = {};
  for (const field of RENAME_FIELDS) if (formData.has(field)) values[field] = String(formData.get(field) ?? "");
  if (Object.keys(values).length === 0) return { error: RECORD_CARD_RENAME_NOTHING };
  const unsafe: Record<string, string> = {};
  for (const [field, value] of Object.entries(values)) if (UNSAFE_NAME_CHARS.test(value ?? "")) unsafe[field] = RECORD_CARD_NAME_CHARS;
  if (Object.keys(unsafe).length > 0) return { error: RECORD_CARD_CHECK_FIELDS, fieldErrors: unsafe };
  const validated = validateLeadEdit(values);
  if (!validated.ok) return { error: RECORD_CARD_CHECK_FIELDS, fieldErrors: validated.fieldErrors as Record<string, string> };

  try {
    // A rename does NOT follow a merge to the keeper: a card opened before the merge would overwrite the name or
    // business the person chose when merging. A merged id is refused with the merge sentence; nothing is written.
    let followed: Awaited<ReturnType<typeof resolveLeadId>>;
    try {
      followed = await resolveLeadId(await getScopedClient(), leadId);
    } catch {
      return { error: MERGE_POINTER_UNREADABLE };
    }
    if (followed.status === "not-found") return { error: RECORD_CARD_GONE };
    if (followed.status !== "ok") return { error: MERGE_POINTER_UNREADABLE };
    if (followed.id.toLowerCase() !== leadId.toLowerCase()) return { error: LEAD_MERGED_WRITE };
    // 0107's guard still refuses a write to a lead merged since; friendlyLeadWriteError maps that to LEAD_MERGED_WRITE.
    await updateLead(leadId, values);
  } catch (err) {
    return { error: friendlyLeadWriteError(err, RECORD_CARD_RENAME_FAILED) };
  }
  refresh(leadId);
  return { saved: true };
}, "state");

/**
 * Adds or removes one of the firm's tags on a lead. The same data-layer calls as the lead page's `applyTagAction` /
 * `removeTagAction` (`applyTag` / `removeTag`), with the same role list, but answering `{ saved: true }` so the card can
 * show "Saved" from the action's own result (those answer `{}`). The tag is read through the scoped client first: one
 * that isn't the firm's reads as missing and nothing is written.
 */
export const cardTagAction = previewSafe(async function cardTagAction(_prev: CardActionState, formData: FormData): Promise<CardActionState> {
  const leadId = String(formData.get("leadId") ?? "").trim();
  const tagId = String(formData.get("tagId") ?? "").trim();
  const op = String(formData.get("op") ?? "");
  try {
    if (!(await mayWriteLead())) return { error: RECORD_CARD_NO_PERMISSION };
  } catch {
    return { error: RECORD_CARD_NO_PERMISSION };
  }
  if (!UUID.test(leadId)) return { error: RECORD_CARD_GONE };
  if (!UUID.test(tagId) || (op !== "add" && op !== "remove")) return { error: RECORD_CARD_TAG_CHOOSE };
  const failed = op === "add" ? RECORD_CARD_TAG_ADD_FAILED : RECORD_CARD_TAG_REMOVE_FAILED;

  let lead = leadId;
  try {
    const db = await getScopedClient();
    const { data: tag, error } = await db.from("crm_tag").select("id").eq("id", tagId).maybeSingle();
    if (error) return { error: failed };
    if (!tag) return { error: RECORD_CARD_TAG_NOT_FIRM };
    try {
      lead = await keeperForWrite(db, leadId);
    } catch {
      return { error: MERGE_POINTER_UNREADABLE };
    }
    // The lead itself must be visible to the caller: another firm's (or a missing) lead reads as gone.
    // live-guard: a merged lead id was followed to its keeper by keeperForWrite just above
    const { data: found, error: leadErr } = await db.from("crm_lead").select("id").eq("id", lead).maybeSingle();
    if (leadErr) return { error: failed };
    if (!found) return { error: RECORD_CARD_GONE };
    if (op === "add") await applyTag(lead, tagId, { source: "human" });
    else {
      // Nothing to remove is not "Saved", and must not log a tag_removed row.
      const { data: link, error: linkErr } = await db.from("crm_lead_tag").select("tag_id").eq("lead_id", lead).eq("tag_id", tagId).maybeSingle();
      if (linkErr) return { error: failed };
      if (!link) return { error: RECORD_CARD_TAG_NOT_ON };
      await removeTag(lead, tagId);
    }
  } catch (err) {
    // Adding a tag that is already there is the unique index answering, not a failure a person can fix.
    if (op === "add" && (err as { code?: unknown } | null)?.code === "23505") return { error: RECORD_CARD_TAG_ALREADY };
    return { error: friendlyLeadWriteError(err, failed) };
  }
  refresh(lead);
  return { saved: true };
}, "state");
