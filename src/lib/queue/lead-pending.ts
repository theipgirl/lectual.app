import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import { rowsOf, str, type StopDb } from "@/lib/campaigns/stop-db";
import type { LeadPendingApproval, LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import type { QueueItem } from "./api";
import { loadActiveQueue, type QueueLoad } from "./load";
import { DRAFT_PAYLOAD_KEYS, MAX_RECIPIENT_LEADS, QUEUE_ID, UUID, recipientAddresses } from "./link-rules";
import { isClientFacing } from "./stale";

/**
 * Pending approvals grouped by lead — what the intake view and the lead page
 * show as "waiting on Rebecca" without a trip to the queue board.
 *
 * The queue is another service and its rows carry no lead id, so each pending
 * item is tied to its lead(s) by the SAME rules, in the SAME order, as the
 * approval-time stale check (`resolveLeads` in stale.ts): the `queue_drafted`
 * timeline row the drafter wrote, else the item's matter, else an exact
 * recipient-address match. Here they run BATCHED — one `.in(...)` query per
 * rule for every pending item at once — because the intake page asks about the
 * whole queue, not one item. An item none of the rules resolves belongs to no
 * lead and is simply not listed under one; it still shows on the queue board.
 *
 * THREE-STATE, never two (AGENTS.md): a queue we could not read is
 * `unavailable`, and so is a queue we read but could not map to leads. Neither
 * may ever look like `ok` with nothing pending. Reads go through the caller's
 * scoped client only.
 */

type Resolved = { leadIds: string[]; kind: string | null };

/**
 * Values per `.in(...)`. The filter rides in the GET URL, and a firm with a
 * few hundred pending items would otherwise push it past PostgREST/proxy
 * limits — the read would fail closed and every badge would vanish.
 */
const IN_CHUNK = 100;

function chunks<T>(values: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) out.push(values.slice(i, i + IN_CHUNK));
  return out;
}

/** `payload.kind` the drafters stamp on their `queue_drafted` row. */
function payloadKindOf(payload: unknown): string | null {
  return payload && typeof payload === "object" ? str((payload as Record<string, unknown>).kind) : null;
}

/**
 * Item id → lead ids, by the three linking rules. Throws on any DB error so the
 * caller can collapse it to `unavailable`.
 */
