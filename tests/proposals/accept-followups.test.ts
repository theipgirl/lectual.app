import { describe, it, expect, vi, afterEach } from "vitest";
import {
  NOTE_TARGET_TEXT,
  acceptanceHeadline,
  acceptanceNoteBody,
  addAcceptanceNote,
  resolveNoteTarget,
  runAcceptanceFollowups,
  type FollowupDb,
} from "@/lib/proposals/accept-followups";
import type { FetchLike } from "@/lib/lawmatics/writes";
import { acceptedSnapshot } from "./accepted-fixture";
import { fakeFollowupDb, type Row } from "./followup-db";

const PROPOSAL = "prop-1";
const snapshot = acceptedSnapshot({ classes: 2, marks: ["word", "logo"], adjustments: [{ id: "a", label: "Event discount", kind: "amount", value: 25_000 }] });

function world(over: { proposal?: Row; leads?: Row[]; matters?: Row[]; failInsert?: Parameters<typeof fakeFollowupDb>[1] } = {}) {
  return fakeFollowupDb(
    {
      client_proposal: [
        {
          id: PROPOSAL,
          org_id: "org-1",
          family_id: "fam-1",
          status: "accepted",
          client_name: "Sevetri Wilson",
          client_email: "Sevetri@Example.com",
          lead_id: null,
          matter_id: null,
          accepted_snapshot: snapshot,
          ...over.proposal,
        },
        // Another firm's accepted proposal: never touched.
        { id: "prop-x", org_id: "org-2", family_id: "fam-x", status: "accepted", client_name: "Other Firm Client", client_email: null, lead_id: null, matter_id: null, accepted_snapshot: snapshot },
      ],
      client_proposal_setting: [
        { org_id: "org-1", approver_user_ids: ["u-appr1", "u-appr2", "u-intake1", "u-gone"] },
        { org_id: "org-2", approver_user_ids: ["x-appr"] },
      ],
      crm_org_member: [
        { org_id: "org-1", user_id: "u-appr1", role: "owner" },
        { org_id: "org-1", user_id: "u-appr2", role: "attorney" },
        { org_id: "org-1", user_id: "u-intake1", role: "intake" },
        { org_id: "org-1", user_id: "u-intake2", role: "intake" },
        { org_id: "org-1", user_id: "u-para", role: "paralegal" },
        { org_id: "org-2", user_id: "x-appr", role: "owner" },
        { org_id: "org-2", user_id: "x-intake", role: "intake" },
      ],
      crm_lead: over.leads ?? [],
      crm_matter: over.matters ?? [],
      client_proposal_event: [],
      crm_notification: [],
    },
    over.failInsert,
  );
}

function fakeFetch(status = 200) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => ({}), text: async () => "echo of the note body" };
  };
  return { fetchImpl, calls };
}

const LEAD_WITH_LM = { id: "lead-1", org_id: "org-1", email: "sevetri@example.com", lawmatics_id: "LM-LEAD" };
const tokenFor = (tokens: Record<string, string | null>) => async (_db: FollowupDb, orgId: string) => tokens[orgId] ?? null;

afterEach(() => vi.restoreAllMocks());

describe("acceptanceHeadline and the note body", () => {
  it("the headline is client + package + the LEGAL total only", () => {
    expect(acceptanceHeadline({ clientName: "Sevetri Wilson", packageName: "Concierge", legalTotalCents: 495_000 })).toBe("Sevetri Wilson accepted Concierge · legal $4,950");
    expect(acceptanceHeadline({ clientName: "", packageName: "", legalTotalCents: 100 })).toBe("A client accepted their proposal · legal $1");
  });

  it("the note shows legal and USPTO as two separate numbers, never summed", () => {
    const { name, body } = acceptanceNoteBody(snapshot, "Sevetri Wilson");
    expect(name).toBe("Proposal accepted: Concierge");
    const legal = snapshot.quote.legal_total_cents;
    const gov = snapshot.quote.gov_total_cents;
    const fmt = (c: number) => `$${(c / 100).toLocaleString("en-US")}`;
    expect(body).toContain(`Legal fee, due when accepted: ${fmt(legal)}`);
    expect(body).toContain(`USPTO fees, due at filing: ${fmt(gov)}`);
    expect(body).not.toContain(fmt(legal + gov));
    expect(body).toContain("Prosperall");
    expect(body).toContain("Adjustment: Event discount −$250");
  });
});

