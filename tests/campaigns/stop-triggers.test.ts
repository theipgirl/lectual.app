import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, type Row } from "../quotes/fake-db";
import { fakeAdmin, type Recorded } from "../mailbox/fake-db";

/**
 * Each stop trigger in intake SOP order, against the in-memory PostgREST fake:
 * the fact is recorded → every running enrollment for that lead stops with the
 * named reason, a drip_stopped timeline row says why, and nothing outside the
 * row's own org (or outside the lead) is touched. The signed-quote trigger on
 * /q/[token] is covered in tests/quotes/public.test.ts; the advance() guard in
 * ./advance.test.ts.
 */

const ORG = "org-1";
const OTHER = "org-2";
const USER = "user-1";

const state = vi.hoisted(() => ({ db: null as unknown as { from: (t: string) => unknown } | null }));

function scoped(db: FakeDb) {
  return {
    from: (t: string) => db.from(t),
    rpc: async (name: string) => ({ data: name === "current_org_id" ? ORG : "owner", error: null }),
    auth: { getUser: async () => ({ data: { user: { id: USER, email: "taylor@example.com" } }, error: null }) },
  };
}

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => state.db),
}));
vi.mock("@/lib/org/profile", () => ({
  getFirmTimeZone: vi.fn(async () => "America/New_York"),
  getOrgProfile: vi.fn(async () => null),
}));
// moveLeadStage's neighbours: the matter handoff and the automation engine have
// their own suites; here only the stop is under test.
vi.mock("@/lib/matters", () => ({
  ensureMatterForLead: vi.fn(async () => null),
  logActivitySafe: vi.fn(async () => undefined),
}));
vi.mock("@/lib/automation", () => ({ runRules: vi.fn(async () => undefined) }));

const { recordManualPayment, reconcilePendingPayment } = await import("@/lib/payments/quote-payments");
const { moveLeadStage } = await import("@/lib/pipeline/leads");
const { createMatter } = await import("@/lib/matters/matters");
const { applyRun } = await import("@/lib/mailbox/apply");
const { enrollLead, stopEnrollment } = await import("@/lib/automation/drips");

function baseTables(): Record<string, Row[]> {
  return {
    crm_lead: [
      { id: "lead-1", org_id: ORG, first_name: "Dana", last_name: "Reyes", business_name: null, email: "dana@acme.example", current_stage_id: "st-open", stage_entered_at: "2026-09-30T12:00:00Z", last_inbound_at: null },
      { id: "lead-2", org_id: ORG, first_name: "Ola", last_name: "Bee", business_name: null, email: "ola@bee.example", current_stage_id: "st-open", stage_entered_at: "2026-09-30T12:00:00Z", last_inbound_at: null },
    ],
    crm_stage: [
      { id: "st-open", org_id: ORG, name: "Potential New Client", category: "open" },
      { id: "st-won", org_id: ORG, name: "Signed LOE / Deposit Received", category: "won" },
    ],
    crm_quote: [{ id: "q-1", org_id: ORG, lead_id: "lead-1", contact_id: null, matter_id: null, status: "sent", currency: "USD", title: "TM", accepted_at: null }],
    crm_drip_sequence: [{ id: "seq-1", org_id: ORG, name: "UGW nurture", active: true }],
    crm_drip_enrollment: [
      { id: "e-1", org_id: ORG, lead_id: "lead-1", sequence_id: "seq-1", status: "active", enrolled_at: "2026-10-01T12:00:00Z", current_step: 1 },
      { id: "e-2", org_id: ORG, lead_id: "lead-2", sequence_id: "seq-1", status: "active", enrolled_at: "2026-10-01T12:00:00Z", current_step: 1 },
      { id: "e-x", org_id: OTHER, lead_id: "lead-1", sequence_id: "seq-x", status: "active", enrolled_at: "2026-10-01T12:00:00Z", current_step: 1 },
    ],
    crm_payment: [],
    crm_matter: [],
    crm_meeting: [],
    crm_activity: [],
    crm_quote_event: [],
  };
}

let db: FakeDb;
beforeEach(() => {
  db = new FakeDb(baseTables());
  state.db = scoped(db);
});

const enr = (id: string) => db.tables.crm_drip_enrollment.find((e) => e.id === id)!;
const stops = () => db.tables.crm_activity.filter((a) => a.type === "drip_stopped");

