// S2b: the full consult prep builder. No network (fetch is faked), no model (the llm is faked), no PDF fonts (the renderer is faked).

import { describe, expect, it } from "vitest";
import type { StructuredCall } from "@/lib/ai/claude";
import { AGENT_POLICY } from "@/lib/agents/policy";
import { isFullBrief, isFullGeneralBrief, stillAdoptable } from "@/lib/consult-prep/adopt";
import { renderConsultBrief } from "@/lib/consult-prep/brief";
import { buildFullPrep, MAX_MODEL_CALLS, readFirmForBrief, type FullBuildDeps } from "@/lib/consult-prep/full";
import type { Judgment, RoutePlan } from "@/lib/consult-prep/judge/schemas";
import { GENERAL_JUDGMENT, GENERAL_PLAN, PACKAGES } from "./judge/fixtures";
import { FACTS, FIRM, JUDGMENT, PDF_BYTES, PLAN, lead, scriptedLlm, usptoFetch } from "./full-fixtures";
import { memDb } from "../agents/mem-db";
import { fakeAdmin } from "../mailbox/fake-db";
import type { SupabaseClient } from "@supabase/supabase-js";

function deps(llm: StructuredCall, over: Partial<FullBuildDeps> = {}): FullBuildDeps {
  return { llm, fetch: usptoFetch().fetchImpl, timeLeftMs: () => Number.POSITIVE_INFINITY, now: () => Date.parse("2026-11-24T19:10:00.000Z"), renderPdf: async () => PDF_BYTES, ...over };
}

