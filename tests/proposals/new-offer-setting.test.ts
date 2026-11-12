import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MAX_SETTINGS_PRICING_BYTES, NEW_OFFER_MARKER, parseNewOffer, parseNewOfferForm, readNewOffer, withNewOffer } from "@/lib/proposals/new-offer";
import { buildDraftContent } from "@/lib/proposals/draft-spec";
import { withPackages, normalisePackages } from "@/lib/proposals/package-list";
import { parseSettingsPricing } from "@/lib/proposal-editor/form";
import { NewOfferSection } from "@/components/proposal-editor/NewOfferSection";

/** Sprint 3 D6/F7: the "New proposals offer" firm setting. */

const APPROVER = "99999999-9999-4999-8999-999999999999";
const PACKAGES = [
  { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
  { package: "Enhanced", base_cents: 325_000, included_classes: 2, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
  { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
];
const NAMES = PACKAGES.map((p) => p.package);

/** Everything else a firm's settings pricing holds, so "untouched" means something. */
const STORED = {
  ...PACKAGES[2],
  packages: PACKAGES.map((p, i) => (i === 1 ? { ...p, includes: [{ label: "Enhanced extra", included: "Yes", highlight: true }] } : { ...p })),
  includes: [{ label: "Classes included", included: "Your choice", highlight: true }],
  office_action_note: "The response itself is quoted separately.",
  approval_routing: { post_consult_email: "11111111-1111-4111-8111-111111111111", welcome_email: "22222222-2222-4222-8222-222222222222" },
  lawmatics_loe_fields: { enabled: true, map: { "Mark name": 42 } },
};

const form = (entries: Array<[string, string]>) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const OFFER_FIELDS: Array<[string, string]> = [
  [NEW_OFFER_MARKER, "1"],
  ["newOffer.mode", "choice"],
  ["newOffer.per", "brand"],
  ["newOffer.option", "Essential"],
  ["newOffer.option", "Enhanced"],
  ["newOffer.start", "Enhanced"],
];
const PACKAGE_FIELDS: Array<[string, string]> = PACKAGES.flatMap((p, n): Array<[string, string]> => [
  [`pkg.${n}.package`, p.package],
  [`pkg.${n}.base`, String(p.base_cents / 100)],
  [`pkg.${n}.includedClasses`, String(p.included_classes)],
  [`pkg.${n}.perClass`, "825"],
  [`pkg.${n}.secondMarkPct`, "20"],
  [`pkg.${n}.govPerClass`, "350"],
]);
const INCLUDE_FIELDS: Array<[string, string]> = [
  ["inc.0.label", "Classes included"],
  ["inc.0.included", "Your choice"],
  ["inc.0.highlight", "on"],
];

describe("parsing the stored setting", () => {
  it("drops unknown package names, keeps at most 3 options, and starts on the first when the start is gone", () => {
    expect(parseNewOffer({ mode: "choice", per: "brand", options: ["Platinum", "Essential", "Enhanced", "Concierge", "Essential"], start: "Platinum" }, NAMES)).toEqual({
      mode: "choice",
      per: "brand",
      options: ["Essential", "Enhanced", "Concierge"],
      start: "Essential",
    });
    expect(parseNewOffer({ mode: "choice", per: "mark", options: ["A", "B", "C", "D"], start: "A" }, ["A", "B", "C", "D"])!.options).toEqual(["A", "B", "C"]);
  });

  it("nothing usable is null (the firm's first package)", () => {
    for (const raw of [undefined, null, "x", [], {}, { mode: "choice", options: [] }, { mode: "choice", options: ["Platinum"] }, { mode: "weird", options: ["Essential"] }]) {
      expect(parseNewOffer(raw, NAMES)).toBeNull();
    }
  });

  it("a one-package offer keeps just its package", () => {
    expect(parseNewOffer({ mode: "one", per: "brand", options: ["Essential", "Enhanced"], start: "Enhanced" }, NAMES)).toEqual({ mode: "one", per: "brand", options: ["Enhanced"], start: "Enhanced" });
  });
});

describe("the form's fields", () => {
  it("a post without the control leaves the key alone", () => {
    expect(parseNewOfferForm(form([]), NAMES)).toEqual({ ok: true, value: undefined });
  });

  it("'default' clears it; 'choice' stores the ticked names and the start", () => {
    expect(parseNewOfferForm(form([[NEW_OFFER_MARKER, "1"], ["newOffer.mode", "default"]]), NAMES)).toEqual({ ok: true, value: null });
    expect(parseNewOfferForm(form(OFFER_FIELDS), NAMES)).toEqual({ ok: true, value: { mode: "choice", per: "brand", options: ["Essential", "Enhanced"], start: "Enhanced" } });
  });

  it("refuses a package that isn't the firm's, more than 3, none, and an unknown mode", () => {
    const bad = (extra: Array<[string, string]>) => parseNewOfferForm(form([[NEW_OFFER_MARKER, "1"], ["newOffer.mode", "choice"], ...extra]), NAMES);
    expect(bad([["newOffer.option", "Platinum"]])).toMatchObject({ ok: false });
    expect(bad([])).toMatchObject({ ok: false });
    expect(parseNewOfferForm(form([[NEW_OFFER_MARKER, "1"], ["newOffer.mode", "choice"], ...["A", "B", "C", "D"].map((o): [string, string] => ["newOffer.option", o])]), ["A", "B", "C", "D"])).toMatchObject({ ok: false });
    expect(parseNewOfferForm(form([[NEW_OFFER_MARKER, "1"], ["newOffer.mode", "robot"]]), NAMES)).toMatchObject({ ok: false });
  });
});

describe("saving: the other keys stay byte for byte", () => {
  it("withNewOffer sets one key and leaves approvers' routing, LOE fields, package rows and includes deep-equal", () => {
    const r = withNewOffer(STORED, { mode: "choice", per: "brand", options: ["Essential", "Enhanced"], start: "Enhanced" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { new_offer, ...rest } = r.value;
    expect(new_offer).toEqual({ mode: "choice", per: "brand", options: ["Essential", "Enhanced"], start: "Enhanced" });
    expect(rest).toEqual(STORED);
    expect(JSON.stringify(rest)).toBe(JSON.stringify(STORED));
    // The input is not mutated.
    expect(STORED).not.toHaveProperty("new_offer");
  });

  it("the prices-only helpers and the settings parser keep the key", () => {
    const withKey = { ...STORED, new_offer: { mode: "choice", per: "mark", options: ["Essential"], start: "Essential" } };
    expect(withPackages(withKey, normalisePackages(withKey)).new_offer).toEqual(withKey.new_offer);
    const parsed = parseSettingsPricing(form(INCLUDE_FIELDS), withKey);
    expect(parsed.ok && (parsed.value as Record<string, unknown>).new_offer).toEqual(withKey.new_offer);
    expect(parsed.ok && (parsed.value as Record<string, unknown>).approval_routing).toEqual(STORED.approval_routing);
  });

  it("null removes the key and nothing else", () => {
    const r = withNewOffer({ ...STORED, new_offer: { mode: "one", per: "brand", options: ["Essential"], start: "Essential" } }, null);
    expect(r).toEqual({ ok: true, value: STORED });
  });

  it("a serialised pricing over 64 KB is refused with a fixed sentence", () => {
    const huge = { ...STORED, includes: Array.from({ length: 400 }, (_, i) => ({ label: `Row ${i}`, included: "x".repeat(200) })) };
    expect(new TextEncoder().encode(JSON.stringify(huge)).length).toBeGreaterThan(MAX_SETTINGS_PRICING_BYTES - 200);
    const r = withNewOffer({ ...huge, includes: [...huge.includes, ...huge.includes] }, { mode: "one", per: "brand", options: ["Essential"], start: "Essential" });
    expect(r).toEqual({ ok: false, error: "These settings are too large to save. Remove some included items first." });
  });
});

describe("saveProposalSettingsAction", () => {
  beforeEach(() => vi.resetModules());

  async function setup(opts: { gate?: { error: string } | null; existing?: Record<string, unknown> } = {}) {
    const saved = vi.fn(async (input: unknown) => input);
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ gateAdminAction: vi.fn(async () => opts.gate ?? null) }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => [{ userId: APPROVER }]) }));
    vi.doMock("@/lib/proposals/store", () => ({
      getProposalSettings: vi.fn(async () => ({
        org_id: "o",
        approver_user_ids: [APPROVER],
        default_pay_url: "https://pay.example/x",
        notify_email: "owner@firm.example",
        pricing: opts.existing ?? STORED,
      })),
      saveProposalSettings: saved,
    }));
    const { saveProposalSettingsAction } = await import("../../src/app/dashboard/settings/proposals/actions");
    const run = (entries: Array<[string, string]>) => saveProposalSettingsAction({}, form([["approver", APPROVER], ...entries]));
    return { saved, run };
  }
  const pricingOf = (saved: ReturnType<typeof vi.fn>) => (saved.mock.calls[0][0] as { pricing: Record<string, unknown> }).pricing;

  it("'client chooses among Essential and Enhanced, per brand, starting on Enhanced' is stored under pricing.new_offer; routing, LOE fields and package rows stay", async () => {
    const { saved, run } = await setup();
    const r = await run([...INCLUDE_FIELDS, ["officeActionNote", STORED.office_action_note], ...PACKAGE_FIELDS, ...OFFER_FIELDS]);
    expect(r).toEqual({ saved: true });
    const pricing = pricingOf(saved);
    expect(pricing.new_offer).toEqual({ mode: "choice", per: "brand", options: ["Essential", "Enhanced"], start: "Enhanced" });
    expect(pricing.approval_routing).toEqual(STORED.approval_routing);
    expect(pricing.lawmatics_loe_fields).toEqual(STORED.lawmatics_loe_fields);
    expect(pricing.office_action_note).toBe(STORED.office_action_note);
    expect((pricing.packages as Array<{ package: string; includes?: unknown }>)[1].includes).toEqual([{ label: "Enhanced extra", included: "Yes", highlight: true }]);
    expect((saved.mock.calls[0][0] as { approverUserIds: string[] }).approverUserIds).toEqual([APPROVER]);
  });

  it("a post without the control leaves a stored new_offer alone", async () => {
    const existing = { ...STORED, new_offer: { mode: "one", per: "brand", options: ["Essential"], start: "Essential" } };
    const { saved, run } = await setup({ existing });
    await run([...INCLUDE_FIELDS, ...PACKAGE_FIELDS]);
    expect(pricingOf(saved).new_offer).toEqual(existing.new_offer);
  });

  it("a package renamed away in the same post is refused and nothing is written", async () => {
    const { saved, run } = await setup();
    const renamed = PACKAGE_FIELDS.map(([k, v]): [string, string] => (k === "pkg.1.package" ? [k, "Plus"] : [k, v]));
    const r = await run([...INCLUDE_FIELDS, ...renamed, ...OFFER_FIELDS]);
    expect(r.error).toMatch(/isn't one of your firm's packages/);
    expect(saved).not.toHaveBeenCalled();
  });

  it("over 64 KB: refused with the fixed sentence, nothing written", async () => {
    const big = { ...STORED, includes: Array.from({ length: 330 }, (_, i) => ({ label: `Row ${i}`, included: "x".repeat(200) })) };
    const { saved, run } = await setup({ existing: big });
    const inc: Array<[string, string]> = big.includes.flatMap((r, i): Array<[string, string]> => [[`inc.${i}.label`, r.label], [`inc.${i}.included`, r.included]]);
    const r = await run([...inc, ...PACKAGE_FIELDS, ...OFFER_FIELDS]);
    expect(r).toEqual({ error: "These settings are too large to save. Remove some included items first." });
    expect(saved).not.toHaveBeenCalled();
  });

  it("a non-admin role is refused by the gate before anything is read", async () => {
    const { saved, run } = await setup({ gate: { error: "Owners, admins and senior admins can change the proposal settings." } });
    expect(await run([...INCLUDE_FIELDS, ...OFFER_FIELDS])).toEqual({ error: "Owners, admins and senior admins can change the proposal settings." });
    expect(saved).not.toHaveBeenCalled();
  });
});

