import type { StopDb } from "@/lib/campaigns/stop-db";
import { rowsOf, str } from "@/lib/campaigns/stop-db";
import type { QueueItem } from "./api";
import { DRAFT_PAYLOAD_KEYS, MAX_RECIPIENT_LEADS, QUEUE_ID, UUID, recipientAddresses } from "./link-rules";

/**
 * Which lead(s) each pending queue item belongs to: the batched resolver that the
 * lead pages (`lead-pending.ts`, through the signed-in client) and the morning-brief
 * agent (through an org-fenced service-role adapter) BOTH call. It lives here, with
 * no scoped-client or server-only import, so the agent path does not pull in the
 * signed-in client. The rules and their order are those of the approval-time stale
 * check (`resolveLeads` in stale.ts); see lead-pending.ts for the long form.
 *
 * It takes a plain `db`: the caller decides whose rows that can reach. Throws on any
 * database error, so a caller can say "the lookup failed" rather than "no lead".
 */

export type Resolved = { leadIds: string[]; kind: string | null };

/**
 * Values per `.in(...)`. The filter rides in the GET URL, and a firm with a
 * few hundred pending items would otherwise push it past PostgREST/proxy
 * limits, the read would fail closed and every badge would vanish.
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
export async function resolveBatch(db: StopDb, items: QueueItem[]): Promise<Map<string, Resolved>> {
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
    // address forms, the same match the stale check makes one item at a time.
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
