import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * loadRecordCard: ONE record re-read through the scoped client; a foreign or missing id is `not-found` and nothing else
 * is read for it; a merged lead follows its keeper; each source is its own three-state read; it never throws.
 */
const ASKED = "11111111-1111-4111-8111-111111111111";
const KEEPER = "22222222-2222-4222-8222-222222222222";
const MATTER = "33333333-3333-4333-8333-333333333333";

const m = {
  session: vi.fn(),
  scoped: vi.fn(),
  resolveLeadId: vi.fn(),
  mergeAvailable: vi.fn(),
  getLead: vi.fn(),
  listStages: vi.fn(),
  tagsForLead: vi.fn(),
  listTags: vi.fn(),
  loadLeadStepFacts: vi.fn(),
  listMemberDirectory: vi.fn(),
  readRecordDocuments: vi.fn(),
  modules: vi.fn(),
  zone: vi.fn(),
  listProposals: vi.fn(),
  loadTemperatureFacts: vi.fn(),
  getMatter: vi.fn(),
  listMatterDeadlines: vi.fn(),
  listMatterStages: vi.fn(),
  taskRead: vi.fn(),
  activityRead: vi.fn(),
};

vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: (...a: unknown[]) => m.session(...a) }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: (...a: unknown[]) => m.scoped(...a) }));
vi.mock("@/lib/leads/live", () => ({ resolveLeadId: (...a: unknown[]) => m.resolveLeadId(...a), mergeAvailable: (...a: unknown[]) => m.mergeAvailable(...a) }));
vi.mock("@/lib/pipeline/leads", () => ({ getLead: (...a: unknown[]) => m.getLead(...a) }));
vi.mock("@/lib/pipeline/stages", () => ({ listStages: (...a: unknown[]) => m.listStages(...a) }));
vi.mock("@/lib/pipeline/tags", () => ({ tagsForLead: (...a: unknown[]) => m.tagsForLead(...a), listTags: (...a: unknown[]) => m.listTags(...a) }));
vi.mock("@/lib/lead-step/load", () => ({ loadLeadStepFacts: (...a: unknown[]) => m.loadLeadStepFacts(...a) }));
vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: (...a: unknown[]) => m.listMemberDirectory(...a) }));
vi.mock("@/lib/review/detail-load", () => ({ readRecordDocuments: (...a: unknown[]) => m.readRecordDocuments(...a) }));
vi.mock("@/lib/org/modules", () => ({ activeOrgModulesOrNull: (...a: unknown[]) => m.modules(...a) }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: (...a: unknown[]) => m.zone(...a) }));
vi.mock("@/lib/proposals/store", () => ({ listProposals: (...a: unknown[]) => m.listProposals(...a) }));
vi.mock("@/lib/intake/facts", () => ({ loadTemperatureFacts: (...a: unknown[]) => m.loadTemperatureFacts(...a) }));
vi.mock("@/lib/matters/matters", () => ({ getMatter: (...a: unknown[]) => m.getMatter(...a) }));
vi.mock("@/lib/matters/deadlines", () => ({ listMatterDeadlines: (...a: unknown[]) => m.listMatterDeadlines(...a) }));
vi.mock("@/lib/matters/stages", () => ({ listMatterStages: (...a: unknown[]) => m.listMatterStages(...a) }));

/** A scoped client double: crm_task and crm_activity answer from the two mocks; every chained filter is accepted. */
function client() {
  return {
    from(table: string) {
      const read = table === "crm_task" ? m.taskRead : m.activityRead;
      const chain: Record<string, unknown> = {};
      for (const k of ["select", "eq", "order", "limit", "in"]) chain[k] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(() => read(table)).then(resolve, reject);
      return chain;
    },
  };
}

const LEAD_ROW = {
  id: KEEPER,
  first_name: "Maya",
  last_name: "Okafor",
  business_name: "Okafor Studio",
  email: "maya@example.com",
  phone: "4045550100",
  current_stage_id: "s1",
  assigned_to: null,
  referral_source: "UGW",
  last_activity_at: null,
  last_inbound_at: null,
  last_outbound_at: null,
  lane: null,
  lane_set_at: null,
  ai_summary: null,
  temperature: null,
  stage_entered_at: null,
};

