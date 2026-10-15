import { STOP_REASON_LABEL, type StopReason } from "./stops";
import { rowsOf, str, type StopDb } from "./stop-db";

/**
 * Sequence stops — the write half (the rules are in ./stops.ts).
 *
 * Every path that records a stop fact calls one of these AT THE MOMENT IT
 * RECORDS THE FACT (SOP rule 1):
 *
 *   the client signs on /q/[token]       acceptPublicQuote            signed
 *   a card payment succeeds on /q         payAcceptedQuote             paid
 *   staff record or reconcile a payment   quote-payments.ts            paid
 *   a lead moves to a won stage           moveLeadStage                client
 *   a matter is opened for a lead         createMatter                 matter_opened
 *   an inbound email matches a lead       mailbox applyRun             replied
 *   staff link a recorded call to a lead  linkMeetingAction            booked
 *   staff press "Stop sequence"           stopEnrollmentAction         manual / …
 *
 * and advance() re-reads the same facts before every step, so a path that
 * recorded a fact without calling here (a Lawmatics import, lectual's own
 * dashboard) still cannot produce a draft.
 *
 * ── FENCING ─────────────────────────────────────────────────────────────────
 * `orgId` is ALWAYS the org of the row that recorded the fact — the quote the
 * token resolved, the payment's quote read through RLS, the lead row, the
 * mailbox connection — never a value a caller sent. Every statement carries
 * `org_id = orgId`, which is what makes the service-role use legitimate
 * (AGENTS.md), and under the scoped client RLS (crm_drip_enrollment_*_staff)
 * holds as well.
 *
 * ── NEVER FAILS THE THING THAT RECORDED THE FACT ────────────────────────────
 * A signature, a payment or a stage move is already durable when this runs.
 * Nothing here throws; a failure comes back as `failed` and is logged. The
 * advance() guard is the backstop that still stops the sequence later.
 *
 * No `server-only` marker: this module constructs no client and reads no
 * secret (the caller hands it one), and the mailbox sync that imports it is
 * itself reachable from a client bundle's type graph.
 *
 * The status update is a single set-based statement over `active` / `paused`
 * rows only, so it is idempotent and a stop never overwrites a completed or
 * already-stopped enrollment. The 0085 trigger stamps stopped_at / stopped_by
 * from the server clock and the session, and makes the stop final.
 */

export type StopActor = { type: "user" | "system"; id?: string | null };

export type StopInput = {
  orgId: string;
  leadIds: readonly string[];
  reason: StopReason;
  actor: StopActor;
  /** When the fact itself happened (the signature, the payment, the reply). */
  factAt?: string | null;
  /** What proves it, for the timeline: quote_id, payment_id, meeting_id, message_id… */
  evidence?: Record<string, unknown>;
  /** Only stop enrollments that began before this instant — a reply or a call
   * answers the sequences already running, not one started afterwards. */
  enrolledBefore?: string | null;
  /** Only these enrollments (a person stopping one sequence by hand). */
  enrollmentIds?: readonly string[];
  now?: Date;
};

export type StoppedEnrollment = { enrollmentId: string; leadId: string; sequenceId: string; sequenceName: string | null };
export type StopOutcome = { status: "ok"; stopped: StoppedEnrollment[] } | { status: "failed"; error: string };

