import { describe, expect, it } from "vitest";
import frozen from "./frozen/pre-sprint.json";
import { consultChoice } from "@/lib/consult-proposal/draft";
import { draftProposalFromConsult } from "@/lib/consult-proposal/draft";
import type { ConsultProposalDraft } from "@/lib/consult-proposal/types";
import { publicContent } from "@/lib/proposals/public";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { validateContent } from "@/lib/proposals/validate";
import { fakeLlm } from "../agents/helpers";
import { draftInput, meetingSource, SEVETRI_TURNS, sevetriOutput } from "./fixture";
import { FROZEN_LIST, melvinLead, melvinOutput, MELVIN, SCENARIOS } from "./frozen-scenarios";

type Ok = Extract<ConsultProposalDraft, { ok: true }>;
const ok = (d: ConsultProposalDraft): Ok => {
  if (!d.ok) throw new Error(`${d.reason}: ${d.message}`);
  return d;
};
const quoteOf = (d: Ok) => quoteProposal(d.content, defaultSelection(d.content));

describe("F4: no New proposals offer saved -> the pre-sprint content, plus made_by, made_from and checks", () => {
  for (const name of Object.keys(SCENARIOS)) {
    it(name, async () => {
      const d = ok(await SCENARIOS[name]());
      const { made_by, made_from, checks, ...rest } = d.content;
      expect(made_by).toBe("assistant");
      expect(Array.isArray(checks)).toBe(true);
      expect(made_from === undefined || /^\d{4}-\d{2}-\d{2}$/.test(made_from.consult_date)).toBe(true);
      const before = (frozen as Record<string, { content: unknown; issues: unknown; clientEmail: unknown; expiresOn: unknown; title: unknown }>)[name];
      expect(JSON.parse(JSON.stringify(rest))).toEqual(before.content);
      expect(JSON.parse(JSON.stringify(d.issues))).toEqual(before.issues);
      expect(d.clientEmail).toEqual(before.clientEmail);
      expect(d.expiresOn).toEqual(before.expiresOn);
      expect(d.title).toEqual(before.title);
      // the same figures on the one price engine
      const old = { ...(before.content as object) } as Parameters<typeof quoteProposal>[0];
      expect(quoteOf(d)).toEqual(quoteProposal(old, defaultSelection(old)));
    });
  }
});

const settingWith = (newOffer: unknown) => ({ packages: FROZEN_LIST, new_offer: newOffer });
const run = (over: Record<string, unknown>, out = melvinOutput(), turns = MELVIN) =>
  draftProposalFromConsult(
    draftInput(fakeLlm(out).llm, { source: meetingSource(turns), lead: melvinLead, packages: FROZEN_LIST, ...over }),
  );
const CALM = { second_mark_discount: null, credits: [] };

describe("F2: the firm's 'client chooses' offer starts on the package recommended on the call", () => {
  it("per brand: every brand's default is the recommended package and the options are the setting's", async () => {
    const d = ok(await run({ settingPricing: settingWith({ mode: "choice", per: "brand", options: ["Essential", "Enhanced", "Concierge"], start: "Concierge" }) }, melvinOutput(CALM)));
    for (const n of d.content.names) {
      expect(n.package_choice).toEqual({ options: ["Essential", "Enhanced", "Concierge"], default: "Essential" });
      expect(n.marks.every((m) => !m.package_choice)).toBe(true);
    }
    expect(d.content.packages?.map((p) => p.package).sort()).toEqual(["Concierge", "Enhanced", "Essential"]);
    expect(d.content.made_by).toBe("assistant");
    expect(validateContent(d.content).filter((i) => i.level === "error")).toEqual([]);
    expect(quoteOf(d).names[0].package).toBe("Essential");
  });

  it("per mark: the choice is on each mark and none on the brand", async () => {
    const d = ok(await run({ settingPricing: settingWith({ mode: "choice", per: "mark", options: ["Essential", "Enhanced"], start: "Enhanced" }) }, melvinOutput(CALM)));
    const n = d.content.names[0];
    expect(n.package_choice).toBeUndefined();
    expect(n.marks.map((m) => m.package_choice)).toEqual([
      { options: ["Essential", "Enhanced"], default: "Essential" },
      { options: ["Essential", "Enhanced"], default: "Essential" },
    ]);
    expect(validateContent(d.content).filter((i) => i.level === "error")).toEqual([]);
  });

  it("a recommended package missing from the options is added and the last other option dropped (never over 3)", async () => {
    const d = ok(await run({ settingPricing: settingWith({ mode: "choice", per: "brand", options: ["Enhanced", "Concierge"], start: "Enhanced" }) }, melvinOutput(CALM)));
    expect(d.content.names[0].package_choice).toEqual({ options: ["Enhanced", "Concierge", "Essential"], default: "Essential" });
    expect(consultChoice({ mode: "choice", per: "brand", options: ["A", "B", "C"], start: "A" }, "D")).toEqual({ options: ["A", "B", "D"], start: "D" });
    expect(consultChoice({ mode: "choice", per: "brand", options: ["A", "B"], start: "A" }, "D")).toEqual({ options: ["A", "B", "D"], start: "D" });
  });

  it("no recommendation matched the list: the setting's own start stands and the CHECK FIRST package flag stays", async () => {
    const d = ok(await run({ settingPricing: settingWith({ mode: "choice", per: "brand", options: ["Enhanced", "Concierge"], start: "Concierge" }) }, melvinOutput({ ...CALM, recommended_package: "Platinum" })));
    expect(d.content.names[0].package_choice).toEqual({ options: ["Enhanced", "Concierge"], default: "Concierge" });
    expect(d.reviewerNotes).toContain("CHECK FIRST:");
    expect(d.content.checks?.some((c) => c.path === "pricing.package")).toBe(true);
  });

  it("'one package' or no setting gives no choice", async () => {
    for (const setting of [settingWith({ mode: "one", per: "brand", options: ["Concierge"], start: "Concierge" }), { packages: FROZEN_LIST }]) {
      const d = ok(await run({ settingPricing: setting }, melvinOutput(CALM)));
      expect(d.content.names[0].package_choice).toBeUndefined();
      expect(d.content.packages).toBeUndefined();
      expect(d.content.pricing.package).toBe("Essential");
    }
  });
});

