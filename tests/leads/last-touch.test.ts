import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyRun, planActivities } from "@/lib/mailbox/apply";
import { buildEmailEvidence, type EvidenceLead } from "@/lib/intake/email-match";
import type { ThreadMessage } from "@/lib/intake/email-threads";
import { lastTouchAt } from "@/lib/intake/temperature";
import { DEFAULT_SORT, buildIntakeRows, sortRows } from "@/lib/intake/rows";
import { runPostConsult } from "@/lib/agents/post-consult";
import { runStageKeeper } from "@/lib/agents/stage-keeper/run";
import { createFakeDb } from "../matters/helpers/fake-db";
import { fakeAdmin, type Recorded } from "../mailbox/fake-db";
import { agentCtx, fakeLlm } from "../agents/helpers";
import { agentFixture, form, loadKeeperActions } from "../stage-keeper/actions-harness";
import { keeperWorld, lead, mail, suggestionRows, stageRows } from "../stage-keeper/db";
import { L, ORG, S, SENTINEL, daysAgo } from "../stage-keeper/fixtures";

/**
 * What counts as contact with a lead (Sprint 16, F17 / F18): a real touch moves the last touch the Intake
 * list sorts by; an agent's own analysis, a queued draft and a dismissal do not.
 */

afterEach(() => vi.resetModules());

const evidenceLead = (id: string): EvidenceLead => ({
  id,
  firstName: "Ana",
  lastName: "Tester",
  businessName: null,
  email: "ana@client.example",
  markText: null,
  stageName: null,
  assignedTo: null,
  lastOutboundAt: null,
  lastInboundAt: null,
});
const message = (id: string, direction: "inbound" | "outbound", at: string): ThreadMessage => ({
  id,
  conversationId: `c-${id}`,
  mailbox: "intake@firm.example",
  folder: direction === "inbound" ? "inbox" : "sent",
  direction,
  at,
  from: { name: null, address: direction === "inbound" ? "ana@client.example" : "intake@firm.example" },
  to: [{ name: null, address: direction === "inbound" ? "intake@firm.example" : "ana@client.example" }],
  cc: [],
  subject: "Hello",
  preview: "hi",
  webLink: null,
});

async function sync(direction: "inbound" | "outbound", at: string) {
  const { client, log } = fakeAdmin((q: Recorded) => {
    if (q.table === "crm_activity" && q.action === "select") return { data: [], error: null };
    if (q.table === "crm_activity" && q.action === "insert") return { data: (q.values as Array<{ payload: unknown }>).map((v, i) => ({ id: `a${i}`, payload: v.payload })), error: null };
    return undefined;
  });
  const leads = [evidenceLead("L1")];
  const messages = [message("m1", direction, at)];
  const report = buildEmailEvidence({ messages, leads, directory: [] });
  const planned = planActivities({ report, messages, matterFor: () => null, connectionId: "conn-1" });
  await applyRun(client as unknown as SupabaseClient, { orgId: ORG, report, planned, memberRoles: new Map() });
  return log.filter((q) => q.table === "crm_lead" && q.action === "update");
}