export async function stopLeadSequences(db: StopDb, input: StopInput): Promise<StopOutcome> {
  const leadIds = [...new Set(input.leadIds.filter(Boolean))];
  if (leadIds.length === 0) return { status: "ok", stopped: [] };
  const nowIso = (input.now ?? new Date()).toISOString();

  try {
    let q = db
      .from("crm_drip_enrollment")
      .update({ status: "stopped", stop_reason: input.reason, stopped_at: nowIso, next_step_at: null })
      .eq("org_id", input.orgId)
      .in("lead_id", leadIds)
      .in("status", ["active", "paused"]);
    if (input.enrolledBefore) q = q.lt("enrolled_at", input.enrolledBefore);
    if (input.enrollmentIds) q = q.in("id", input.enrollmentIds);
    const { data, error } = await q.select("id, lead_id, sequence_id");
    if (error) {
      console.error(`[campaigns] sequence stop (${input.reason}) failed`, error.code ?? error.message);
      return { status: "failed", error: error.message ?? "update failed" };
    }
    const rows = rowsOf(data);
    if (rows.length === 0) return { status: "ok", stopped: [] };

    const sequenceIds = [...new Set(rows.map((r) => str(r.sequence_id)).filter((v): v is string => !!v))];
    const names = new Map<string, string>();
    try {
      const { data: seqs } = await db.from("crm_drip_sequence").select("id, name").eq("org_id", input.orgId).in("id", sequenceIds);
      for (const s of rowsOf(seqs)) if (str(s.id) && str(s.name)) names.set(s.id as string, s.name as string);
    } catch {
      // Names are for the timeline's readability only.
    }

    const stopped: StoppedEnrollment[] = rows.map((r) => ({
      enrollmentId: String(r.id),
      leadId: String(r.lead_id),
      sequenceId: String(r.sequence_id),
      sequenceName: names.get(String(r.sequence_id)) ?? null,
    }));

    // The timeline names the reason. Best effort: the stop itself is the record.
    const activity = stopped.map((s) => ({
      org_id: input.orgId,
      lead_id: s.leadId,
      type: "drip_stopped",
      actor_type: input.actor.type,
      actor_id: input.actor.type === "user" ? (input.actor.id ?? null) : null,
      payload: {
        enrollment_id: s.enrollmentId,
        sequence_id: s.sequenceId,
        sequence_name: s.sequenceName,
        reason: input.reason,
        summary: `Sequence stopped — ${STOP_REASON_LABEL[input.reason]}`,
        fact_at: input.factAt ?? null,
        ...(input.evidence ?? {}),
      },
    }));
    try {
      const { error: actError } = await db.from("crm_activity").insert(activity);
      if (actError) console.error("[campaigns] sequence stopped but its timeline row failed", actError.code ?? actError.message);
    } catch (err) {
      console.error("[campaigns] sequence stopped but its timeline row failed", err);
    }
    return { status: "ok", stopped };
  } catch (err) {
    console.error(`[campaigns] sequence stop (${input.reason}) failed`, err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Email variants for an exact (case-insensitive in practice) address match without a LIKE pattern. */
function emailVariants(email: string | null): string[] {
  const e = email?.trim();
  if (!e || !e.includes("@") || e.toLowerCase().endsWith(".invalid")) return [];
  return [...new Set([e, e.toLowerCase()])];
}

/**
 * The lead rows a quote's stop applies to: the quote's own lead, plus any
 * lead in the SAME firm whose address is exactly the quote lead's or the quote
 * contact's. A contact is not a lead and has no enrollments of its own, so the
 * address is the only honest way to reach "its contact" — and a duplicate lead
 * row for the same person is exactly how a client who signed keeps getting
 * nudged. Every read is fenced on the quote's org.
 */
export async function leadsForQuote(db: StopDb, ids: { quoteId: string; orgId: string }): Promise<string[]> {
  const { data: quote, error } = await db
    .from("crm_quote")
    .select("id, lead_id, contact_id")
    .eq("id", ids.quoteId)
    .eq("org_id", ids.orgId)
    .maybeSingle();
  if (error || !quote) return [];
  const q = quote as Record<string, unknown>;
  const leadIds = new Set<string>();
  const emails: string[] = [];
  const leadId = str(q.lead_id);
  if (leadId) {
    leadIds.add(leadId);
    const { data: lead } = await db.from("crm_lead").select("id, email").eq("id", leadId).eq("org_id", ids.orgId).maybeSingle();
    emails.push(...emailVariants(str((lead as Record<string, unknown> | null)?.email)));
  }
  const contactId = str(q.contact_id);
  if (contactId) {
    const { data: contact } = await db.from("crm_contact").select("id, email").eq("id", contactId).eq("org_id", ids.orgId).maybeSingle();
    emails.push(...emailVariants(str((contact as Record<string, unknown> | null)?.email)));
  }
  if (emails.length > 0) {
    const { data: same } = await db.from("crm_lead").select("id").eq("org_id", ids.orgId).in("email", [...new Set(emails)]);
    for (const row of rowsOf(same)) if (str(row.id)) leadIds.add(row.id as string);
  }
  return [...leadIds];
}

/** Stops every running sequence for a quote's lead (and its contact). Never throws. */
export async function stopSequencesForQuote(
  db: StopDb,
  ids: { quoteId: string; orgId: string },
  input: Omit<StopInput, "orgId" | "leadIds">,
): Promise<StopOutcome> {
  try {
    const leadIds = await leadsForQuote(db, ids);
    return await stopLeadSequences(db, {
      ...input,
      orgId: ids.orgId,
      leadIds,
      evidence: { quote_id: ids.quoteId, ...(input.evidence ?? {}) },
    });
  } catch (err) {
    console.error(`[campaigns] sequence stop for quote ${ids.quoteId} failed`, err);
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