describe("F3 and D3: evidence rules hold with the choice setting on", () => {
  const choiceSetting = settingWith({ mode: "choice", per: "brand", options: ["Essential", "Enhanced", "Concierge"], start: "Concierge" });

  it("a package whose name is not in the record is not used, with the choice setting on", async () => {
    const turns = MELVIN.filter((t) => !t.text.includes("Essential"));
    const d = ok(await run({ settingPricing: choiceSetting }, melvinOutput(CALM), turns));
    expect(d.reviewerNotes).toContain("not found in the record");
    expect(d.content.names[0].package_choice?.default).toBe("Concierge");
  });

  it("a price whose quote is not in the record is not applied and the brand keeps its choice", async () => {
    const out = sevetriOutput();
    out.price_changes = [{ brand: "Prosperall", amount_usd: 4000, quote: "I can do Prosperall for $4,000 instead" }];
    const d = ok(await draftProposalFromConsult(draftInput(fakeLlm(out).llm, { packages: FROZEN_LIST, settingPricing: choiceSetting })));
    expect(d.content.names[0].price_override).toBeUndefined();
    expect(d.content.names[0].package_choice).toBeDefined();
    expect(d.reviewerNotes).toContain("Not applied: a price of $4,000 for Prosperall, because its quote was not found");
  });

  it("a brand with an applied price override is ONE package, and a flag says why", async () => {
    const out = sevetriOutput();
    out.price_changes = [{ brand: "Prosperall", amount_usd: 4000, quote: "I can do Prosperall for $4,000 instead" }];
    const d = ok(
      await draftProposalFromConsult(
        draftInput(fakeLlm(out).llm, {
          source: meetingSource([...SEVETRI_TURNS, { speaker: "Rebecca", text: "I can do Prosperall for $4,000 instead." }]),
          packages: FROZEN_LIST,
          settingPricing: choiceSetting,
        }),
      ),
    );
    expect(d.content.names[0].price_override).toEqual({ base_cents: 400_000 });
    expect(d.content.names[0].package_choice).toBeUndefined();
    expect(d.content.names[1].package_choice?.default).toBe("Concierge");
    expect(d.reviewerNotes).toContain('"client chooses" package setting was not used for Prosperall');
    expect(validateContent(d.content).filter((i) => i.level === "error")).toEqual([]);
    expect(d.content.checks?.some((c) => c.path === "names[0].price_override")).toBe(true);
  });

  it("an applied custom package makes every brand one package", async () => {
    const out = melvinOutput({ ...CALM, recommended_package: "Enhanced", reduced_package: { quote: "If you only want one class I can reduce the package price for you" } });
    const d = ok(
      await run(
        { settingPricing: choiceSetting },
        out,
        [...MELVIN, { speaker: "Rebecca", text: "If you only want one class I can reduce the package price for you." }, { speaker: "Rebecca", text: "Enhanced is the one for you." }],
      ),
    );
    expect(d.content.pricing.reduce_under_included).toBe(true);
    expect(d.content.names.every((n) => !n.package_choice)).toBe(true);
    expect(d.content.packages).toBeUndefined();
    expect(d.reviewerNotes).toContain("custom package from the call is priced as one package");
  });

  it("the second-mark percent from the call applies to the recommended package only, and is flagged", async () => {
    const d = ok(await run({ settingPricing: choiceSetting }, melvinOutput({ credits: [] })));
    const by = Object.fromEntries((d.content.packages ?? []).map((p) => [p.package, p.second_mark_discount_pct]));
    expect(by).toEqual({ Essential: 10, Enhanced: 20, Concierge: 20 });
    expect(d.content.pricing.second_mark_discount_pct).toBe(10);
    expect(d.reviewerNotes).toContain("applies to Essential only");
  });
});

describe("D4: field-specific checks are stored on the content and never published", () => {
  it("lists the price, credit, second-mark, package, pay link and email checks with the field each is about", async () => {
    const d = ok(await run({ settingPricing: settingWith({ mode: "choice", per: "brand", options: ["Essential", "Enhanced"], start: "Essential" }), lead: { ...melvinLead, email: null } }));
    const paths = (d.content.checks ?? []).map((c) => c.path);
    expect(paths).toEqual(expect.arrayContaining(["adjustments[0]", "pricing.second_mark_discount_pct", "names[0].package_choice", "pay_url", "client_email"]));
    expect(d.content.checks!.length).toBeLessThanOrEqual(12);
    expect(d.content.checks!.every((c) => c.source === "consult" && c.text.length <= 300)).toBe(true);
    expect(publicContent(d.content)).not.toHaveProperty("checks");
    expect(validateContent(d.content).filter((i) => i.level === "error")).toEqual([]);
  });
});
