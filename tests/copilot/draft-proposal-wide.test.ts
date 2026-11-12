import { describe, expect, it, vi } from "vitest";
import { buildDraft, confirmationContext, draftRef, parseDraftRequest, type DraftRequest } from "@/lib/copilot/draft-proposal";
import { newDraftSink, runDraftProposal, type DraftProposalDeps } from "@/lib/agents/copilot-draft-proposal";
import { faithe } from "../proposals/general-fixture";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { validateContent } from "@/lib/proposals/validate";
import type { Lead } from "@/lib/pipeline";

/** Sprint 5: Copilot's widened draft_proposal request (F5 to F8, I3). No model, no database. */

const PKG = (name: string, base: number, included: number) => ({ package: name, base_cents: base, included_classes: included, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 });
const PRICING = { packages: [PKG("Concierge", 495_000, 3), PKG("Enhanced", 295_000, 2), PKG("Essential", 195_000, 1)], includes: [{ label: "Search", included: "✓" }] };
const LEAD = { id: "11111111-1111-4111-8111-111111111111", first_name: "Jane", last_name: "Doe", business_name: "Doe Studio", email: "jane@example.com", mark_text: null };
const ORG = "org-1";
let n = 0;
const rand = () => (n++).toString(16).padStart(8, "0");

const BRAND = { name: "DOEWARE", marks: ["word", "logo"], classes: ["Scheduling software"] };
const BASE_INPUT = { lead: "Jane Doe", brands: [{ ...BRAND, choice: { options: ["Essential", "Enhanced", "Concierge"], start: "Enhanced" }, discountPercent: 10 }], payLink: "https://pay.example.com/x" };

function parse(input: Record<string, unknown>): DraftRequest {
  const p = parseDraftRequest(input);
  if (!p.ok) throw new Error(p.ask);
  return p.value;
}
function build(input: Record<string, unknown>, pricing: unknown = PRICING) {
  const r = parse(input);
  const b = buildDraft(r, LEAD, pricing, rand);
  if (!b.ok) throw new Error(JSON.stringify(b));
  return { r, draft: b.draft, ref: draftRef(ORG, b.draft, r) };
}