const facts = { status: "ok", facts: { timeZone: "America/Chicago", lead: { mergedIds: [KEEPER, ASKED] }, approvals: { status: "ok", value: { items: [{ id: "q1" }, { id: "q2" }], total: 2 } } } };

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ kind: "ok", role: "attorney", user: { id: "u" }, actingAsStaff: false });
  m.scoped.mockImplementation(async () => client());
  m.resolveLeadId.mockResolvedValue({ status: "ok", id: KEEPER });
  m.mergeAvailable.mockResolvedValue(true);
  m.getLead.mockResolvedValue(LEAD_ROW);
  m.listStages.mockResolvedValue([{ id: "s1", name: "New", category: "open" }]);
  m.tagsForLead.mockResolvedValue([{ id: "t1", label: "VIP", color: null, org_id: "o" }]);
  m.listTags.mockResolvedValue([{ id: "t1", label: "VIP", color: null }, { id: "t2", label: "UGW", color: "#fff" }]);
  m.loadLeadStepFacts.mockResolvedValue(facts);
  m.listMemberDirectory.mockResolvedValue([{ userId: "u", displayName: "Rebecca", email: "r@x.com", role: "owner" }]);
  m.readRecordDocuments.mockResolvedValue({ files: { status: "ok", rows: [] }, letters: null });
  m.modules.mockResolvedValue(["proposals"]);
  m.zone.mockResolvedValue("America/New_York");
  m.listProposals.mockResolvedValue([{ id: "p1", version: 2, status: "sent", legal_total_cents: 407500, gov_total_cents: 70000 }]);
  m.loadTemperatureFacts.mockResolvedValue({ status: "ok", byLead: {} });
  m.getMatter.mockResolvedValue({ id: MATTER, title: "OKAFOR", mark_text: "OKAFOR", owner_name: "Maya", matter_number: "TM-1", stage_id: "m1", assigned_to: null, referral_source: null });
  m.listMatterDeadlines.mockResolvedValue([{ id: "d1", status: "open", due_date: "2026-12-01", title: null, attorney_confirmed: false }]);
  m.listMatterStages.mockResolvedValue([{ id: "m1", label: "Filed", code: "f", order_index: 1, is_open: true, waiting_on: null }]);
  m.taskRead.mockResolvedValue({ data: [{ id: "t", title: "Check", due_at: null, assignee_id: null }], error: null });
  m.activityRead.mockResolvedValue({ data: [{ id: "a1", type: "note", created_at: "2026-11-10T00:00:00Z" }], error: null });
});

const load = async (ref: { kind: "lead" | "matter"; id: string }, opts = {}) => (await import("@/lib/record-card/load")).loadRecordCard(ref, opts);

/** Every source read other than the record itself. */
const otherReads = () => [m.listStages, m.tagsForLead, m.listTags, m.loadLeadStepFacts, m.listMemberDirectory, m.readRecordDocuments, m.listProposals, m.listMatterDeadlines, m.listMatterStages, m.taskRead, m.activityRead];