async function resolveBatch(db: StopDb, items: QueueItem[]): Promise<Map<string, Resolved>> {
  const resolved = new Map<string, Resolved>();

  // Rule 1: the drafter's timeline row. A key (queueItemId, then queue_id)
  // that finds an item settles it; the next key is only tried for the rest.
  const draftIds = items.map((i) => i.id).filter((id) => QUEUE_ID.test(id));
  for (const key of DRAFT_PAYLOAD_KEYS) {
    const open = draftIds.filter((id) => !resolved.has(id));
    if (open.length === 0) break;
    const rows: Record<string, unknown>[] = [];
    for (const part of chunks(open)) {
      const { data, error } = await db
        .from("crm_activity")
        .select("lead_id, payload")
        .eq("type", "queue_drafted")
        .in(`payload->>${key}`, part);
      if (error) throw new Error(error.message ?? "queue_drafted read failed");
      rows.push(...rowsOf(data));
    }
    const byItem = new Map<string, Resolved>();
    for (const row of rows) {
      const payload = row.payload as Record<string, unknown> | null | undefined;
      const id = str(payload?.[key]);
      const leadId = str(row.lead_id);
      if (!id || !leadId || !open.includes(id)) continue;
      const entry = byItem.get(id) ?? { leadIds: [], kind: null };
      if (!entry.leadIds.includes(leadId)) entry.leadIds.push(leadId);
      entry.kind ??= payloadKindOf(payload);
      byItem.set(id, entry);
    }
    for (const [id, entry] of byItem) resolved.set(id, entry);
  }

  // Rule 2: the item's matter → its lead.
  const byMatter = items.filter((i) => !resolved.has(i.id) && i.matter_id && UUID.test(i.matter_id));
  if (byMatter.length > 0) {
    const matterIds = [...new Set(byMatter.map((i) => i.matter_id as string))];
    const rows: Record<string, unknown>[] = [];
    for (const part of chunks(matterIds)) {
      const { data, error } = await db.from("crm_matter").select("id, lead_id").in("id", part);
      if (error) throw new Error(error.message ?? "crm_matter read failed");
      rows.push(...rowsOf(data));
    }
    const leadOfMatter = new Map<string, string>();
    for (const row of rows) {
      const id = str(row.id);
      const leadId = str(row.lead_id);
      if (id && leadId) leadOfMatter.set(id, leadId);
    }
    for (const item of byMatter) {
      const leadId = leadOfMatter.get(item.matter_id as string);
      if (leadId) resolved.set(item.id, { leadIds: [leadId], kind: null });
    }
  }

  // Rule 3: an exact recipient address. Can name more than one lead row for
  // the same person; all (up to the cap) are listed, as the stale check does.
  const byRecipient = items
    .filter((i) => !resolved.has(i.id))
    .map((item) => ({ item, addresses: recipientAddresses(item.recipient) }))
    .filter((x): x is { item: QueueItem; addresses: string[] } => x.addresses !== null);
  if (byRecipient.length > 0) {
    const all = [...new Set(byRecipient.flatMap((x) => x.addresses))];
    const rows: Record<string, unknown>[] = [];
    for (const part of chunks(all)) {
      const { data, error } = await db.from("crm_lead").select("id, email").in("email", part);
      if (error) throw new Error(error.message ?? "crm_lead read failed");
      rows.push(...rowsOf(data));
    }
    // Keyed by the EXACT stored address, and each item looks up only its own
    // address forms — the same match the stale check makes one item at a time.
    // Lower-casing here would let one item borrow another item's casing.
    const leadsByEmail = new Map<string, string[]>();
    for (const row of rows) {
      const id = str(row.id);
      const email = str(row.email);
      if (!id || !email) continue;
      leadsByEmail.set(email, [...(leadsByEmail.get(email) ?? []), id]);
    }
    for (const { item, addresses } of byRecipient) {
      const ids = [...new Set(addresses.flatMap((a) => leadsByEmail.get(a) ?? []))].slice(0, MAX_RECIPIENT_LEADS);
      if (ids.length > 0) resolved.set(item.id, { leadIds: ids, kind: null });
    }
  }

  return resolved;
}

function kindOf(item: QueueItem, payloadKind: string | null): LeadPendingApproval["kind"] {
  if (payloadKind === "heads_up") return "rebecca_brief";
  if (payloadKind === "client_prep" || isClientFacing(item)) return "client_draft";
  return "other";
}

/** Group pending items by the leads they belong to, newest first within a lead. Exported for tests. */
export async function groupPendingByLead(db: StopDb, items: QueueItem[]): Promise<Record<string, LeadPendingApproval[]>> {
  const byLead: Record<string, LeadPendingApproval[]> = {};
  if (items.length === 0) return byLead;
  const resolved = await resolveBatch(db, items);
  for (const item of items) {
    const hit = resolved.get(item.id);
    if (!hit) continue;
    const approval: LeadPendingApproval = {
      queueId: item.id,
      headline: item.headline?.trim() || item.subject?.trim() || "Untitled draft",
      kind: kindOf(item, hit.kind),
      createdAt: item.created_at || null,
    };
    for (const leadId of hit.leadIds) (byLead[leadId] ??= []).push(approval);
  }
  for (const list of Object.values(byLead)) {
    list.sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "") || 0);
  }
  return byLead;
}

/**
 * Never throws: an outage must not take the intake page or the lead page down,
 * and it is reported as `unavailable` rather than as an empty map. `deps` is
 * injectable for tests; production uses the active org's queue and the
 * caller's scoped client.
 */
export async function loadPendingApprovalsByLead(
  deps: { load?: () => Promise<QueueLoad>; db?: StopDb } = {},
): Promise<LeadPendingApprovals> {
  const queue = await (deps.load ?? (() => loadActiveQueue("pending")))();
  if (queue.status === "unconfigured") return { status: "unconfigured" };
  if (queue.status === "unavailable") return { status: "unavailable" };
  try {
    const db = deps.db ?? ((await getScopedClient()) as unknown as StopDb);
    return { status: "ok", byLead: await groupPendingByLead(db, queue.items) };
  } catch (error) {
    console.error("[queue] could not map pending approvals to leads:", error);
    return { status: "unavailable" };
  }
}
