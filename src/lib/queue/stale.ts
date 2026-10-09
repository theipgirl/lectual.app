import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { QueueItem } from "./api";
import { loadStopFactsForLeads } from "@/lib/campaigns/stop-facts";
import { staleSince, type StopDecision } from "@/lib/campaigns/stops";
import { rowsOf, str, type StopDb } from "@/lib/campaigns/stop-db";

/**
 * The approval-time warning (intake SOP §2.5): a client email queued on
 * Monday, a client who pays Monday night, and an approver on Tuesday who is
 * about to authorise a nudge to someone who has already hired the firm.
 *
 * Nothing is rejected automatically — `resolved_by` must come from a human
 * session (AGENTS.md). Instead the item page shows "Signed Oct 3 — this
 * follow-up may be stale" and approving needs an explicit confirm, which the
 * server action re-checks (stalenessRequiresConfirm) so a hand-posted form
 * can't skip it.
 *
 * ── WHERE THE LEAD LINK LIVES ───────────────────────────────────────────────
 * A queue item carries no lead id (the queue is another service; its rows hold
 * `matter_id`, `client_name`, `recipient`). The link is resolved, most
 * reliable first:
 *
 *   draft     the `queue_drafted` timeline row the drafter wrote on the lead
 *             (payload.queueItemId — campaigns, prep-consult — or
 *             payload.queue_id — post-consult, meeting follow-ups). Exact.
 *   matter    the item's matter_id → crm_matter.lead_id. Exact.
 *   recipient the leads in this firm whose address is exactly the item's
 *             recipient. Exact address match, so it can name more than one
 *             lead row for the same person — all of them are checked.
 *
 * An item none of these resolves (an internal briefing, a draft from the
 * Cowork plugin with no recipient) gets no warning, and the page says it
 * couldn't link the draft to a lead rather than implying it checked.
 *
 * Every read is through the approver's scoped client, so the lead found is
 * always one of the approver's own firm's.
 */

export type StaleLinkedBy = "draft" | "matter" | "recipient";

export type StaleCheck =
  /** Not a pending client-facing draft — nothing to check. */
  | { status: "not_applicable" }
  /** A client-facing draft we could not tie to any lead. */
  | { status: "unlinked" }
  | { status: "clear"; leadIds: string[]; leadName: string | null; linkedBy: StaleLinkedBy }
  | { status: "stale"; leadIds: string[]; leadName: string | null; linkedBy: StaleLinkedBy; facts: StopDecision[] }
  /** The lead was found but its facts couldn't be read: fail closed, confirm required. */
  | { status: "unavailable"; leadIds: string[]; leadName: string | null; linkedBy: StaleLinkedBy };

/** Queue ids are the queue service's own; anything outside this shape is never put in a filter string. */
const QUEUE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Client-facing = a CLIENT_EMAIL, or any draft addressed to someone. */
export function isClientFacing(item: Pick<QueueItem, "type" | "recipient">): boolean {
  return item.type === "CLIENT_EMAIL" || !!item.recipient?.trim();
}

/** Approving needs an explicit confirm when the client moved on since, or when we couldn't check. */
export function stalenessRequiresConfirm(check: StaleCheck): boolean {
  return check.status === "stale" || check.status === "unavailable";
}

function leadName(row: Record<string, unknown> | undefined): string | null {
  if (!row) return null;
  const person = [str(row.first_name), str(row.last_name)].filter(Boolean).join(" ").trim();
  return str(row.business_name) ?? (person || null);
}

async function resolveLeads(
  db: StopDb,
  item: Pick<QueueItem, "id" | "matter_id" | "recipient">,
): Promise<{ leadIds: string[]; linkedBy: StaleLinkedBy } | null | "failed"> {
  if (QUEUE_ID.test(item.id)) {
    // Two reads rather than one `.or()` over JSON paths: each is a plain
    // equality PostgREST cannot misparse, and the id is shape-checked anyway.
    for (const key of ["queueItemId", "queue_id"]) {
      const { data, error } = await db
        .from("crm_activity")
        .select("lead_id")
        .eq("type", "queue_drafted")
        .eq(`payload->>${key}`, item.id);
      if (error) return "failed";
      const ids = rowsOf(data).map((r) => str(r.lead_id)).filter((v): v is string => !!v);
      if (ids.length > 0) return { leadIds: [...new Set(ids)], linkedBy: "draft" };
    }
  }
  if (item.matter_id && UUID.test(item.matter_id)) {
    const { data, error } = await db.from("crm_matter").select("lead_id").eq("id", item.matter_id).maybeSingle();
    if (error) return "failed";
    const leadId = str((data as Record<string, unknown> | null)?.lead_id);
    if (leadId) return { leadIds: [leadId], linkedBy: "matter" };
  }
  const recipient = item.recipient?.trim();
  if (recipient && recipient.includes("@")) {
    const { data, error } = await db
      .from("crm_lead")
      .select("id")
      .in("email", [...new Set([recipient, recipient.toLowerCase()])]);
    if (error) return "failed";
    const ids = rowsOf(data).map((r) => str(r.id)).filter((v): v is string => !!v).slice(0, 5);
    if (ids.length > 0) return { leadIds: ids, linkedBy: "recipient" };
  }
  return null;
}

/** The check for one queue item. `db` is injectable for tests; production uses the caller's scoped client. */
export async function checkDraftStaleness(item: QueueItem, db?: StopDb): Promise<StaleCheck> {
  if (item.status !== "pending" || !isClientFacing(item)) return { status: "not_applicable" };
  const client = db ?? ((await getScopedClient()) as unknown as StopDb);

  let resolved: Awaited<ReturnType<typeof resolveLeads>>;
  try {
    resolved = await resolveLeads(client, item);
  } catch {
    resolved = "failed";
  }
  // Couldn't even look: same as couldn't check — confirm required.
  if (resolved === "failed") return { status: "unavailable", leadIds: [], leadName: null, linkedBy: "draft" };
  if (!resolved) return { status: "unlinked" };

  let name: string | null = null;
  try {
    const { data } = await client.from("crm_lead").select("id, first_name, last_name, business_name").eq("id", resolved.leadIds[0]).maybeSingle();
    name = leadName((data as Record<string, unknown> | null) ?? undefined);
  } catch {
    name = null;
  }

  const facts = await loadStopFactsForLeads(client, { leadIds: resolved.leadIds });
  if (facts.status !== "ok") return { status: "unavailable", leadIds: resolved.leadIds, leadName: name, linkedBy: resolved.linkedBy };
  const since = staleSince(facts.facts, item.created_at);
  if (since.length === 0) return { status: "clear", leadIds: resolved.leadIds, leadName: name, linkedBy: resolved.linkedBy };
  return { status: "stale", leadIds: resolved.leadIds, leadName: name, linkedBy: resolved.linkedBy, facts: since };
}