describe("the in-app notice", () => {
  it("inserts one approval_needed row per recipient: approvers still in the firm plus intake staff, de-duplicated, same org only", async () => {
    const { db, tables } = world();
    await runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({}) });
    const rows = tables.crm_notification;
    expect(rows.map((r) => r.user_id).sort()).toEqual(["u-appr1", "u-appr2", "u-intake1", "u-intake2"]);
    expect(rows.every((r) => r.org_id === "org-1" && r.kind === "approval_needed")).toBe(true);
    // Not the other firm's people, not a paralegal, not an approver id that left the firm.
    for (const never of ["x-appr", "x-intake", "u-para", "u-gone"]) expect(rows.map((r) => r.user_id)).not.toContain(never);
  });

  it("takes org_id from the proposal row, whatever the caller passes for the other firm's data", async () => {
    const { db, tables, calls } = world();
    // The caller names org-1 and a proposal that belongs to org-2: the read is fenced on both, finds nothing, writes nothing.
    await runAcceptanceFollowups(db, { proposalId: "prop-x", orgId: "org-1" }, { getToken: tokenFor({}) });
    expect(tables.crm_notification).toHaveLength(0);
    expect(tables.client_proposal_event).toHaveLength(0);
    expect(calls.find((c) => c.table === "client_proposal")!.filters).toEqual([["id", "prop-x"], ["org_id", "org-1"]]);
  });

  it("the payload is exactly source, proposal_id and headline", async () => {
    const { db, tables } = world();
    await runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({}) });
    for (const row of tables.crm_notification) {
      const payload = row.payload as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(["headline", "proposal_id", "source"]);
      expect(payload).toMatchObject({ source: "proposal_accepted", proposal_id: PROPOSAL });
      const wire = JSON.stringify(row);
      for (const leak of ["sevetri@example.com", "Prosperall", "accepted_snapshot", "public_token", "usptoFees"]) expect(wire).not.toContain(leak);
      // The headline has the legal total only: the USPTO figure is nowhere in the row.
      expect(wire).not.toContain(`$${(snapshot.quote.gov_total_cents / 100).toLocaleString("en-US")}`);
    }
  });

  it("writes the outcome to the timeline as the system, in the proposal's own org", async () => {
    const { db, tables } = world();
    await runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({}) });
    const events = tables.client_proposal_event;
    expect(events.map((e) => (e.payload as Record<string, unknown>).step)).toEqual(["accept_notice", "lawmatics_note"]);
    expect(events.every((e) => e.type === "edited" && e.actor === "system" && e.actor_user_id === null && e.org_id === "org-1" && e.proposal_id === PROPOSAL && e.family_id === "fam-1")).toBe(true);
    expect((events[0].payload as Record<string, unknown>).outcome).toBe("sent");
  });

  it("no approvers or intake staff: skipped, with the reason on the timeline", async () => {
    const { db, tables } = world();
    tables.crm_org_member = [{ org_id: "org-1", user_id: "u-para", role: "paralegal" }];
    tables.client_proposal_setting = [];
    await runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({}) });
    expect(tables.crm_notification).toHaveLength(0);
    expect(tables.client_proposal_event[0].payload).toMatchObject({ step: "accept_notice", outcome: "skipped" });
  });
});

