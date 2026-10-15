import { earliest, latest, type StopFacts } from "./stops";
import { rowsOf, str, type StopDb, type StopDbQuery } from "./stop-db";

/**
 * Reads everything recorded about ONE lead that can end a sequence (the
 * `StopFacts` that ./stops.ts reasons over): signed quotes, succeeded
 * payments, matters, a won stage, the newest inbound email, and the newest
 * imported meeting linked to the lead.
 *
 * TWO STATES WOULD BE A LIE, SO THERE ARE TWO PLUS A FAILURE. `ok` means every
 * read came back; `unavailable` means at least one did not, and the caller
 * must FAIL CLOSED — advance() drafts nothing, enrolling refuses, the
 * approval page asks for an explicit confirm. A failed payment read is never
 * "unpaid" (AGENTS.md); a failed quote read is never "unsigned".
 *
 * `orgId` fences every read when the caller holds the service-role client. A
 * scoped caller may omit it: RLS already limits every table to the active org.
 */

export type FactsRead = { status: "ok"; facts: StopFacts } | { status: "unavailable"; error: string };

class ReadFailed extends Error {}

export async function loadStopFacts(db: StopDb, input: { leadId: string; orgId?: string | null }): Promise<FactsRead> {
  const { leadId } = input;
  const fence = (q: StopDbQuery): StopDbQuery => (input.orgId ? q.eq("org_id", input.orgId) : q);
  const read = async (q: PromiseLike<{ data: unknown; error: unknown }>, what: string) => {
    const { data, error } = await q;
    if (error) throw new ReadFailed(`${what} read failed`);
    return data;
  };

  try {
    const lead = (await read(
      fence(db.from("crm_lead").select("id, current_stage_id, stage_entered_at, last_inbound_at").eq("id", leadId)).maybeSingle(),
      "lead",
    )) as Record<string, unknown> | null;
    // A lead this caller cannot see is not "a lead with no facts".
    if (!lead) return { status: "unavailable", error: "lead not visible" };

    const stageId = str(lead.current_stage_id);
    const [stage, quotes, matters, meetings] = await Promise.all([
      stageId
        ? read(fence(db.from("crm_stage").select("id, category").eq("id", stageId)).maybeSingle(), "stage")
        : Promise.resolve(null),
      read(fence(db.from("crm_quote").select("id, accepted_at").eq("lead_id", leadId)), "quote"),
      read(fence(db.from("crm_matter").select("id, created_at").eq("lead_id", leadId)), "matter"),
      read(fence(db.from("crm_meeting").select("id, started_at").eq("lead_id", leadId)), "meeting"),
    ]);

    const quoteRows = rowsOf(quotes);
    const matterRows = rowsOf(matters);
    const quoteIds = quoteRows.map((q) => str(q.id)).filter((v): v is string => !!v);
    const matterIds = matterRows.map((m) => str(m.id)).filter((v): v is string => !!v);

    const payments: Record<string, unknown>[] = [];
    if (quoteIds.length > 0) {
      payments.push(
        ...rowsOf(
          await read(
            fence(db.from("crm_payment").select("id, occurred_at").eq("status", "succeeded").in("quote_id", quoteIds)),
            "payment",
          ),
        ),
      );
    }
    if (matterIds.length > 0) {
      payments.push(
        ...rowsOf(
          await read(
            fence(db.from("crm_payment").select("id, occurred_at").eq("status", "succeeded").in("matter_id", matterIds)),
            "payment",
          ),
        ),
      );
    }

    const won = (stage as Record<string, unknown> | null)?.category === "won";
    // Signed = accepted_at is set, whatever the status column says now. An
    // accepted quote is immutable, but a status-only filter would read a
    // signature as "unsigned" the day anything relabels that row.
    const signed = quoteRows.map((q) => str(q.accepted_at));
    const paid = payments.map((p) => str(p.occurred_at));
    const opened = matterRows.map((m) => str(m.created_at));
    return {
      status: "ok",
      facts: {
        signedAt: earliest(signed),
        paidAt: earliest(paid),
        matterOpenedAt: earliest(opened),
        wonAt: won ? (str(lead.stage_entered_at) ?? new Date(0).toISOString()) : null,
        lastInboundAt: str(lead.last_inbound_at),
        lastMeetingAt: latest(rowsOf(meetings).map((m) => str(m.started_at))),
        signedLatestAt: latest(signed),
        paidLatestAt: latest(paid),
        matterOpenedLatestAt: latest(opened),
      },
    };
  } catch (err) {
    return { status: "unavailable", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Facts for several leads at once (one person can be more than one lead row), merged. */
export async function loadStopFactsForLeads(
  db: StopDb,
  input: { leadIds: readonly string[]; orgId?: string | null },
): Promise<FactsRead> {
  const reads = await Promise.all(input.leadIds.map((leadId) => loadStopFacts(db, { leadId, orgId: input.orgId })));
  const failed = reads.find((r) => r.status !== "ok");
  if (failed) return failed;
  const all = reads.map((r) => (r as { status: "ok"; facts: StopFacts }).facts);
  return {
    status: "ok",
    facts: {
      signedAt: earliest(all.map((f) => f.signedAt)),
      paidAt: earliest(all.map((f) => f.paidAt)),
      matterOpenedAt: earliest(all.map((f) => f.matterOpenedAt)),
      wonAt: earliest(all.map((f) => f.wonAt)),
      lastInboundAt: latest(all.map((f) => f.lastInboundAt)),
      lastMeetingAt: latest(all.map((f) => f.lastMeetingAt)),
      signedLatestAt: latest(all.map((f) => f.signedLatestAt ?? f.signedAt)),
      paidLatestAt: latest(all.map((f) => f.paidLatestAt ?? f.paidAt)),
      matterOpenedLatestAt: latest(all.map((f) => f.matterOpenedLatestAt ?? f.matterOpenedAt)),
    },
  };
}

/** Exact address variants (no LIKE pattern, so nothing in an address is a wildcard). */
function emailVariants(email: string | null): string[] {
  const e = email?.trim();
  if (!e || !e.includes("@") || e.toLowerCase().endsWith(".invalid")) return [];
  return [...new Set([e, e.toLowerCase()])];
}

/**
 * Facts for the PERSON behind one lead row: that lead plus every other lead
 * in the same firm with exactly the same address. One person is often two
 * lead rows (a form submission and an import, a second inquiry), and the
 * quote they signed or the payment they made can sit on the other row. The
 * signing path already stops every same-address lead; this is the same
 * reach for advance()'s guard and for enrolling, so a stop that failed to
 * write, or a fact recorded somewhere that never called the stop (lectual's
 * own dashboard, an import), still can't let the duplicate row be nudged.
 *
 * Fenced on the lead row's own org_id (read first, through whichever client
 * the caller holds), so a service-role caller can't reach across firms and a
 * scoped caller is bounded by RLS as well. A failed read is `unavailable`.
 */
export async function loadStopFactsForPerson(db: StopDb, input: { leadId: string; orgId?: string | null }): Promise<FactsRead> {
  try {
    const first = db.from("crm_lead").select("id, org_id, email").eq("id", input.leadId);
    const { data, error } = await (input.orgId ? first.eq("org_id", input.orgId) : first).maybeSingle();
    if (error) return { status: "unavailable", error: "lead read failed" };
    const lead = data as Record<string, unknown> | null;
    const orgId = str(lead?.org_id);
    if (!lead || !orgId) return { status: "unavailable", error: "lead not visible" };
    const ids = new Set<string>([input.leadId]);
    const emails = emailVariants(str(lead.email));
    if (emails.length > 0) {
      const { data: same, error: sameError } = await db.from("crm_lead").select("id").eq("org_id", orgId).in("email", emails);
      if (sameError) return { status: "unavailable", error: "lead read failed" };
      for (const row of rowsOf(same)) if (str(row.id)) ids.add(row.id as string);
    }
    return await loadStopFactsForLeads(db, { leadIds: [...ids], orgId });
  } catch (err) {
    return { status: "unavailable", error: err instanceof Error ? err.message : String(err) };
  }
}
