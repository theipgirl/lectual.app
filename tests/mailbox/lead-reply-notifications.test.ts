import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyRun, planActivities, UNASSIGNED_NOTIFY_ROLES } from "@/lib/mailbox/apply";
import { buildEmailEvidence, type EvidenceLead } from "@/lib/intake/email-match";
import type { ThreadMessage } from "@/lib/intake/email-threads";
import { fakeAdmin, type Recorded } from "./fake-db";

/**
 * The lead_replied producer lives in applyRun (the mailbox sync, service role).
 * It was wired before the notifications sprint; this pins its rules: who hears,
 * what the payload holds, once per reply, and only ever inside the connection's org.
 */

const ORG = "11111111-1111-1111-1111-111111111111";
const OWNER = "owner-user";

const members = new Map<string, string>([
  ["u-owner", "owner"],
  ["u-admin", "admin"],
  ["u-senior", "senior_admin"],
  ["u-attorney", "attorney"],
  ["u-intake", "intake"],
  ["u-paralegal", "paralegal"],
  ["u-viewer", "viewer"],
  ["u-social", "social_media"],
]);

const lead = (id: string, first: string, email: string, assignedTo: string | null): EvidenceLead => ({
  id,
  firstName: first,
  lastName: "Tester",
  businessName: null,
  email,
  markText: null,
  stageName: null,
  assignedTo,
  lastOutboundAt: null,
  lastInboundAt: null,
});

const inbound = (id: string, from: string, subject: string, preview: string): ThreadMessage => ({
  id,
  conversationId: `c-${id}`,
  mailbox: "intake@firm.example",
  folder: "inbox",
  direction: "inbound",
  at: "2026-10-20T09:00:00Z",
  from: { name: null, address: from },
  to: [],
  cc: [],
  subject,
  preview,
  webLink: null,
});

/** A tiny stateful database, so a second run sees what the first one wrote. */
function database() {
  const activities: Array<{ id: string; payload: Record<string, unknown>; org_id: string }> = [];
  const notifications: Array<Record<string, unknown>> = [];
  const handler = (q: Recorded) => {
    if (q.table === "crm_activity" && q.action === "select") {
      const ids = (q.filters.find((f) => f.column === "payload->>message_id")?.value as string[]) ?? [];
      return { data: activities.filter((a) => ids.includes(a.payload.message_id as string)), error: null };
    }
    if (q.table === "crm_activity" && q.action === "insert") {
      const stored = (q.values as Array<{ payload: Record<string, unknown>; org_id: string }>).map((v, i) => ({
        id: `act-${activities.length + i + 1}`,
        payload: v.payload,
        org_id: v.org_id,
      }));
      activities.push(...stored);
      return { data: stored.map(({ id, payload }) => ({ id, payload })), error: null };
    }
    if (q.table === "crm_notification" && q.action === "select") return { data: notifications, error: null };
    if (q.table === "crm_notification" && q.action === "insert") {
      notifications.push(...(q.values as Array<Record<string, unknown>>));
      return { data: null, error: null };
    }
    return undefined;
  };
  return { activities, notifications, handler };
}

async function sync(db: ReturnType<typeof database>, leads: EvidenceLead[], messages: ThreadMessage[]) {
  const { client, log } = fakeAdmin(db.handler);
  const report = buildEmailEvidence({ messages, leads, directory: [] });
  const planned = planActivities({ report, messages, matterFor: () => null, connectionId: "conn-1" });
  const counts = await applyRun(client as unknown as SupabaseClient, { orgId: ORG, report, planned, memberRoles: members });
  return { counts, log };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("lead_replied producer (F7)", () => {
  it("tells only the assigned owner when the lead is assigned", async () => {
    const db = database();
    await sync(db, [lead("L1", "Ana", "ana@client.example", OWNER)], [inbound("m1", "ana@client.example", "Quick question", "hello")]);
    expect(db.notifications).toHaveLength(1);
    expect(db.notifications[0]).toMatchObject({ user_id: OWNER, kind: "lead_replied", lead_id: "L1", org_id: ORG, actor_id: null });
  });

  it("tells the members in UNASSIGNED_NOTIFY_ROLES, and nobody else, when the lead is unassigned", async () => {
    const db = database();
    await sync(db, [lead("L2", "Bo", "bo@client.example", null)], [inbound("m2", "bo@client.example", "Hi", "hello")]);
    const recipients = db.notifications.map((n) => n.user_id).sort();
    expect(recipients).toEqual(["u-admin", "u-attorney", "u-intake", "u-owner", "u-senior"]);
    for (const [userId, role] of members) {
      expect(recipients.includes(userId)).toBe(UNASSIGNED_NOTIFY_ROLES.includes(role));
    }
    expect(recipients).not.toContain("u-paralegal");
    expect(recipients).not.toContain("u-viewer");
    expect(recipients).not.toContain("u-social");
  });

  it("holds the lead name and no subject, preview, body or sender text, even for a sensitive thread", async () => {
    const db = database();
    const subject = "Opposing counsel settlement SECRET-SUBJECT";
    const preview = "SECRET-PREVIEW we will sue";
    await sync(db, [lead("L3", "Cy", "cy@client.example", OWNER)], [inbound("m3", "cy@client.example", subject, preview)]);
    expect(db.notifications).toHaveLength(1);
    const payload = db.notifications[0].payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["at", "from", "lead_name", "type"]);
    expect(payload.lead_name).toBe("Cy Tester");
    for (const key of ["subject", "preview", "body", "snippet"]) expect(payload).not.toHaveProperty(key);
    expect(JSON.stringify(db.notifications)).not.toMatch(/SECRET|sue/);
  });

  it("raises nothing new on a second run over the same reply", async () => {
    const db = database();
    const leads = [lead("L4", "Di", "di@client.example", OWNER)];
    const messages = [inbound("m4", "di@client.example", "Hello", "hi")];
    const first = await sync(db, leads, messages);
    expect(first.counts.notifications).toBe(1);
    const second = await sync(db, leads, messages);
    expect(second.counts.notifications).toBe(0);
    expect(second.counts.activitiesInserted).toBe(0);
    expect(db.notifications).toHaveLength(1);
  });

  it("stamps every inserted row, and fences every statement, with the connection's own org", async () => {
    const db = database();
    const { log } = await sync(
      db,
      [lead("L5", "Ed", "ed@client.example", OWNER), lead("L6", "Fay", "fay@client.example", null)],
      [inbound("m5", "ed@client.example", "A", "x"), inbound("m6", "fay@client.example", "B", "y")],
    );
    expect(db.notifications.length).toBeGreaterThan(1);
    for (const row of db.notifications) {
      expect(row.org_id).toBe(ORG);
      expect(row.kind).toBe("lead_replied");
    }
    const notificationReads = log.filter((q) => q.table === "crm_notification" && q.action === "select");
    expect(notificationReads.length).toBeGreaterThan(0);
    for (const q of notificationReads) expect(q.filters).toContainEqual({ op: "eq", column: "org_id", value: ORG });
    for (const a of db.activities) expect(a.org_id).toBe(ORG);
  });

  it("raises nothing when the message is not a new reply from a known lead", async () => {
    const db = database();
    await sync(db, [lead("L7", "Gus", "gus@client.example", OWNER)], [inbound("m7", "stranger@elsewhere.example", "Weekly digest", "news")]);
    expect(db.notifications).toHaveLength(0);
  });
});
