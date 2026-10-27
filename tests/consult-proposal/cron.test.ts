import { describe, it, expect, vi } from "vitest";
import { PROPOSAL_MEETING_BATCH, PROPOSAL_SCAN_LIMIT, PROPOSAL_TIME_BUDGET_MS, runPostConsult } from "@/lib/agents/post-consult";
import { ORG, agentCtx, assertOrgFenced, fakeLlm, writes } from "../agents/helpers";
import { filterValue, type Recorded } from "../mailbox/fake-db";

/**
 * The post-consult agent's second job: a recorded call (crm_meeting) linked to a
 * lead becomes a DRAFT proposal + one approval-queue email. The consult-note
 * path is covered by tests/agents/post-consult.test.ts and is untouched.
 */

const TURNS = [
  { speaker: "Rebecca", text: "Thanks for joining, Sevetri. Based on what you've told me I'd file the word mark for Prosperall and the logo too." },
  { speaker: "Sevetri", text: "Great, that sounds right to me." },
  { speaker: "Rebecca", text: "For Prosperall the right category is cloud based software as a service, so I'd cover that class." },
];
const EXTRACT = {
  is_trademark_matter: true,
  recommendation_found: true,
  brands: [
    {
      name: "Prosperall",
      what: "Your company name",
      note_from_attorney: null,
      marks: [
        { kind: "word", preselected: true, why_quote: "I'd file the word mark for Prosperall and the logo too" },
        { kind: "logo", preselected: true, why_quote: "I'd file the word mark for Prosperall and the logo too" },
      ],
      classes: [{ label: "Cloud-Based Software as a Service (SaaS)", preselected: true, why_quote: "the right category is cloud based software as a service" }],
    },
  ],
  recommended_package: "Concierge",
  second_mark_discount: null,
  reduced_package: null,
  price_changes: [],
  credits: [],
  recommendation_summary: "Word and logo for Prosperall.",
  reasoning_parts: { principle: true, risk_brand: null, risk_quote: null, fallback_brand: null, fallback_quote: null },
};

function meetings(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `m-${i + 1}`,
    title: `Strategy call ${i + 1}`,
    started_at: `2026-09-2${i % 5}T15:00:00Z`,
    lead_id: `lead-${i + 1}`,
    matter_id: null,
    summary: null as string | null,
    transcript_first: TURNS[0] as unknown,
  }));
}

function handler(o: { modules?: string[]; meetings?: ReturnType<typeof meetings>; handled?: string[]; setting?: unknown } = {}) {
  const list = o.meetings ?? meetings(1);
  const handled = o.handled ?? [];
  return (q: Recorded) => {
    if (q.table === "crm_consult_note") return { data: [], error: null };
    if (q.table === "crm_org") return { data: { modules: o.modules ?? ["agents", "proposals"], name: "RPB Law", slug: "rpb-law" }, error: null };
    if (q.table === "client_proposal_setting") {
      const s = o.setting === undefined ? { approver_user_ids: ["rebecca"], default_pay_url: "https://pay.example.com/f", pricing: {} } : o.setting;
      return { data: s, error: null };
    }
    if (q.table === "crm_org_profile") return { data: { time_zone: "America/New_York", email_signature: null }, error: null };
    if (q.table === "crm_meeting") {
      if (q.columns?.includes("transcript_first")) return { data: list, error: null };
      return { data: { transcript: TURNS }, error: null };
    }
    if (q.table === "crm_lead") {
      const id = String(filterValue(q, "id"));
      return { data: { id, first_name: "Sevetri", last_name: "Wilson", business_name: "Prosperall", email: `${id}@example.com` }, error: null };
    }
    if (q.table === "crm_activity" && q.action === "select") {
      const one = filterValue(q, "payload->>meeting_id");
      if (typeof one === "string") return { data: handled.includes(one) ? [{ id: "a" }] : [], error: null };
      return { data: handled.map((id) => ({ payload: { meeting_id: id } })), error: null };
    }
    if (q.table === "client_proposal" && q.action === "insert") return { data: { ...(q.values as object), public_token: "T".repeat(43) }, error: null };
    return undefined;
  };
}

function setup(o: Parameters<typeof handler>[0] = {}, ctxOpts: { autonomy?: "suggest" | "draft" | "act"; queue?: boolean; origin?: string | null } = {}) {
  const { llm, calls } = fakeLlm(EXTRACT);
  const t = agentCtx(handler(o), { autonomy: ctxOpts.autonomy ?? "draft", queue: ctxOpts.queue ?? true, llm });
  const origin = ctxOpts.origin === undefined ? "https://app.example.com" : ctxOpts.origin;
  t.ctx.siteOrigin = async () => origin;
  return { ...t, calls };
}