describe("buildDraftContent uses it as the starting point", () => {
  it("given the setting and no explicit offer, a brand starts as a per-brand choice on Enhanced", () => {
    const pricing = { ...STORED, new_offer: { mode: "choice", per: "brand", options: ["Essential", "Enhanced"], start: "Enhanced" } };
    expect(readNewOffer(pricing)).toEqual({ mode: "choice", per: "brand", options: ["Essential", "Enhanced"], start: "Enhanced" });
    const r = buildDraftContent({ kind: "trademark", madeBy: "person", client: { fullName: "Ana Ruiz" }, names: [{ name: "Acme", classes: ["Software"] }] }, { pricing, letter: null }, (() => { let i = 0; return () => `r${i++}`; })());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content.names[0].package_choice).toEqual({ options: ["Essential", "Enhanced"], default: "Enhanced" });
      expect(r.content.packages!.map((p) => p.package)).toEqual(NAMES);
    }
  });
});

describe("the Settings control sits in the one settings form", () => {
  it("renders the offer section with its heading, a mode, and package names only (no price field)", () => {
    const html = renderToStaticMarkup(createElement(NewOfferSection, { packageNames: NAMES, offer: { mode: "choice", per: "mark", options: ["Essential", "Enhanced"], start: "Enhanced" } }));
    expect(html).toContain("New proposals offer");
    expect(html).toContain(`name="${NEW_OFFER_MARKER}"`);
    expect(html).toContain('name="newOffer.mode"');
    for (const n of NAMES) expect(html).toContain(`value="${n}"`);
    expect(html).not.toMatch(/name="[^"]*(base|price|cents|perClass)/i);
    expect(html).not.toContain("<form");
  });

  it("SettingsForm places it inside its single form, beside the packages", async () => {
    const { SettingsForm } = await import("@/components/proposal-editor/SettingsForm");
    vi.doMock("@/app/dashboard/settings/proposals/actions", () => ({ saveProposalSettingsAction: vi.fn() }));
    const html = renderToStaticMarkup(
      createElement(SettingsForm, {
        members: [],
        values: { approverUserIds: [], notifyEmail: "", officeActionNote: "", includes: [] },
        packages: PACKAGES.map((p) => ({ package: p.package, base: "1", includedClasses: "1", perClass: "1", secondMarkPct: "0", govPerClass: "1", includes: [] })),
        newOffer: null,
      }),
    );
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html.indexOf("New proposals offer")).toBeGreaterThan(html.indexOf("<form"));
    expect(html.indexOf("New proposals offer")).toBeLessThan(html.indexOf("</form>"));
    expect(html.match(/Save proposal settings/g)).toHaveLength(1);
  });
});