describe("F17 what moves a lead's last touch", () => {
  it("a matched email in or out moves it (the sync sets last inbound / outbound, and the list reads the greatest)", async () => {
    const [inUpdate] = await sync("inbound", "2026-09-20T09:00:00Z");
    expect(inUpdate.values).toMatchObject({ last_inbound_at: "2026-09-20T09:00:00Z" });
    const [outUpdate] = await sync("outbound", "2026-09-21T09:00:00Z");
    expect(outUpdate.values).toMatchObject({ last_outbound_at: "2026-09-21T09:00:00Z" });
    expect(lastTouchAt({ last_activity_at: "2026-09-01T00:00:00Z", last_outbound_at: "2026-09-21T09:00:00Z", last_inbound_at: "2026-09-20T09:00:00Z" })).toBe("2026-09-21T09:00:00Z");
  });

  it("a stage move by a person moves it", async () => {
    const fx = await agentFixture("suggest");
    const { actions, db } = await loadKeeperActions({ leads: fx.leads, activity: fx.activity });
    const before = db.rows("crm_lead")[0].last_activity_at;
    const out = await actions.acceptStageSuggestionAction({}, form({ leadId: L.amara, activityId: suggestionRows(fx.activity)[0].id }));
    expect(out.ok).toBe(true);
    expect(db.rows("crm_lead")[0].last_activity_at).not.toBe(before);
    expect(new Date(db.rows("crm_lead")[0].last_activity_at as string).getTime()).toBeGreaterThan(Date.parse(before as string));
  });

  it("a stage move by the agent moves it, to the run time", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice")] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(w.rows("crm_lead")[0].last_activity_at).toBe("2026-09-25T12:00:00.000Z");
  });

  it("a note moves it", async () => {
    vi.resetModules();
    const db = createFakeDb({ role: "attorney", orgId: ORG, userId: "user-1", tables: { crm_lead: [lead(L.amara, S.newPnc)], crm_activity: [] } });
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => db.client()) }));
    const { logActivity } = await import("@/lib/matters/activity");
    await logActivity({ type: "note", leadId: L.amara, payload: { note: "Called, left a message" } });
    expect(db.rows("crm_lead")[0].last_activity_at).not.toBe(daysAgo(10));
    expect(db.writes.filter((w) => w.table === "crm_lead" && w.op === "update")).toHaveLength(1);
    vi.doUnmock("@/lib/db/scoped-client");
  });

  it("a row logged with touchLead: false does not (the way a dismissal is recorded)", async () => {
    vi.resetModules();
    const db = createFakeDb({ role: "attorney", orgId: ORG, userId: "user-1", tables: { crm_lead: [lead(L.amara, S.newPnc)], crm_activity: [] } });
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => db.client()) }));
    const { logActivity } = await import("@/lib/matters/activity");
    await logActivity({ type: "ai_insight", leadId: L.amara, actorType: "user", payload: { source: "stage-keeper-review" }, touchLead: false });
    expect(db.writes.filter((w) => w.table === "crm_lead")).toEqual([]);
    expect(db.rows("crm_activity")).toHaveLength(1);
    vi.doUnmock("@/lib/db/scoped-client");
  });

  it("a queued draft (a queue_drafted row) does not: the post-consult agent writes the row and touches no lead", async () => {
    const draft = {
      subject: "Great speaking today",
      body: "Hi Amara",
      internal_summary: "Summary",
      consult_details: { marks: [], recommended_package: null, discount_discussed: null },
    };
    const { llm } = fakeLlm(draft);
    const { ctx, log } = agentCtx(
      (q: Recorded) => {
        if (q.table === "crm_consult_note") return { data: [{ id: "note-1", lead_id: "lead-1", created_at: "2026-09-24T09:00:00Z", notes: { summary: "Wants to file", next_step: "Send the letter" } }], error: null };
        if (q.table === "crm_activity" && q.action === "select") return { data: [], error: null };
        if (q.table === "crm_lead") return { data: [{ id: "lead-1", first_name: "Amara", last_name: "Nwosu", business_name: null, email: "amara@example.com" }], error: null };
        return undefined;
      },
      { autonomy: "draft", queue: true, llm },
    );
    await runPostConsult(ctx);
    expect(log.some((q) => q.table === "crm_activity" && q.action === "insert" && (q.values as { type: string }).type === "queue_drafted")).toBe(true);
    expect(log.some((q) => q.table === "crm_lead" && q.action === "update")).toBe(false);
  });

  it("an agent's ai_insight row does not: the Stage Keeper's suggestion writes no lead column at all", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice", { subject: SENTINEL })] });
    const { ctx, log } = w.ctx("suggest");
    await runStageKeeper(ctx);
    expect(suggestionRows(w.rows("crm_activity"))).toHaveLength(1);
    expect(log.some((q) => q.table === "crm_lead" && q.action === "update")).toBe(false);
    expect(w.rows("crm_lead")[0].last_activity_at).toBe(daysAgo(10));
  });

  it("dismissing a Stage Keeper suggestion does not", async () => {
    const fx = await agentFixture("suggest");
    const { actions, db } = await loadKeeperActions({ leads: fx.leads, activity: fx.activity });
    await actions.dismissStageSuggestionAction({}, form({ leadId: L.amara, activityId: suggestionRows(fx.activity)[0].id }));
    expect(db.rows("crm_lead")[0].last_activity_at).toBe(fx.leads[0].last_activity_at);
    expect(db.writes.filter((w) => w.table === "crm_lead")).toEqual([]);
  });
});

describe("F18 the Intake list still sorts by last touch", () => {
  const stages = stageRows().map((s) => ({ ...s, aging_threshold_days: null })) as never;
  const row = (id: string, last_activity_at: string) =>
    ({
      ...lead(id, S.newPnc, { first_name: id, last_name: "Lead", email: `${id}@x.test`, assigned_to: null, last_outbound_at: null, last_inbound_at: null, last_activity_at }),
    }) as never;

  it("is last touch, newest first, by default", () => {
    expect(DEFAULT_SORT).toEqual({ key: "lastTouch", dir: "desc" });
  });

  it("a lead the agent just moved sorts above one touched the day before", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    const rows = buildIntakeRows({ leads: [row("dayBefore", "2026-09-24T12:00:00.000Z"), row("moved", "2026-09-25T12:00:00.000Z"), row("older", "2026-09-10T12:00:00.000Z")], stages, members: [], now });
    expect(sortRows(rows, DEFAULT_SORT.key, DEFAULT_SORT.dir).map((r) => r.lead.first_name)).toEqual(["moved", "dayBefore", "older"]);
  });
});