describe("once per accepted version", () => {
  it("a second run adds no second notification and no second note", async () => {
    const { db, tables } = world({ leads: [LEAD_WITH_LM], proposal: { lead_id: "lead-1" } });
    const { fetchImpl, calls } = fakeFetch();
    const deps = { getToken: tokenFor({ "org-1": "tok-1" }), fetchImpl };
    await runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, deps);
    await runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, deps);
    expect(tables.crm_notification).toHaveLength(4);
    expect(calls).toHaveLength(1);
    expect(tables.client_proposal_event).toHaveLength(2);
  });

  it("a first attempt that failed does not block a later retry", async () => {
    let refuse = true;
    const { db, tables } = world({ failInsert: { failInsert: (table) => (table === "crm_notification" && refuse ? "error" : null) } });
    await runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({}) });
    expect(tables.crm_notification).toHaveLength(0);
    expect(tables.client_proposal_event.find((e) => (e.payload as Record<string, unknown>).step === "accept_notice")!.payload).toMatchObject({ outcome: "failed" });
    refuse = false;
    await runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({}) });
    expect(tables.crm_notification).toHaveLength(4);
    // The failed note step ("Lawmatics isn't connected") is tried again too, and the notice is not repeated after it lands.
    await runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({}) });
    expect(tables.crm_notification).toHaveLength(4);
  });

  it("a version that is not accepted gets nothing", async () => {
    const { db, tables } = world({ proposal: { status: "sent" } });
    await runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({ "org-1": "t" }) });
    expect(tables.crm_notification).toHaveLength(0);
    expect(tables.client_proposal_event).toHaveLength(0);
  });

  it("an unreadable timeline holds the note back (a second note is worse than none) but not the internal notice", async () => {
    const { db, tables } = world({ leads: [LEAD_WITH_LM], proposal: { lead_id: "lead-1" } });
    const { fetchImpl, calls } = fakeFetch();
    const failing = fakeFollowupDb(tables, { failSelect: (t) => t === "client_proposal_event" });
    await runAcceptanceFollowups(failing.db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({ "org-1": "t" }), fetchImpl });
    expect(calls).toHaveLength(0);
    expect(tables.crm_notification).toHaveLength(4);
    expect(db).toBeTruthy();
  });
});