describe("stop triggers — each fires when the fact is recorded, fenced on the row's org", () => {
  it("payment recorded by hand → paid", async () => {
    const result = await recordManualPayment({
      quoteId: "q-1",
      userId: USER,
      amount: "1950",
      accountKind: "operating",
      purpose: "legal_fee",
    });
    expect(result).toEqual({ ok: true });
    expect(enr("e-1")).toMatchObject({ status: "stopped", stop_reason: "paid" });
    expect(enr("e-2").status).toBe("active");
    expect(enr("e-x").status).toBe("active");
    expect(stops()).toHaveLength(1);
    expect(stops()[0]).toMatchObject({ org_id: ORG, lead_id: "lead-1", actor_type: "user", actor_id: USER, payload: expect.objectContaining({ reason: "paid", quote_id: "q-1" }) });
  });

  it("a LawPay attempt confirmed as taken → paid; confirmed as not taken stops nothing", async () => {
    db.tables.crm_payment.push(
      { id: "p-1", org_id: ORG, quote_id: "q-1", status: "pending", provider: "lawpay" },
      { id: "p-2", org_id: ORG, quote_id: "q-1", status: "pending", provider: "lawpay" },
    );
    expect(await reconcilePendingPayment({ paymentId: "p-2", outcome: "failed" })).toEqual({ ok: true });
    expect(enr("e-1").status).toBe("active");
    expect(await reconcilePendingPayment({ paymentId: "p-1", outcome: "succeeded" })).toEqual({ ok: true });
    expect(enr("e-1")).toMatchObject({ status: "stopped", stop_reason: "paid" });
  });

  it("lead moved to a won stage → client; a move to an open stage stops nothing", async () => {
    await moveLeadStage("lead-2", "st-open");
    expect(enr("e-2").status).toBe("active");
    await moveLeadStage("lead-2", "st-won");
    expect(enr("e-2")).toMatchObject({ status: "stopped", stop_reason: "client" });
    expect(enr("e-1").status).toBe("active");
    expect(stops()[0].payload).toMatchObject({ reason: "client", stage_name: "Signed LOE / Deposit Received" });
  });

  it("matter opened for the lead → matter_opened; a matter with no lead stops nothing", async () => {
    await createMatter({ type: "TM", title: "No lead", matterNumber: "TM-2026-0001" });
    expect(enr("e-1").status).toBe("active");
    await createMatter({ type: "TM", leadId: "lead-1", title: "Dana", matterNumber: "TM-2026-0002" });
    expect(enr("e-1")).toMatchObject({ status: "stopped", stop_reason: "matter_opened" });
    expect(enr("e-x").status).toBe("active");
  });

  it("manual stop on one enrollment → that enrollment only, with the reason a person chose", async () => {
    db.tables.crm_drip_enrollment.push({ id: "e-3", org_id: ORG, lead_id: "lead-1", sequence_id: "seq-2", status: "paused", enrolled_at: "2026-10-01T12:00:00Z" });
    const after = await stopEnrollment("e-3", "unsubscribed");
    expect(after).toMatchObject({ status: "stopped", stop_reason: "unsubscribed" });
    expect(enr("e-1").status).toBe("active");
    await expect(stopEnrollment("e-3", "manual")).rejects.toThrow(/already stopped/);
  });
});

