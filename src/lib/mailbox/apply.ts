import type { SupabaseClient } from "@supabase/supabase-js";
import {
  activityPayloadForMessage,
  activityTypeFor,
  classifyEmail,
  isLaterInstant,
  redactSensitive,
  type EmailEvidenceReport,
  type EvidenceLead,
  type MatchedMessage,
  type ThreadMessage,
} from "@/lib/intake/email-match";
import type { MatterMatch } from "./matter-match";

/**
 * Turning a sync run's findings into rows.
 *
 * The write half is ported from lectual's scripts/sync-intake-email.ts
 * (applyEvidence), which has run against a real firm's mailboxes: dedupe on
 * payload.message_id before inserting (crm_activity is append-only), move
 * last_outbound_at / last_inbound_at forward only, fill a placeholder address
 * but never overwrite a real one, and ring the reply bell once per reply.
 *
 * Added here: the matter route (matter-match.ts), so mail from an existing
 * client's contact lands on their matter's timeline too.
 *
 * PRIVACY: only messages matched to a lead or a matter produce anything. The
 * payload holds no body and no preview (activityPayloadForMessage).
 */

export const MAILBOX_ACTIVITY_SOURCE = "mailbox-sync";

/** Who hears about a reply on a lead nobody is assigned to. Same list as lectual. */
export const UNASSIGNED_NOTIFY_ROLES = ["owner", "admin", "senior_admin", "attorney", "intake"];

export type PlannedActivity = {
  messageId: string;
  leadId: string | null;
  matterId: string | null;
  type: "email_sent" | "email_received";
  at: string | null;
  payload: Record<string, unknown>;
};

/**
 * Pure: which activity rows this run's messages should produce. One row per
 * message at most, carrying the lead, the matter, or both.
 */