describe("resolveNoteTarget", () => {
  const base = { orgId: "org-1", matterId: null, leadId: null, clientEmail: "sevetri@example.com" } as const;
  const dbWith = (matters: Row[], leads: Row[]) => fakeFollowupDb({ crm_matter: matters, crm_lead: leads }).db;

  it("the matter id wins over the lead id", async () => {
    const db = dbWith([{ id: "m1", org_id: "org-1", lawmatics_id: "LM-MATTER" }], [LEAD_WITH_LM]);
    expect(await resolveNoteTarget(db, { ...base, matterId: "m1", leadId: "lead-1" })).toEqual({ ok: true, notableType: "Prospect", notableId: "LM-MATTER" });
  });

  it("the lead id wins over the email", async () => {
    const db = dbWith([], [LEAD_WITH_LM, { id: "lead-2", org_id: "org-1", email: "sevetri@example.com", lawmatics_id: "LM-OTHER" }]);
    expect(await resolveNoteTarget(db, { ...base, leadId: "lead-1" })).toMatchObject({ ok: true, notableId: "LM-LEAD" });
  });

  it("exactly one lead with that email (case-insensitive) is used", async () => {
    const db = dbWith([], [{ id: "lead-9", org_id: "org-1", email: "SEVETRI@example.com", lawmatics_id: 4412 }, { id: "lead-8", org_id: "org-2", email: "sevetri@example.com", lawmatics_id: "LM-OTHER-FIRM" }]);
    expect(await resolveNoteTarget(db, base)).toEqual({ ok: true, notableType: "Prospect", notableId: "4412" });
  });

  it("two qualifying leads give no note: 'more than one record matches'", async () => {
    const db = dbWith([], [{ ...LEAD_WITH_LM, id: "a" }, { ...LEAD_WITH_LM, id: "b", lawmatics_id: "LM-2" }]);
    const r = await resolveNoteTarget(db, base);
    expect(r).toEqual({ ok: false, reason: "more_than_one" });
    expect(NOTE_TARGET_TEXT.more_than_one).toBe("more than one record matches");
  });

  it("zero give no note: 'no Lawmatics record found'", async () => {
    expect(await resolveNoteTarget(dbWith([], []), base)).toEqual({ ok: false, reason: "none" });
    expect(NOTE_TARGET_TEXT.none).toBe("no Lawmatics record found");
    expect(await resolveNoteTarget(dbWith([], [LEAD_WITH_LM]), { ...base, clientEmail: null })).toEqual({ ok: false, reason: "none" });
  });

  it("a matter or lead with no lawmatics_id falls through to the next rule", async () => {
    const db = dbWith([{ id: "m1", org_id: "org-1", lawmatics_id: null }], [{ id: "lead-1", org_id: "org-1", email: "x@y.com", lawmatics_id: "" }, { id: "lead-7", org_id: "org-1", email: "sevetri@example.com", lawmatics_id: "LM-BY-EMAIL" }]);
    expect(await resolveNoteTarget(db, { ...base, matterId: "m1", leadId: "lead-1" })).toMatchObject({ ok: true, notableId: "LM-BY-EMAIL" });
  });

  it("an email match with no lawmatics_id does not count", async () => {
    const db = dbWith([], [{ id: "a", org_id: "org-1", email: "sevetri@example.com", lawmatics_id: null }]);
    expect(await resolveNoteTarget(db, base)).toEqual({ ok: false, reason: "none" });
  });

  it("a failed read is 'unreadable', never 'none'", async () => {
    const { db } = fakeFollowupDb({ crm_lead: [LEAD_WITH_LM] }, { failSelect: () => true });
    expect(await resolveNoteTarget(db, { ...base, leadId: "lead-1" })).toEqual({ ok: false, reason: "unreadable" });
  });

  it("is fenced on the proposal's org", async () => {
    const db = dbWith([{ id: "m1", org_id: "org-2", lawmatics_id: "LM-OTHER" }], [{ id: "lead-1", org_id: "org-2", email: "sevetri@example.com", lawmatics_id: "LM-OTHER" }]);
    expect(await resolveNoteTarget(db, { ...base, matterId: "m1", leadId: "lead-1" })).toEqual({ ok: false, reason: "none" });
  });
});