describe("loadRecordCard: the record is the gate", () => {
  it("a non-uuid id is not-found and nothing is read", async () => {
    expect(await load({ kind: "lead", id: "x" })).toEqual({ status: "not-found" });
    expect(m.session).not.toHaveBeenCalled();
  });

  it("another firm's (or a random) lead id is not-found, with no field of the record and no other read", async () => {
    m.resolveLeadId.mockResolvedValueOnce({ status: "not-found" });
    expect(await load({ kind: "lead", id: ASKED })).toEqual({ status: "not-found" });
    expect(m.getLead).not.toHaveBeenCalled();
    for (const fn of otherReads()) expect(fn).not.toHaveBeenCalled();
  });

  it("a lead the scoped read can't see is not-found; one whose read fails is unavailable", async () => {
    m.getLead.mockResolvedValueOnce(null);
    expect(await load({ kind: "lead", id: ASKED })).toEqual({ status: "not-found" });
    for (const fn of otherReads()) expect(fn).not.toHaveBeenCalled();
    m.getLead.mockRejectedValueOnce(new Error("boom"));
    expect(await load({ kind: "lead", id: ASKED })).toEqual({ status: "unavailable" });
    m.resolveLeadId.mockResolvedValueOnce({ status: "unavailable" });
    expect(await load({ kind: "lead", id: ASKED })).toEqual({ status: "unavailable" });
  });

  it("another firm's (or a random) matter id is not-found, with no other read", async () => {
    m.getMatter.mockResolvedValueOnce(null);
    expect(await load({ kind: "matter", id: MATTER })).toEqual({ status: "not-found" });
    for (const fn of otherReads()) expect(fn).not.toHaveBeenCalled();
    m.getMatter.mockRejectedValueOnce(new Error("boom"));
    expect(await load({ kind: "matter", id: MATTER })).toEqual({ status: "unavailable" });
  });

  it("signed out, or a scoped client that can't be made, is unavailable and never throws", async () => {
    m.session.mockResolvedValueOnce({ kind: "signed-out", redirectTo: "/sign-in" });
    expect(await load({ kind: "lead", id: ASKED })).toEqual({ status: "unavailable" });
    m.scoped.mockRejectedValueOnce(new Error("no cookies"));
    expect(await load({ kind: "lead", id: ASKED })).toEqual({ status: "unavailable" });
    m.session.mockRejectedValueOnce(new Error("x"));
    await expect(load({ kind: "matter", id: MATTER })).resolves.toEqual({ status: "unavailable" });
  });

  it("a merged lead follows its keeper: every read is the keeper's", async () => {
    const r = await load({ kind: "lead", id: ASKED });
    expect(m.getLead).toHaveBeenCalledWith(KEEPER);
    expect(m.tagsForLead).toHaveBeenCalledWith(KEEPER);
    expect(m.loadLeadStepFacts).toHaveBeenCalledWith(KEEPER, expect.any(Date));
    expect(m.readRecordDocuments).toHaveBeenCalledWith({ kind: "lead", id: KEEPER });
    // Proposals are read across the merged set, as the lead page does.
    expect(m.listProposals).toHaveBeenCalledWith({ leadIds: [KEEPER, ASKED] });
    if (r.status !== "ok" || r.kind !== "lead") throw new Error("expected a lead");
    expect(r.lead.id).toBe(KEEPER);
    expect(r.role).toBe("attorney");
    expect(r.timeZone).toBe("America/Chicago");
    expect(r.approvals).toEqual({ status: "ok", queueIds: ["q1", "q2"] });
    expect(r.proposal).toEqual({ status: "ok", value: { id: "p1", version: 2, status: "sent", legalCents: 407500, govCents: 70000 } });
    expect(r.tags).toEqual({ status: "ok", value: { on: [{ id: "t1", label: "VIP", color: null }], catalog: [{ id: "t1", label: "VIP", color: null }, { id: "t2", label: "UGW", color: "#fff" }] } });
    expect(r.members).toEqual({ status: "ok", value: [{ userId: "u", name: "Rebecca" }] });
    expect(r.temperature).toMatchObject({ source: "suggested" });
    expect(r.mergeAvailable).toBe(true);
  });

  it("a duplicate is kept only when it is a uuid other than the record", async () => {
    const DUP = "55555555-5555-4555-8555-555555555555";
    const a = await load({ kind: "lead", id: ASKED }, { duplicateOf: DUP });
    const b = await load({ kind: "lead", id: ASKED }, { duplicateOf: "x" });
    const c = await load({ kind: "lead", id: ASKED }, { duplicateOf: KEEPER });
    expect(a.status === "ok" && a.kind === "lead" && a.duplicateOf).toBe(DUP);
    expect(b.status === "ok" && b.kind === "lead" && b.duplicateOf).toBeNull();
    expect(c.status === "ok" && c.kind === "lead" && c.duplicateOf).toBeNull();
  });
});