describe("inbound reply matched by the mailbox sync → replied", () => {
  function report(lastInboundAt: string, prior: string | null) {
    return {
      leads: [
        {
          lead: { id: "lead-1", firstName: "Dana", lastName: "Reyes", businessName: null, email: "dana@acme.example", markText: null, stageName: null, assignedTo: null, lastOutboundAt: null, lastInboundAt: prior },
          matched: [],
          cadence: { lastOutboundAt: null, lastInboundAt, replied: true, touches: [{ messageId: "m-1", at: lastInboundAt, type: "email_received", fromAddress: "dana@acme.example" }] },
          corroboration: [],
          recoveredEmail: null,
          senderInitials: [],
          senderMailboxes: [],
          newReply: false,
        },
      ],
      ambiguous: [],
      unmatched: [],
      totals: {},
    };
  }

  function run(lastInboundAt: string, prior: string | null, enrolledAt = "2026-10-01T12:00:00Z") {
    const rows: Record<string, Row[]> = {
      crm_drip_enrollment: [
        { id: "e-1", org_id: ORG, lead_id: "lead-1", sequence_id: "seq-1", status: "active", enrolled_at: enrolledAt },
      ],
    };
    const handler = (q: Recorded) => {
      if (q.table === "crm_drip_enrollment" && q.action === "update") {
        const inLead = q.filters.find((f) => f.column === "lead_id")?.value as string[];
        const before = q.filters.find((f) => f.op === "lt")?.value as string | undefined;
        const org = q.filters.find((f) => f.column === "org_id")?.value;
        const hit = rows.crm_drip_enrollment.filter(
          (e) => e.org_id === org && inLead.includes(e.lead_id as string) && e.status === "active" && (!before || Date.parse(e.enrolled_at as string) < Date.parse(before)),
        );
        for (const e of hit) Object.assign(e, q.values as Row);
        return { data: hit.map((e) => ({ id: e.id, lead_id: e.lead_id, sequence_id: e.sequence_id })), error: null };
      }
      return undefined;
    };
    const { client, log } = fakeAdmin(handler);
    return { rows, log, promise: applyRun(client as never, { orgId: ORG, report: report(lastInboundAt, prior) as never, planned: [], memberRoles: new Map() }) };
  }

  it("stops a sequence that was running when the reply arrived, fenced on the connection's org", async () => {
    const { rows, log, promise } = run("2026-10-04T10:00:00Z", null);
    await promise;
    expect(rows.crm_drip_enrollment[0]).toMatchObject({ status: "stopped", stop_reason: "replied" });
    const update = log.find((q) => q.table === "crm_drip_enrollment" && q.action === "update")!;
    expect(update.filters).toContainEqual({ op: "eq", column: "org_id", value: ORG });
    expect(update.filters).toContainEqual({ op: "lt", column: "enrolled_at", value: "2026-10-04T10:00:00Z" });
    const act = log.find((q) => q.table === "crm_activity" && q.action === "insert" && Array.isArray(q.values) && (q.values as Row[])[0]?.type === "drip_stopped");
    expect(act).toBeTruthy();
  });

  it("does not stop a sequence enrolled after the reply, nor re-stop on a reply already seen", async () => {
    const later = run("2026-10-04T10:00:00Z", null, "2026-10-05T00:00:00Z");
    await later.promise;
    expect(later.rows.crm_drip_enrollment[0].status).toBe("active");

    const seen = run("2026-10-04T10:00:00Z", "2026-10-04T10:00:00Z");
    await seen.promise;
    expect(seen.log.some((q) => q.table === "crm_drip_enrollment")).toBe(false);
  });
});

describe("enrolling refuses a lead who is already a client — and says why", () => {
  it("signed quote → refused with the date; nothing enrolled", async () => {
    db.tables.crm_quote[0].status = "accepted";
    db.tables.crm_quote[0].accepted_at = "2026-10-03T21:10:00Z";
    await expect(enrollLead("lead-2", "seq-1")).resolves.toBeTruthy(); // lead-2 is not a client
    await expect(enrollLead("lead-1", "seq-1")).rejects.toThrow("Dana Reyes is already a client — signed a quote on Oct 3.");
  });

  it("won stage, open matter or a payment each refuse; an unreadable state refuses too", async () => {
    db.tables.crm_lead[0].current_stage_id = "st-won";
    await expect(enrollLead("lead-1", "seq-1")).rejects.toThrow(/is in a won stage/);
    db.tables.crm_lead[0].current_stage_id = "st-open";
    db.tables.crm_matter.push({ id: "m-1", org_id: ORG, lead_id: "lead-1", created_at: "2026-10-05T09:00:00Z" });
    await expect(enrollLead("lead-1", "seq-1")).rejects.toThrow(/has a matter open/);
    db.tables.crm_matter = [];
    db.tables.crm_payment.push({ id: "p-1", org_id: ORG, quote_id: "q-1", status: "succeeded", occurred_at: "2026-10-02T03:00:00Z" });
    await expect(enrollLead("lead-1", "seq-1")).rejects.toThrow(/paid on Oct 1|paid on Oct 2/);
    db.tables.crm_payment = [];
    db.failTable = "crm_quote";
    await expect(enrollLead("lead-1", "seq-1")).rejects.toThrow(/Couldn't confirm this lead isn't already a client/);
  });

  it("re-enrolling a stopped enrollment says it was stopped, instead of pretending to enroll", async () => {
    db.tables.crm_drip_enrollment = [
      { id: "e-s", org_id: ORG, lead_id: "lead-2", sequence_id: "seq-1", status: "stopped", stop_reason: "replied", stopped_at: "2026-10-04T10:00:00Z" },
    ];
    db.unique.crm_drip_enrollment = [["lead_id", "sequence_id"]];
    await expect(enrollLead("lead-2", "seq-1")).rejects.toThrow("Sequence stopped — replied, Oct 4");
  });
});