describe("the Lawmatics note request", () => {
  it("is POST /notes with the firm's own token and exactly name, body, notable_type, notable_id", async () => {
    const { db, tables } = world({ leads: [LEAD_WITH_LM], proposal: { lead_id: "lead-1" } });
    const { fetchImpl, calls } = fakeFetch();
    await runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({ "org-1": "TOKEN-ORG-1", "org-2": "TOKEN-ORG-2" }), fetchImpl });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe("https://api.lawmatics.com/v1/notes");
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe("Bearer TOKEN-ORG-1");
    expect(JSON.stringify(call.headers)).not.toContain("TOKEN-ORG-2");
    expect(Object.keys(call.body).sort()).toEqual(["body", "name", "notable_id", "notable_type"]);
    expect(call.body).toMatchObject({ notable_type: "Prospect", notable_id: "LM-LEAD" });
    expect(tables.client_proposal_event.find((e) => (e.payload as Record<string, unknown>).step === "lawmatics_note")!.payload).toMatchObject({ outcome: "added" });
  });

  it("a firm with no active connection makes no request: 'Lawmatics isn't connected'", async () => {
    const { db, tables } = world({ leads: [LEAD_WITH_LM], proposal: { lead_id: "lead-1" } });
    const { fetchImpl, calls } = fakeFetch();
    await runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({ "org-2": "TOKEN-ORG-2" }), fetchImpl });
    expect(calls).toHaveLength(0);
    expect(tables.client_proposal_event.find((e) => (e.payload as Record<string, unknown>).step === "lawmatics_note")!.payload).toMatchObject({ outcome: "blocked", reason: "Lawmatics isn't connected" });
  });

  it("no target means no request and the reason on the timeline", async () => {
    const { db, tables } = world();
    const { fetchImpl, calls } = fakeFetch();
    await runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({ "org-1": "t" }), fetchImpl });
    expect(calls).toHaveLength(0);
    expect(tables.client_proposal_event.find((e) => (e.payload as Record<string, unknown>).step === "lawmatics_note")!.payload).toMatchObject({ outcome: "blocked", reason: "no Lawmatics record found" });
  });

  it("a non-2xx answer and a thrown request are 'failed' and never throw", async () => {
    const world1 = world({ leads: [LEAD_WITH_LM], proposal: { lead_id: "lead-1" } });
    const r500 = fakeFetch(500);
    await runAcceptanceFollowups(world1.db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({ "org-1": "t" }), fetchImpl: r500.fetchImpl });
    expect(world1.tables.client_proposal_event.find((e) => (e.payload as Record<string, unknown>).step === "lawmatics_note")!.payload).toMatchObject({ outcome: "failed", reason: "Lawmatics answered 500" });

    const world2 = world({ leads: [LEAD_WITH_LM], proposal: { lead_id: "lead-1" } });
    const throwing: FetchLike = async () => {
      throw new Error("socket hang up for sevetri@example.com");
    };
    await runAcceptanceFollowups(world2.db, { proposalId: PROPOSAL, orgId: "org-1" }, { getToken: tokenFor({ "org-1": "t" }), fetchImpl: throwing });
    const payload = world2.tables.client_proposal_event.find((e) => (e.payload as Record<string, unknown>).step === "lawmatics_note")!.payload;
    expect(payload).toMatchObject({ outcome: "failed" });
    // The error's own text (which could carry client data) never reaches the timeline.
    expect(JSON.stringify(payload)).not.toContain("sevetri@example.com");
  });

  it("addAcceptanceNote with no token never calls out", async () => {
    const { db } = world();
    const { fetchImpl, calls } = fakeFetch();
    expect(await addAcceptanceNote(db, { id: PROPOSAL, orgId: "org-1", clientName: "x", clientEmail: null, matterId: null, leadId: null, snapshot }, null, fetchImpl)).toEqual({
      outcome: "blocked",
      reason: "Lawmatics isn't connected",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("nothing here throws, and nothing logs record data", () => {
  it("a throwing notification insert, a throwing token read and a failing event write each leave the run resolved", async () => {
    const cases: Array<[string, Parameters<typeof fakeFollowupDb>[1], Parameters<typeof runAcceptanceFollowups>[2]]> = [
      ["throwing notification insert", { failInsert: (t) => (t === "crm_notification" ? "throw" : null) }, { getToken: tokenFor({}) }],
      ["failing event write", { failInsert: (t) => (t === "client_proposal_event" ? "error" : null) }, { getToken: tokenFor({}) }],
      ["throwing event write", { failInsert: (t) => (t === "client_proposal_event" ? "throw" : null) }, { getToken: tokenFor({}) }],
      ["throwing token read", {}, { getToken: async () => { throw new Error("vault down"); } }],
    ];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const logs = [vi.spyOn(console, "info").mockImplementation(() => {}), vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
    for (const [name, failing, deps] of cases) {
      const { db } = world({ failInsert: failing, leads: [LEAD_WITH_LM], proposal: { lead_id: "lead-1" } });
      await expect(runAcceptanceFollowups(db, { proposalId: PROPOSAL, orgId: "org-1" }, deps), name).resolves.toBeUndefined();
    }
    const everything = JSON.stringify([...errors.mock.calls, ...logs.flatMap((l) => l.mock.calls)]);
    for (const secret of ["Sevetri", "sevetri@example.com", "Prosperall", "TOKEN", "vault down", "insert exploded"]) expect(everything).not.toContain(secret);
  });

  it("a database that throws on the very first read resolves quietly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exploding: FollowupDb = {
      from: () => {
        throw new Error("network down");
      },
    };
    await expect(runAcceptanceFollowups(exploding, { proposalId: PROPOSAL, orgId: "org-1" })).resolves.toBeUndefined();
  });
});