describe("loadRecordCard: each lead source fails on its own", () => {
  const leadOk = async () => {
    const r = await load({ kind: "lead", id: ASKED });
    if (r.status !== "ok" || r.kind !== "lead") throw new Error(`expected a lead, got ${r.status}`);
    return r;
  };

  it("members", async () => {
    m.listMemberDirectory.mockRejectedValueOnce(new Error("x"));
    expect((await leadOk()).members).toEqual({ status: "unavailable" });
  });
  it("stages: unavailable, and the temperature suggestion with them", async () => {
    m.listStages.mockRejectedValueOnce(new Error("x"));
    const r = await leadOk();
    expect(r.stages).toEqual({ status: "unavailable" });
    expect(r.temperature).toBeNull();
  });
  it("temperature facts: the suggestion is still worked out without them, as the Intake page does", async () => {
    m.loadTemperatureFacts.mockRejectedValueOnce(new Error("x"));
    expect((await leadOk()).temperature).not.toBeNull();
  });
  it("tags (either half)", async () => {
    m.listTags.mockRejectedValueOnce(new Error("x"));
    expect((await leadOk()).tags).toEqual({ status: "unavailable" });
    m.tagsForLead.mockRejectedValueOnce(new Error("x"));
    expect((await leadOk()).tags).toEqual({ status: "unavailable" });
  });
  it("the lead step engine: unavailable, and approvals with it (never 0)", async () => {
    m.loadLeadStepFacts.mockResolvedValueOnce({ status: "unavailable" });
    const r = await leadOk();
    expect(r.leadStep).toEqual({ status: "unavailable" });
    expect(r.approvals).toEqual({ status: "unavailable" });
    m.loadLeadStepFacts.mockRejectedValueOnce(new Error("x"));
    expect((await leadOk()).leadStep).toEqual({ status: "unavailable" });
  });
  it("an unconfigured queue is unconfigured; a failed approvals read is unavailable", async () => {
    m.loadLeadStepFacts.mockResolvedValueOnce({ ...facts, facts: { ...facts.facts, approvals: { status: "not-set-up", why: "queue" } } });
    expect((await leadOk()).approvals).toEqual({ status: "unconfigured" });
    m.loadLeadStepFacts.mockResolvedValueOnce({ ...facts, facts: { ...facts.facts, approvals: { status: "unavailable" } } });
    expect((await leadOk()).approvals).toEqual({ status: "unavailable" });
  });
  it("documents", async () => {
    m.readRecordDocuments.mockRejectedValueOnce(new Error("x"));
    expect((await leadOk()).documents).toEqual({ status: "unavailable" });
  });
  it("proposals: failed read, unreadable features, Proposals off", async () => {
    m.listProposals.mockRejectedValueOnce(new Error("x"));
    expect((await leadOk()).proposal).toEqual({ status: "unavailable" });
    m.modules.mockResolvedValueOnce(null);
    expect((await leadOk()).proposal).toEqual({ status: "unavailable" });
    m.modules.mockRejectedValueOnce(new Error("x"));
    expect((await leadOk()).proposal).toEqual({ status: "unavailable" });
    m.modules.mockResolvedValueOnce([]);
    const off = await leadOk();
    expect(off.proposal).toEqual({ status: "not-set-up" });
    expect(m.listProposals).toHaveBeenCalledTimes(1);
  });
  it("no proposal yet is ok and null", async () => {
    m.listProposals.mockResolvedValueOnce([]);
    expect((await leadOk()).proposal).toEqual({ status: "ok", value: null });
  });
  it("the merge probe failing is 'no merge', and an unreadable zone falls back", async () => {
    m.mergeAvailable.mockRejectedValueOnce(new Error("x"));
    m.loadLeadStepFacts.mockResolvedValueOnce({ status: "unavailable" });
    m.zone.mockRejectedValueOnce(new Error("x"));
    const r = await leadOk();
    expect(r.mergeAvailable).toBe(false);
    expect(r.timeZone).toBe("America/New_York");
  });
});

describe("loadRecordCard: a matter", () => {
  const matterOk = async () => {
    const r = await load({ kind: "matter", id: MATTER });
    if (r.status !== "ok" || r.kind !== "matter") throw new Error(`expected a matter, got ${r.status}`);
    return r;
  };
  it("reads its steps, timeline, next USPTO deadline, stages and documents", async () => {
    const r = await matterOk();
    expect(r.tasks).toEqual({ status: "ok", value: [{ id: "t", title: "Check", dueAt: null, assigneeId: null }] });
    expect(r.activity).toMatchObject({ status: "ok", value: { truncated: false } });
    expect(r.deadline).toEqual({ status: "ok", value: { id: "d1", dueDate: "2026-12-01", title: null, confirmed: false } });
    expect(r.stages).toEqual({ status: "ok", value: [{ id: "m1", label: "Filed" }] });
    expect(m.listMatterDeadlines).toHaveBeenCalledWith(MATTER);
    expect(m.readRecordDocuments).toHaveBeenCalledWith({ kind: "matter", id: MATTER });
  });
  it("each source fails on its own", async () => {
    m.taskRead.mockResolvedValueOnce({ data: null, error: { code: "x" } });
    m.activityRead.mockRejectedValueOnce(new Error("x"));
    m.listMatterDeadlines.mockRejectedValueOnce(new Error("x"));
    m.listMatterStages.mockRejectedValueOnce(new Error("x"));
    m.listMemberDirectory.mockRejectedValueOnce(new Error("x"));
    m.readRecordDocuments.mockRejectedValueOnce(new Error("x"));
    const r = await matterOk();
    for (const k of ["tasks", "activity", "deadline", "stages", "members", "documents"] as const) expect(r[k], k).toEqual({ status: "unavailable" });
  });
});