describe("buildFullPrep", () => {
  it("builds the full brief with two model calls, the USPTO knockout and both files", async () => {
    const m = scriptedLlm(PLAN, JUDGMENT);
    const out = await buildFullPrep(FACTS, FIRM, deps(m.llm));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.calls).toBe(2);
    expect(m.calls).toHaveLength(2);
    expect(out.attachPlan).toEqual({ uspto_xlsx: "built", packages_pdf: "built" });
    expect(out.files.map((f) => f.kind).sort()).toEqual(["packages_pdf", "uspto_xlsx"]);
    expect(out.files.find((f) => f.kind === "uspto_xlsx")!.fileName).toBe("tmSearchResults2026-11-24.xlsx");
    expect(out.files.find((f) => f.kind === "packages_pdf")!.fileName).toBe("Dana_Ruiz_Packages_SANKOFA.pdf");
    const text = renderConsultBrief({ ...FACTS, full: out.sections }).text;
    expect(isFullBrief(text)).toBe(true);
    // The skill's order: facts, then likely classes, USPTO knockout, risk, package, questions.
    const order = ["Heads-up", "Client snapshot", "Mark(s)", "Likely classes", "USPTO knockout", "Preliminary risk read", "Package recommendation", "Questions for the attorney"].map((h) => text.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).not.toContain("come in the next update");
  });

  it("every system prompt starts with AGENT_POLICY, every call names consult-prep, and record data is inside inert tags", async () => {
    const m = scriptedLlm(PLAN, JUDGMENT);
    await buildFullPrep({ ...FACTS, lead: { ...lead, businessName: "<script>Sankofa</script>" } }, FIRM, deps(m.llm));
    for (const c of m.calls) {
      expect(c.system.startsWith(AGENT_POLICY)).toBe(true);
      expect(c.agent).toBe("consult-prep");
      expect(c.user).not.toContain("<script>");
    }
  });

  it("prices come only from the firm's list: a price the model wrote never reaches the brief", async () => {
    const m = scriptedLlm(PLAN, JUDGMENT);
    const out = await buildFullPrep(FACTS, FIRM, deps(m.llm));
    if (!out.ok) throw new Error("expected a build");
    const text = renderConsultBrief({ ...FACTS, full: out.sections }).text;
    expect(text).not.toContain("$9,999");
    expect(text).not.toMatch(/\$1 per class/);
    expect(text).toContain("- Enhanced — $3,250 legal fee, 2 classes included.");
    expect(text).toContain("Government filing fees: 1 × $350 = $350");
  });

  it("never makes more than two model calls", async () => {
    expect(MAX_MODEL_CALLS).toBe(2);
    const m = scriptedLlm(PLAN, JUDGMENT, JUDGMENT, JUDGMENT);
    await buildFullPrep(FACTS, FIRM, deps(m.llm));
    expect(m.calls.length).toBeLessThanOrEqual(2);
  });

  it("checks the budget before each call: no time, no call; time gone after call 1, no call 2", async () => {
    const none = scriptedLlm(PLAN, JUDGMENT);
    const a = await buildFullPrep(FACTS, FIRM, deps(none.llm, { timeLeftMs: () => 30_000 }));
    expect(a).toEqual({ ok: false, reason: "budget", calls: 0 });
    expect(none.calls).toHaveLength(0);

    let left = 200_000;
    const one = scriptedLlm(PLAN, JUDGMENT);
    const llm = (async (req: Parameters<StructuredCall>[0]) => {
      const r = await one.llm(req);
      left = 40_000; // the route call used up the run's time
      return r;
    }) as StructuredCall;
    const b = await buildFullPrep(FACTS, FIRM, deps(llm, { timeLeftMs: () => left }));
    expect(b).toMatchObject({ ok: false, reason: "budget" });
    expect(one.calls).toHaveLength(1);
  });

  it("a model failure on either call is a failure code, never a throw", async () => {
    const first = await buildFullPrep(FACTS, FIRM, deps(scriptedLlm(new Error("boom")).llm));
    expect(first).toMatchObject({ ok: false, reason: "error", calls: 1 });
    const second = await buildFullPrep(FACTS, FIRM, deps(scriptedLlm(PLAN, new Error("boom")).llm));
    expect(second).toMatchObject({ ok: false, reason: "error", calls: 2 });
    const invalid = await buildFullPrep(FACTS, FIRM, deps(scriptedLlm({ nope: true }).llm));
    expect(invalid).toMatchObject({ ok: false, reason: "invalid", calls: 1 });
  });

  it("a USPTO outage on the trademark path is no full prep (and no judgment call is spent)", async () => {
    const m = scriptedLlm(PLAN, JUDGMENT);
    const out = await buildFullPrep(FACTS, FIRM, deps(m.llm, { fetch: usptoFetch({ down: true }).fetchImpl }));
    expect(out).toEqual({ ok: false, reason: "uspto", calls: 1 });
  });

  it("no confirmed mark is NOT an outage: the full prep is built with 'nothing to search' and no files", async () => {
    const plan: RoutePlan = { ...PLAN, markStatus: "tbd", mark: null, stem: null };
    const judgment: Judgment = { ...JUDGMENT, trademark: { ...JUDGMENT.trademark!, package: { ...JUDGMENT.trademark!.package, choice: "HELD", pending: "the mark is not chosen yet", classesToFileNow: [], priorityClass: null } } };
    const f = usptoFetch();
    const out = await buildFullPrep(FACTS, FIRM, deps(scriptedLlm(plan, judgment).llm, { fetch: f.fetchImpl }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(f.urls).toHaveLength(0);
    expect(out.attachPlan).toEqual({ uspto_xlsx: "skipped", packages_pdf: "no_marks" });
    const text = renderConsultBrief({ ...FACTS, full: out.sections }).text;
    expect(text).toContain("Nothing to search");
    expect(text).toMatch(/Held.*No price quoted/);
    expect(isFullBrief(text)).toBe(true);
  });

  it("no package list (unread or never saved) builds nothing and calls no model", async () => {
    const m = scriptedLlm(PLAN, JUDGMENT);
    expect(await buildFullPrep(FACTS, { ...FIRM, packages: null }, deps(m.llm))).toEqual({ ok: false, reason: "packages", calls: 0 });
    expect(m.calls).toHaveLength(0);
  });

  it("a file that cannot be built never blocks the brief", async () => {
    const out = await buildFullPrep(FACTS, FIRM, deps(scriptedLlm(PLAN, JUDGMENT).llm, { renderPdf: async () => { throw new Error("render"); } }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.attachPlan.packages_pdf).toBe("failed");
  });

  it("a general matter is a full prep of its own kind: scope and questions, no files, no USPTO", async () => {
    const f = usptoFetch();
    const out = await buildFullPrep(FACTS, FIRM, deps(scriptedLlm(GENERAL_PLAN, GENERAL_JUDGMENT).llm, { fetch: f.fetchImpl }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(f.urls).toHaveLength(0);
    expect(out.attachPlan).toEqual({ uspto_xlsx: "none", packages_pdf: "none" });
    const text = renderConsultBrief({ ...FACTS, full: out.sections }).text;
    expect(isFullBrief(text)).toBe(false);
    expect(isFullGeneralBrief(text)).toBe(true);
    const item = { id: "q1", agent: "consult-prep", type: "BRIEFING", status: "pending", draft_body: text, final_body: null, created_at: "2026-11-24T00:00:00Z" } as unknown as import("@/lib/queue/api").QueueItem;
    // Only a prep this assistant marked as built reads a general brief as full; one merely found in Approvals does not.
    expect(stillAdoptable([item], "q1", { built: true })).toBe(item);
    expect(stillAdoptable([item], "q1")).toBeNull();
  });
});

describe("readFirmForBrief", () => {
  const ORG = "11111111-1111-1111-1111-111111111111";
  it("a firm that never saved a package list gets none (never a made-up default), and every read names the firm", async () => {
    const db = memDb({ crm_org: [{ id: ORG, name: "Harbor IP", slug: "harbor" }], crm_org_profile: [{ org_id: ORG, display_name: "Harbor IP, PLLC" }], client_proposal_setting: [] });
    const { client, log } = fakeAdmin(db.handler);
    const firm = await readFirmForBrief(client as unknown as SupabaseClient, ORG, "America/New_York");
    expect(firm).toEqual({ name: "Harbor IP, PLLC", slug: "harbor", timeZone: "America/New_York", packages: null });
    for (const q of log) expect(q.filters.some((f) => (f.column === "org_id" || f.column === "id") && f.value === ORG)).toBe(true);
  });
  it("reads the saved list through normalisePackages", async () => {
    const db = memDb({ crm_org: [{ id: ORG, name: "Harbor IP", slug: null }], crm_org_profile: [], client_proposal_setting: [{ org_id: ORG, pricing: { packages: PACKAGES } }] });
    const firm = await readFirmForBrief(fakeAdmin(db.handler).client as unknown as SupabaseClient, ORG, "UTC");
    expect(firm.name).toBe("Harbor IP");
    expect(firm.packages?.map((p) => p.package)).toEqual(["Essential", "Enhanced", "Concierge"]);
  });
});