export function planActivities(args: {
  report: EmailEvidenceReport;
  messages: readonly ThreadMessage[];
  matterFor: (message: ThreadMessage) => MatterMatch;
  connectionId: string;
}): PlannedActivity[] {
  const { report, messages, matterFor, connectionId } = args;
  const planned = new Map<string, PlannedActivity>();

  const build = (m: MatchedMessage, leadId: string | null, matter: MatterMatch): PlannedActivity => ({
    messageId: m.message.id,
    leadId,
    matterId: matter?.matterId ?? null,
    type: activityTypeFor(m.message.direction),
    at: m.message.at,
    payload: {
      ...activityPayloadForMessage(m),
      source: MAILBOX_ACTIVITY_SOURCE,
      connection_id: connectionId,
      ...(matter ? { matter_basis: matter.basis } : {}),
    },
  });

  // Lead matches (already classified and redacted by buildEmailEvidence).
  for (const entry of report.leads) {
    for (const matched of entry.matched) {
      planned.set(matched.message.id, build(matched, entry.lead.id, matterFor(matched.message)));
    }
  }

  // Everything else may still belong to a client's matter.
  for (const message of messages) {
    if (planned.has(message.id)) continue;
    const matter = matterFor(message);
    if (!matter) continue; // not about anyone we know: never stored
    const { type, sensitive } = classifyEmail(message.subject, message.preview);
    const matched: MatchedMessage = {
      message: redactSensitive(message, sensitive),
      confidence: 1,
      basis: "email",
      type,
      sensitive,
    };
    planned.set(message.id, build(matched, null, matter));
  }

  return [...planned.values()];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function replyLeadName(lead: EvidenceLead): string | null {
  const person = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  return person || lead.businessName?.trim() || null;
}

export type ApplyCounts = {
  activitiesInserted: number;
  alreadyPresent: number;
  leadsUpdated: number;
  addressesRecovered: number;
  notifications: number;
};

/**
 * Writes one run for one firm. `admin` is the service-role client — the sync
 * runs with nobody signed in — so EVERY statement carries `org_id = orgId`,
 * and orgId always comes from the mailbox_connection row being synced, never
 * from a request.
 */
export async function applyRun(
  admin: SupabaseClient,
  input: {
    orgId: string;
    report: EmailEvidenceReport;
    planned: PlannedActivity[];
    memberRoles: ReadonlyMap<string, string>;
  },
): Promise<ApplyCounts> {
  const { orgId, report, planned } = input;
  const counts: ApplyCounts = {
    activitiesInserted: 0,
    alreadyPresent: 0,
    leadsUpdated: 0,
    addressesRecovered: 0,
    notifications: 0,
  };

  // ── activities, deduped on payload.message_id ──────────────────────────────
  const activityIdByMessageId = new Map<string, string>();
  for (const batch of chunk(planned.map((p) => p.messageId), 100)) {
    const { data, error } = await admin
      .from("crm_activity")
      .select("id, payload")
      .eq("org_id", orgId)
      .in("type", ["email_sent", "email_received"])
      .in("payload->>message_id", batch);
    if (error) throw new Error(`activity read failed: ${error.message}`);
    for (const row of data ?? []) {
      const messageId = (row.payload as Record<string, unknown> | null)?.message_id;
      if (typeof messageId === "string") activityIdByMessageId.set(messageId, row.id as string);
    }
  }

  const rows = planned
    .filter((p) => !activityIdByMessageId.has(p.messageId))
    .map((p) => ({
      org_id: orgId,
      lead_id: p.leadId,
      matter_id: p.matterId,
      type: p.type,
      actor_id: null,
      actor_type: "system" as const,
      payload: p.payload,
      // The touch lands on the day it happened, not the day it was synced.
      ...(p.at ? { created_at: p.at } : {}),
    }));
  counts.alreadyPresent = planned.length - rows.length;

  for (const batch of chunk(rows, 100)) {
    const { data, error } = await admin.from("crm_activity").insert(batch).select("id, payload");
    if (error) throw new Error(`activity insert failed: ${error.message}`);
    for (const row of data ?? []) {
      const messageId = (row.payload as Record<string, unknown> | null)?.message_id;
      if (typeof messageId === "string") activityIdByMessageId.set(messageId, row.id as string);
    }
    counts.activitiesInserted += batch.length;
  }

  // ── lead columns: advance only, and fill a placeholder ─────────────────────
  for (const entry of report.leads) {
    const changes: Record<string, string> = {};
    const { lead, cadence } = entry;
    // isLaterInstant, not `>`: "Z" vs "+00:00" would make an unchanged time
    // look newer on every run.
    if (cadence.lastOutboundAt && isLaterInstant(cadence.lastOutboundAt, lead.lastOutboundAt)) {
      changes.last_outbound_at = cadence.lastOutboundAt;
    }
    if (cadence.lastInboundAt && isLaterInstant(cadence.lastInboundAt, lead.lastInboundAt)) {
      changes.last_inbound_at = cadence.lastInboundAt;
    }
    if (entry.recoveredEmail) {
      changes.email = entry.recoveredEmail;
      counts.addressesRecovered += 1;
    }
    if (Object.keys(changes).length === 0) continue;
    const { error } = await admin.from("crm_lead").update(changes).eq("id", lead.id).eq("org_id", orgId);
    if (error) throw new Error(`lead update failed: ${error.message}`);
    counts.leadsUpdated += 1;
  }

  // ── reply notifications, once per (lead, reply, recipient) ─────────────────
  const replies = report.leads.filter((l) => l.newReply);
  if (replies.length === 0) return counts;

  const seen = new Set<string>();
  for (const batch of chunk(replies.map((r) => r.lead.id), 100)) {
    const { data, error } = await admin
      .from("crm_notification")
      .select("lead_id, activity_id, user_id")
      .eq("org_id", orgId)
      .eq("kind", "lead_replied")
      .in("lead_id", batch);
    if (error) throw new Error(`notification read failed: ${error.message}`);
    for (const row of data ?? []) seen.add(`${row.lead_id}::${row.activity_id}::${row.user_id}`);
  }

  const notifications: Array<Record<string, unknown>> = [];
  for (const entry of replies) {
    const last = entry.cadence.touches[entry.cadence.touches.length - 1];
    const activityId = activityIdByMessageId.get(last.messageId) ?? null;
    const recipients = entry.lead.assignedTo
      ? [entry.lead.assignedTo]
      : [...input.memberRoles.entries()]
          .filter(([, role]) => UNASSIGNED_NOTIFY_ROLES.includes(role))
          .map(([userId]) => userId);
    const name = replyLeadName(entry.lead);
    for (const userId of recipients) {
      const key = `${entry.lead.id}::${activityId}::${userId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notifications.push({
        org_id: orgId,
        user_id: userId,
        kind: "lead_replied",
        lead_id: entry.lead.id,
        activity_id: activityId,
        actor_id: null,
        // The name, never the subject or preview: what they SAID stays in the mailbox.
        payload: { at: last.at, from: last.fromAddress, type: last.type, ...(name ? { lead_name: name } : {}) },
      });
    }
  }
  for (const batch of chunk(notifications, 100)) {
    const { error } = await admin.from("crm_notification").insert(batch);
    if (error) throw new Error(`notification insert failed: ${error.message}`);
  }
  counts.notifications = notifications.length;
  return counts;
}
