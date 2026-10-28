import { describe, expect, it } from "vitest";
import {
  askedForProposal,
  buildDraft,
  confirmationContext,
  confirmsDraft,
  draftRef,
  isConfirmation,
  parseDraftRequest,
  withConfirmation,
  type DraftRequest,
} from "@/lib/copilot/draft-proposal";

/** The pure rules of Copilot's draft_proposal tool: parsing, the draft, and the confirmation rule. */

const PRICING = {
  packages: [
    { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
    { package: "Essentials", base_cents: 150_000, included_classes: 1, per_class_cents: 50_000, second_mark_discount_pct: 0, gov_per_class_cents: 35_000 },
  ],
  includes: [{ label: "Search", included: "✓" }],
};

const LEAD = { id: "11111111-1111-4111-8111-111111111111", first_name: "Jane", last_name: "Doe", business_name: "Doe Studio", email: "jane@example.com", mark_text: null };

let n = 0;
const rand = () => (n++).toString(16).padStart(8, "0");

function req(overrides: Record<string, unknown> = {}): DraftRequest {
  const parsed = parseDraftRequest({
    lead: "Jane Doe",
    package: "concierge",
    brands: [{ name: "DOEWARE", marks: ["word", "logo"], classes: ["Software for scheduling", "Clothing"] }],
    ...overrides,
  });
  if (!parsed.ok) throw new Error(parsed.ask);
  return parsed.value;
}

describe("parseDraftRequest asks instead of guessing", () => {
  it.each([
    [{}, /Which lead/],
    [{ lead: "Jane" }, /Which of the firm's packages/],
    [{ lead: "Jane", package: "Concierge" }, /Which brand names/],
    [{ lead: "Jane", package: "Concierge", brands: [{ name: "X", classes: ["Shoes"] }] }, /word mark, a logo mark, or both/],
    [{ lead: "Jane", package: "Concierge", brands: [{ name: "X", marks: ["word"] }] }, /What is X used for/],
    [{ lead: "Jane", package: "Concierge", brands: [{ name: "X", marks: ["word"], classes: ["a", "b", "c", "d"] }] }, /more than 3 classes/],
    [{ lead: "Jane", package: "Concierge", brands: [{ name: "X", marks: ["sound"], classes: ["a"] }] }, /word mark, a logo mark/],
    [{ lead: "Jane", package: "C", brands: [{ name: "X", marks: ["word"], classes: ["a"] }], discount: { kind: "bogus", value: 1 } }, /dollar amount or a percent/],
    [{ lead: "Jane", package: "C", brands: [{ name: "X", marks: ["word"], classes: ["a"] }], payLink: "http://pay.example.com" }, /https/],
  ])("%j", (input, ask) => {
    const parsed = parseDraftRequest(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.ask).toMatch(ask);
  });

  it("keeps confirmed only when it is literally true, and turns a dollar discount into cents", () => {
    const r = req({ discount: { label: "Consult credit", kind: "amount", value: 250 }, confirmed: "true" });
    expect(r.confirmed).toBe(false);
    expect(r.discount).toEqual({ label: "Consult credit", kind: "amount", value: 25_000 });
    expect(req({ confirmed: true }).confirmed).toBe(true);
  });
});

describe("buildDraft uses the New proposal helpers and the firm's own list", () => {
  it("never guesses a package that isn't on the list, and names the list", () => {
    const built = buildDraft(req({ package: "Platinum" }), LEAD, PRICING, rand);
    expect(built).toEqual({ ok: false, kind: "package_not_found", packages: ["Concierge", "Essentials"] });
  });

  it("takes the price from the chosen package only, the client from the lead, and builds every brand name and mark", () => {
    const built = buildDraft(req({ package: "essentials", payLink: "https://pay.example.com/x" }), LEAD, PRICING, rand);
    if (!built.ok) throw new Error("expected a draft");
    const { draft } = built;
    expect(draft.packageName).toBe("Essentials");
    expect(draft.content.pricing).toEqual(PRICING.packages[1]);
    expect(draft.content.client).toEqual({ first_name: "Jane", full_name: "Jane Doe", company: "Doe Studio" });
    expect(draft.clientEmail).toBe("jane@example.com");
    expect(draft.content.names).toHaveLength(1);
    expect(draft.content.names[0].name).toBe("DOEWARE");
    expect(draft.content.names[0].marks.map((m) => m.kind)).toEqual(["word", "logo"]);
    expect(draft.content.names[0].classes.map((c) => c.label)).toEqual(["Software for scheduling", "Clothing"]);
    expect(draft.content.includes).toEqual(PRICING.includes);
    expect(draft.content.adjustments).toEqual([]);
    expect(draft.blocking).toEqual([]);
    expect(draft.summary).toContain("- Package: Essentials ($1,500 · 1 class)");
    expect(draft.summary).toContain("- DOEWARE: word and logo marks; classes: Software for scheduling; Clothing");
    expect(draft.summary).toContain("- Pay link: https://pay.example.com/x");
  });

  it("adds the user's discount as an adjustment", () => {
    const built = buildDraft(req({ discount: { label: "Consult credit", kind: "percent", value: 10 } }), LEAD, PRICING, rand);
    if (!built.ok) throw new Error("expected a draft");
    expect(built.draft.content.adjustments).toEqual([expect.objectContaining({ label: "Consult credit", kind: "percent", value: 10 })]);
    expect(built.draft.summary).toContain("- Discount: Consult credit, 10% off");
  });

  it("blocks a class number in a class label (validateContent's rule), so the user is asked to reword it", () => {
    const built = buildDraft(req({ brands: [{ name: "DOEWARE", marks: ["word"], classes: ["Class 25 clothing"] }] }), LEAD, PRICING, rand);
    if (!built.ok) throw new Error("expected a draft");
    expect(built.draft.blocking.length).toBeGreaterThan(0);
  });

  it("reports what a draft may carry (no first name on a business-only lead) without blocking", () => {
    const built = buildDraft(req(), { ...LEAD, first_name: null, last_name: null }, PRICING, rand);
    if (!built.ok) throw new Error("expected a draft");
    expect(built.draft.blocking).toEqual([]);
    expect(built.draft.issues.join(" ")).toMatch(/first name/);
  });
});

describe("the confirmation rule", () => {
  it("accepts a plain yes and nothing else", () => {
    for (const yes of ["yes", "Yes.", "yes please", "Yes, create it.", "ok go ahead", "Confirm", "create this draft", "Sure, thanks!"]) expect(isConfirmation(yes), yes).toBe(true);
    for (const no of ["", "no", "yes but use Essentials", "yes, change the package", "don't", "what?", "create a proposal for Jane", "ok wait", "yes ".repeat(20)]) {
      expect(isConfirmation(no), no).toBe(false);
    }
  });

  it("the ref changes with any detail of the draft and with the firm", () => {
    const r = req();
    const built = buildDraft(r, LEAD, PRICING, rand);
    if (!built.ok) throw new Error("expected a draft");
    const ref = draftRef("org-1", built.draft, r);
    expect(draftRef("org-1", built.draft, r)).toBe(ref);
    expect(draftRef("org-2", built.draft, r)).not.toBe(ref);
    expect(draftRef("org-1", { ...built.draft, packageName: "Essentials" }, r)).not.toBe(ref);
    expect(draftRef("org-1", { ...built.draft, leadId: "other" }, r)).not.toBe(ref);
    expect(draftRef("org-1", built.draft, { ...r, brands: [{ ...r.brands[0], classes: ["Clothing"] }] })).not.toBe(ref);
    expect(draftRef("org-1", { ...built.draft, payLink: "https://pay.example.com" }, r)).not.toBe(ref);
  });

  it("the server writes the question and the ref, replacing any the model wrote", () => {
    const out = withConfirmation("Here it is. Create this draft?", "- Client: Jane Doe", "abc123");
    expect(out.match(/Create this draft\?/g)).toHaveLength(1);
    expect(out).toContain("- Client: Jane Doe");
    expect(out.endsWith("Create this draft? (draft ref abc123)")).toBe(true);
    expect(confirmsDraft(out, "abc123")).toBe(true);
    expect(confirmsDraft(out, "abc124")).toBe(false);
    expect(confirmsDraft(null, "abc123")).toBe(false);
  });

  it("asks for a proposal only when a user turn says so", () => {
    expect(askedForProposal(["draft a proposal for Jane"])).toBe(true);
    expect(askedForProposal(["Can you put together a quote?"])).toBe(true);
    expect(askedForProposal(["what's the status of AURELIA"])).toBe(false);
  });

  it("reads the previous answer only when the thread's last turn is an answer", () => {
    expect(confirmationContext("o", " yes ", [{ role: "user", content: "a proposal" }, { role: "assistant", content: "A" }])).toEqual({
      orgId: "o",
      question: "yes",
      previousAnswer: "A",
      userTurns: ["a proposal", " yes "],
    });
    expect(confirmationContext("o", "yes", [{ role: "user", content: "a proposal" }]).previousAnswer).toBeNull();
  });
});