describe("F5/F6: the draft and the ref cover the widened request", () => {
  it("a per-brand choice and a brand discount: content, summary and checks", () => {
    const { draft } = build(BASE_INPUT);
    const nm = draft.content.names[0];
    expect(nm.package_choice).toEqual({ options: ["Essential", "Enhanced", "Concierge"], default: "Enhanced" });
    expect(nm.discount_pct).toBe(10);
    expect(draft.content.made_by).toBe("copilot");
    expect(validateContent(draft.content).filter((i) => i.level === "error")).toEqual([]);
    expect(draft.summary).toContain("the client chooses among Essential, Enhanced, Concierge, starting on Enhanced");
    expect(draft.summary).toContain("10% discount on this brand name");
    const paths = (draft.content.checks ?? []).map((c) => c.path);
    expect(paths).toContain("names[0].discount_pct");
    expect(paths).not.toContain("pay_url");
    expect(draft.content.checks!.every((c) => c.source === "copilot")).toBe(true);
    expect(quoteProposal(draft.content, defaultSelection(draft.content)).names[0].package).toBe("Enhanced");
  });

  it("no pay link yet is a check linked to the pay-link field; a spoken name resolves to the firm's spelling", () => {
    const { draft } = build({ ...BASE_INPUT, payLink: undefined, brands: [{ ...BRAND, package: "essential" }], package: undefined });
    expect(draft.content.checks!.map((c) => c.path)).toContain("pay_url");
    expect(draft.resolved).toEqual([{ mode: "one", package: "Essential" }]);
  });

  it("per mark: a choice on the word mark only", () => {
    const { draft } = build({ lead: "Jane", package: "Concierge", brands: [{ ...BRAND, perMark: { word: { options: ["Essential", "Enhanced"], start: "Essential" } } }] });
    const nm = draft.content.names[0];
    expect(nm.package_choice).toBeUndefined();
    expect(nm.marks.find((m) => m.kind === "word")?.package_choice).toEqual({ options: ["Essential", "Enhanced"], default: "Essential" });
    expect(nm.marks.find((m) => m.kind === "logo")?.package_choice).toBeUndefined();
    expect(validateContent(draft.content).filter((i) => i.level === "error")).toEqual([]);
  });

  const variants: Array<[string, Record<string, unknown>]> = [
    ["a brand's package", { brands: [{ ...BRAND, package: "Essential" }], package: "Concierge" }],
    ["a brand's package (other)", { brands: [{ ...BRAND, package: "Enhanced" }], package: "Concierge" }],
    ["choice options", { brands: [{ ...BASE_INPUT.brands[0], choice: { options: ["Essential", "Enhanced"], start: "Enhanced" } }] }],
    ["starting package", { brands: [{ ...BASE_INPUT.brands[0], choice: { options: ["Essential", "Enhanced", "Concierge"], start: "Essential" } }] }],
    ["per-mark choice", { brands: [{ ...BRAND, perMark: { word: { options: ["Essential", "Enhanced"] } } }] }],
    ["per-mark start", { brands: [{ ...BRAND, perMark: { word: { options: ["Essential", "Enhanced"], start: "Enhanced" } } }] }],
    ["brand discount", { brands: [{ ...BASE_INPUT.brands[0], discountPercent: 15 }] }],
    ["credit kind", { discount: { label: "Credit", kind: "percent", value: 10 } }],
    ["credit value", { discount: { label: "Credit", kind: "amount", value: 150 } }],
    ["credit label", { discount: { label: "Welcome credit", kind: "amount", value: 100 } }],
    ["pay link", { payLink: "https://pay.example.com/y" }],
    ["top-level package", { package: "Essential" }],
  ];
  it("an identical request gives an identical ref; the spoken spelling of a package does not matter", () => {
    expect(build(BASE_INPUT).ref).toBe(build(BASE_INPUT).ref);
    const a = build({ ...BASE_INPUT, brands: [{ ...BASE_INPUT.brands[0], choice: { options: ["essential", "ENHANCED", "concierge"], start: "enhanced" } }] }).ref;
    expect(a).toBe(build(BASE_INPUT).ref);
  });
  it.each(variants)("F6: changing %s changes the ref", (_what, change) => {
    const base = build({ ...BASE_INPUT, discount: { label: "Credit", kind: "amount", value: 100 } }).ref;
    const changed = build({ ...BASE_INPUT, discount: { label: "Credit", kind: "amount", value: 100 }, ...change }).ref;
    expect(changed).not.toBe(base);
  });
});