describe("post-consult: recorded calls become proposals", () => {
  it("scans a linked recorded call and drafts the proposal + email, counting it", async () => {
    const t = setup();
    const r = await runPostConsult(t.ctx);
    expect(r).toMatchObject({ itemsIn: 1, draftsOut: 1 });
    expect(r.summary).toContain("1 proposal(s) with email drafted");
    expect(t.createDraft).toHaveBeenCalledTimes(1);
    expect(t.createDraft).toHaveBeenCalledWith(expect.objectContaining({ type: "CLIENT_EMAIL", agent: "post-consult", recipient: "lead-1@example.com" }));
    expect(writes(t.log, "client_proposal", "insert")[0].values).toMatchObject({ org_id: ORG, status: "draft", source: "agent", created_by: null, lead_id: "lead-1" });
    expect(writes(t.log, "client_proposal_event", "insert")[0].values).toMatchObject({ org_id: ORG, actor: "agent", actor_user_id: null });
    expect(writes(t.log, "crm_activity", "insert")[0].values).toMatchObject({
      type: "queue_drafted",
      actor_type: "ai",
      payload: expect.objectContaining({ source: "consult-proposal", meeting_id: "m-1", queue_id: "q-1" }),
    });
  });

  it("only reads this firm's linked, recent meetings", async () => {
    const t = setup();
    await runPostConsult(t.ctx);
    const read = t.log.find((q) => q.table === "crm_meeting" && q.columns?.includes("transcript_first"))!;
    expect(filterValue(read, "org_id")).toBe(ORG);
    expect(read.filters.some((f) => f.op === "not" && f.column === "lead_id")).toBe(true);
    expect(read.filters.some((f) => f.op === "gte" && f.column === "started_at")).toBe(true);
  });

  it("looks at the newest calls first, over a window wider than one batch", async () => {
    const t = setup();
    await runPostConsult(t.ctx);
    const read = t.log.find((q) => q.table === "crm_meeting" && q.columns?.includes("transcript_first"))!;
    expect(read.order).toEqual({ column: "started_at", ascending: false });
    expect(read.limit).toBe(PROPOSAL_SCAN_LIMIT);
    expect(PROPOSAL_SCAN_LIMIT).toBeGreaterThan(PROPOSAL_MEETING_BATCH * 4);
  });

  it("starts no new proposal once the run's time budget is spent; the rest wait for the next run", async () => {
    const t = setup({ meetings: meetings(5) });
    let clock = 1_000_000;
    t.ctx.now = () => clock;
    const inner = t.ctx.llm;
    // each model call takes 70 seconds
    t.ctx.llm = (async (req: Parameters<typeof inner>[0]) => {
      clock += 70_000;
      return inner(req);
    }) as typeof inner;
    const r = await runPostConsult(t.ctx);
    // starts at 0s and 70s; at 140s the budget is spent
    expect(PROPOSAL_TIME_BUDGET_MS).toBe(120_000);
    expect(r).toMatchObject({ itemsIn: 2, draftsOut: 2 });
    expect(r.summary).toContain("3 left for the next run (time limit)");
    expect(t.createDraft).toHaveBeenCalledTimes(2);
  });

  it("every statement it makes is fenced to the firm", async () => {
    const t = setup({ meetings: meetings(3) });
    await runPostConsult(t.ctx);
    expect(t.log.length).toBeGreaterThan(10);
    assertOrgFenced(t.log);
  });

  it("is limited to a batch per run", async () => {
    const t = setup({ meetings: meetings(9) });
    const r = await runPostConsult(t.ctx);
    expect(PROPOSAL_MEETING_BATCH).toBe(5);
    expect(r).toMatchObject({ itemsIn: 5, draftsOut: 5 });
    expect(t.createDraft).toHaveBeenCalledTimes(5);
    expect(t.calls).toHaveLength(5);
  });

  it("skips calls that already have a marker", async () => {
    const t = setup({ meetings: meetings(2), handled: ["m-1"] });
    const r = await runPostConsult(t.ctx);
    expect(r).toMatchObject({ itemsIn: 1, draftsOut: 1 });
    expect(writes(t.log, "crm_activity", "insert")[0].values).toMatchObject({ payload: expect.objectContaining({ meeting_id: "m-2" }) });
  });

  it("skips a call with neither a summary nor a transcript", async () => {
    const t = setup({ meetings: meetings(1).map((m) => ({ ...m, transcript_first: null, summary: "  " })) });
    expect(await runPostConsult(t.ctx)).toMatchObject({ itemsIn: 0, draftsOut: 0 });
    expect(t.calls).toHaveLength(0);
  });

  it("does nothing for a firm without the proposals module (and never reads its meetings)", async () => {
    const t = setup({ modules: ["agents"] });
    const r = await runPostConsult(t.ctx);
    expect(r.draftsOut).toBe(0);
    expect(t.log.some((q) => q.table === "crm_meeting")).toBe(false);
    assertOrgFenced(t.log);
  });

  it("does nothing without proposal settings or approvers", async () => {
    for (const setting of [null, { approver_user_ids: [] }]) {
      const t = setup({ setting });
      expect((await runPostConsult(t.ctx)).draftsOut).toBe(0);
      expect(t.createDraft).not.toHaveBeenCalled();
      expect(t.log.some((q) => q.table === "crm_meeting")).toBe(false);
    }
  });

  it("at suggest it drafts no proposals, and with no queue nothing at all", async () => {
    const suggest = setup({}, { autonomy: "suggest" });
    await runPostConsult(suggest.ctx);
    expect(suggest.log.some((q) => q.table === "crm_meeting")).toBe(false);

    const noQueue = setup({}, { queue: false });
    const r = await runPostConsult(noQueue.ctx);
    expect(r.skipped).toBe(true);
    expect(noQueue.log).toHaveLength(0);
  });

  it("without a known site address it drafts no proposals, because a client link must not guess its host", async () => {
    const t = setup({}, { origin: null });
    const r = await runPostConsult(t.ctx);
    expect(r.draftsOut).toBe(0);
    expect(r.summary).toMatch(/no site address/i);
    expect(t.createDraft).not.toHaveBeenCalled();
  });

  it("a failing meeting read is reported in the summary and does not undo the notes path", async () => {
    const base = handler();
    const t = agentCtx(
      (q) => (q.table === "crm_meeting" ? { data: null, error: { message: "db down" } } : base(q)),
      { autonomy: "draft", queue: true, llm: fakeLlm(EXTRACT).llm },
    );
    t.ctx.siteOrigin = async () => "https://app.example.com";
    const r = await runPostConsult(t.ctx);
    expect(r.summary).toMatch(/failed: meeting read failed/);
    expect(vi.isMockFunction(t.createDraft)).toBe(true);
  });
});
