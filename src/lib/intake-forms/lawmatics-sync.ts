import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import { openToken } from "@/lib/mailbox/crypto";
import { rootKeyOrNull } from "@/lib/mailbox/config";
import { temperatureTagFor, type LawmaticsTemperature } from "@/lib/lawmatics/contact-payload";
import { attachTags, createProspect, updateProspect } from "@/lib/lawmatics/writes";
import { splitName } from "./public-submit";
import type { IntakeHandle } from "./public";
import type { IntakeContact } from "./submission";

/**
 * Every intake's person, pushed to the firm's OWN Lawmatics (lectual 0077),
 * tagged with where they came from (lectual 0095's markers record each step).
 *
 *   contact step   create the prospect, attach the intake's source tag
 *                  ("UGW 2026") → lawmatics_contact_id, lawmatics_synced_at
 *   completion     attach source tag + "Hot Lead"/"Warm Lead"/"Cold Lead" for
 *                  an assessment, and the answers as a note → lawmatics_tagged_at
 *
 * TAG STRINGS ARE CONTRACTS. The firm's Lawmatics automations (thank-you,
 * nurture) start off these names: the source tag verbatim as the firm typed
 * it, and the temperature tags from contact-payload.ts. Change neither without
 * the automation.
 *
 * ── WHOSE TOKEN ─────────────────────────────────────────────────────────────
 * The person filling in the intake has no session, so this runs as the service
 * role. The token is read for `handle.orgId`, the org of the form row the
 * public slug resolved, never from anything the browser sent, and only from an
 * ACTIVE connection. A firm that hasn't connected Lawmatics is skipped: its
 * leads are still in Lectual; the markers stay null.
 *
 * ── NEVER IN THE WAY ────────────────────────────────────────────────────────
 * Runs after the response (`after()`), never throws, and marks a step done only
 * when Lawmatics confirmed it. A null marker is the retry list.
 */

type Admin = ReturnType<typeof getAdminClient>;

export async function firmToken(admin: Admin, orgId: string): Promise<string | null> {
  const root = rootKeyOrNull();
  if (!root) return null;
  const { data, error } = await admin
    .from("lawmatics_connection")
    .select("token_enc, status")
    .eq("org_id", orgId)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data?.token_enc) return null;
  try {
    return openToken(root, data.token_enc);
  } catch {
    console.error("[intake→lawmatics] the firm's token couldn't be opened");
    return null;
  }
}

/** The tags a person from this intake carries; the temperature only once known. */
export function intakeTags(sourceTag: string | null, temperature?: LawmaticsTemperature | null): string[] {
  const tags: string[] = [];
  const src = (sourceTag ?? "").trim();
  if (src) tags.push(src);
  if (temperature) tags.push(temperatureTagFor(temperature));
  return tags;
}

/** Contact step: create the prospect and attach the source tag. */
export async function syncIntakeStart(handle: IntakeHandle, submissionId: string, contact: IntakeContact): Promise<void> {
  try {
    const admin = getAdminClient();
    const token = await firmToken(admin, handle.orgId);
    if (!token) return;
    const { first, last } = splitName(contact.name);
    const label = (handle.sourceTag ?? "").trim() || handle.name;
    const created = await createProspect(token, {
      firstName: first,
      lastName: last,
      email: contact.email,
      phone: contact.phone || null,
      companyName: contact.company || null,
      source: `Intake — ${label}`,
    });
    if (!created.ok) return;
    const tagged = await attachTags(token, created.contactId, intakeTags(handle.sourceTag));
    const { error } = await admin
      .from("crm_intake_submission")
      .update({
        // Kept even if tagging failed, so a retry tags this contact instead of creating another.
        lawmatics_contact_id: created.contactId,
        lawmatics_synced_at: tagged.ok ? new Date().toISOString() : null,
      })
      .eq("id", submissionId)
      .eq("org_id", handle.orgId)
      .eq("form_id", handle.formId);
    if (error) console.error("[intake→lawmatics] couldn't record the contact id", error.code);
  } catch (e) {
    console.error("[intake→lawmatics] start sync failed", e instanceof Error ? e.message : e);
  }
}

/**
 * Completion: the tags again (plus the temperature for an assessment) and the
 * answers as a note. Creates the prospect here if the contact step's push
 * never landed.
 */
export async function syncIntakeCompletion(
  handle: IntakeHandle,
  submissionId: string,
  input: { contact: IntakeContact; temperature?: LawmaticsTemperature | null; note: { name: string; body: string } },
): Promise<void> {
  try {
    const admin = getAdminClient();
    const token = await firmToken(admin, handle.orgId);
    if (!token) return;
    const { data: row, error } = await admin
      .from("crm_intake_submission")
      .select("lawmatics_contact_id")
      .eq("id", submissionId)
      .eq("org_id", handle.orgId)
      .eq("form_id", handle.formId)
      .maybeSingle();
    if (error || !row) return;

    let contactId = row.lawmatics_contact_id;
    if (!contactId) {
      const { first, last } = splitName(input.contact.name);
      const created = await createProspect(token, {
        firstName: first,
        lastName: last,
        email: input.contact.email,
        phone: input.contact.phone || null,
        companyName: input.contact.company || null,
        source: `Intake — ${(handle.sourceTag ?? "").trim() || handle.name}`,
      });
      if (!created.ok) return;
      contactId = created.contactId;
    }

    const tags = intakeTags(handle.sourceTag, input.temperature);
    const attached = await attachTags(token, contactId, tags);
    const updated = await updateProspect(token, contactId, { tags, notes: [input.note] });
    const now = new Date().toISOString();
    const landed = attached.ok || updated.ok;
    const { error: upErr } = await admin
      .from("crm_intake_submission")
      .update({
        lawmatics_contact_id: contactId,
        ...(landed ? { lawmatics_tagged_at: now } : {}),
        ...(landed && !row.lawmatics_contact_id ? { lawmatics_synced_at: now } : {}),
      })
      .eq("id", submissionId)
      .eq("org_id", handle.orgId)
      .eq("form_id", handle.formId);
    if (upErr) console.error("[intake→lawmatics] couldn't record the tags", upErr.code);
  } catch (e) {
    console.error("[intake→lawmatics] completion sync failed", e instanceof Error ? e.message : e);
  }
}