describe("F7: a flat-fee request", () => {
  const MATTER = {
    title: "Management agreement: notice of non-renewal and termination",
    summary: "We will review both management agreements and all correspondence and evidence, then draft your notice of non-renewal and termination.",
    items: [
      { label: "Review both management agreements", hours: 1, hourlyRate: 500 },
      { label: "Review all correspondence and evidence", hours: 0.5, hourlyRate: 500 },
      { label: "Draft the notice of non-renewal and termination", hours: 1, hourlyRate: 500 },
    ],
    fee: 500,
    excludes: ["Litigation or arbitration"],
  };

  it("builds a general draft shaped like the Faithe fixture and quotes the fee", () => {
    const { draft } = build({ lead: "Faithe Williams", matter: MATTER });
    const c = draft.content;
    const f = faithe();
    expect(c.kind).toBe("general");
    expect(c.made_by).toBe("copilot");
    expect(c.names).toEqual([]);
    expect(c.pricing).toEqual(f.pricing);
    expect(c.general!.matter_title).toBe(f.general!.matter_title);
    expect(c.general!.fee_cents).toBe(f.general!.fee_cents);
    expect(c.general!.items.map(({ id: _id, ...rest }) => rest)).toEqual(f.general!.items.map(({ id: _id, ...rest }) => rest));
    expect(c.general!.excludes).toEqual(f.general!.excludes);
    expect(quoteProposal(c, defaultSelection(c)).legal_total_cents).toBe(50_000);
    expect(validateContent(c).filter((i) => i.level === "error")).toEqual([]);
    expect(draft.content.checks!.map((x) => x.path)).toContain("general.fee_cents");
  });

  it("I3: the summary lists matter, work with hours and fee, and has no USPTO or class wording", () => {
    const { draft } = build({ lead: "Faithe Williams", matter: MATTER });
    expect(draft.summary).toContain("- Matter: Management agreement");
    expect(draft.summary).toContain("- Work: Review both management agreements (1 hr at $500/hr)");
    expect(draft.summary).toContain("- Flat fee: $500");
    expect(draft.summary).not.toMatch(/USPTO|class|package/i);
  });

  it("a matter with brands, a package, or a missing fee or work asks instead", () => {
    expect(parseDraftRequest({ lead: "J", matter: MATTER, brands: [BRAND] })).toMatchObject({ ok: false });
    expect(parseDraftRequest({ lead: "J", matter: MATTER, package: "Concierge" })).toMatchObject({ ok: false });
    expect(parseDraftRequest({ lead: "J", matter: { ...MATTER, fee: undefined } })).toMatchObject({ ok: false, ask: expect.stringMatching(/flat fee/i) });
    expect(parseDraftRequest({ lead: "J", matter: { ...MATTER, items: [] } })).toMatchObject({ ok: false, ask: expect.stringMatching(/work/i) });
    expect(parseDraftRequest({ lead: "J", matter: { ...MATTER, title: "" } })).toMatchObject({ ok: false });
  });

  it("F6: the title, an item's label, hours, rate and the fee each change the ref", () => {
    const base = build({ lead: "Faithe", matter: MATTER }).ref;
    const items = (i: number, over: Record<string, unknown>) => MATTER.items.map((it, k) => (k === i ? { ...it, ...over } : it));
    for (const m of [
      { ...MATTER, title: "Another matter" },
      { ...MATTER, items: items(0, { label: "Something else" }) },
      { ...MATTER, items: items(0, { hours: 2 }) },
      { ...MATTER, items: items(0, { hourlyRate: 400 }) },
      { ...MATTER, fee: 600 },
    ]) {
      expect(build({ lead: "Faithe", matter: m }).ref).not.toBe(base);
    }
  });
});

describe("F8: a package that is not on the list returns the list and creates nothing", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["top level", { lead: "J", package: "Platinum", brands: [BRAND] }],
    ["per brand", { lead: "J", brands: [{ ...BRAND, package: "Platinum" }] }],
    ["in a choice", { lead: "J", brands: [{ ...BRAND, choice: { options: ["Essential", "Platinum"] } }] }],
    ["a choice's start", { lead: "J", brands: [{ ...BRAND, choice: { options: ["Essential", "Enhanced"], start: "Enhanced" } }], package: "Platinum" }],
    ["per mark", { lead: "J", brands: [{ ...BRAND, perMark: { logo: { options: ["Platinum"] } } }] }],
  ];
  it.each(cases)("%s", (_w, input) => {
    const b = buildDraft(parse(input), LEAD, PRICING, rand);
    expect(b).toEqual({ ok: false, kind: "package_not_found", packages: ["Concierge", "Enhanced", "Essential"] });
  });

  it("two ways of offering packages for one brand is a question back", () => {
    expect(parseDraftRequest({ lead: "J", brands: [{ ...BRAND, package: "Essential", choice: { options: ["Essential"] } }] })).toMatchObject({ ok: false, ask: expect.stringMatching(/one package, a choice/) });
  });

  it("without a top-level package and no firm offer, a brand with no offer of its own asks for the package", () => {
    expect(buildDraft(parse({ lead: "J", brands: [BRAND] }), LEAD, PRICING, rand)).toMatchObject({ ok: false, kind: "needs_package" });
    expect(buildDraft(parse({ lead: "J", brands: [{ ...BRAND, package: "Essential" }] }), LEAD, PRICING, rand)).toMatchObject({ ok: true });
    const withOffer = { ...PRICING, new_offer: { mode: "one", per: "brand", options: ["Enhanced"], start: "Enhanced" } };
    const b = buildDraft(parse({ lead: "J", brands: [BRAND] }), LEAD, withOffer, rand);
    expect(b.ok && b.draft.content.pricing.package).toBe("Enhanced");
  });
});

/* ── the confirmation through the executor: shown, yes, "yes but", a ref from another request ── */
const lead = (): Lead => ({ id: LEAD.id, org_id: ORG, first_name: "Jane", last_name: "Doe", business_name: "Doe Studio", email: "jane@example.com", mark_text: null }) as unknown as Lead;
function deps() {
  const create = vi.fn(async () => ({ id: "33333333-3333-4333-8333-333333333333" }));
  const d: DraftProposalDeps = { mayDraft: async () => true, getLead: async () => lead(), searchLeads: async () => [lead()], readPricing: async () => PRICING, readLetter: async () => ({ status: "ok", letter: null }), create };
  return { d, create };
}
async function call(input: unknown, question: string, history: Array<{ role: "user" | "assistant"; content: string }>, d: DraftProposalDeps) {
  const sink = newDraftSink();
  const out = await runDraftProposal(input, { confirm: confirmationContext(ORG, question, history), sink, deps: async () => d, leadSearchTerm: (q) => q, citeLead: () => {}, citeProposal: () => {} });
  return { out, sink };
}

describe("F5: the confirmation flow for the widened request", () => {
  const ASK = "Draft a proposal for Jane Doe";
  it("creates nothing on the preview, then exactly one draft after a plain yes to that exact request", async () => {
    const { d, create } = deps();
    const shown = await call(BASE_INPUT, ASK, [], d);
    expect(shown.out.status).toBe("ready_to_confirm");
    expect(create).not.toHaveBeenCalled();
    const ref = shown.sink.pending!.ref;
    const history = [{ role: "user" as const, content: ASK }, { role: "assistant" as const, content: `Ready.\n\nCreate this draft? (draft ref ${ref})` }];

    const done = await call({ ...BASE_INPUT, confirmed: true }, "yes", history, d);
    expect(done.out.status).toBe("created");
    expect(create).toHaveBeenCalledTimes(1);
    const made = (create.mock.calls[0] as unknown as [{ content: { names: Array<{ package_choice: unknown; discount_pct: number }>; made_by: string } }])[0].content;
    expect(made.made_by).toBe("copilot");
    expect(made.names[0].package_choice).toEqual({ options: ["Essential", "Enhanced", "Concierge"], default: "Enhanced" });
    expect(made.names[0].discount_pct).toBe(10);
    expect(validateContent(made as never).filter((i) => i.level === "error")).toEqual([]);
  });

  it("'yes, but change the package' and a ref from a different request both show the summary again", async () => {
    const { d, create } = deps();
    const shown = await call(BASE_INPUT, ASK, [], d);
    const ref = shown.sink.pending!.ref;
    const history = [{ role: "user" as const, content: ASK }, { role: "assistant" as const, content: `Create this draft? (draft ref ${ref})` }];
    const but = await call({ ...BASE_INPUT, confirmed: true }, "yes, but change the package", history, d);
    expect(but.out.status).toBe("ready_to_confirm");

    const other = { ...BASE_INPUT, brands: [{ ...BASE_INPUT.brands[0], discountPercent: 20 }], confirmed: true };
    const wrong = await call(other, "yes", history, d);
    expect(wrong.out.status).toBe("ready_to_confirm");
    expect(create).not.toHaveBeenCalled();
  });
});
