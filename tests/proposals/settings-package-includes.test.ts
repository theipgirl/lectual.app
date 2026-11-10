/**
 * Settings -> Proposals: each package's own "What this package includes" rows (2026-11-10).
 *
 * Before this, `client_proposal_setting.pricing.packages[]` had no includes rows and no way to save any, so a
 * new proposal's package snapshot had none and the client page's "What each package includes" comparison was
 * empty. Settings now posts `pkg.<n>.inc.<r>.<field>` with the marker `pkg.<n>.incFields=1`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { parsePackageList, MAX_PACKAGE_INCLUDE_ROWS } from "@/lib/proposal-editor/form";
import { DEFAULT_PROPOSAL_PRICING, normalisePackages, withPackages } from "@/lib/proposals/package-list";
import { packageOffersFromSetting, withPackageSnapshot } from "@/lib/proposals/package-snapshot";
import { validateSettingInput } from "@/lib/proposals/validate";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { danielle } from "./danielle-fixture";

const APPROVER = "99999999-9999-4999-8999-999999999999";

const toForm = (entries: Array<[string, string]>) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const pkg = (n: number, name: string, base = "1950.00"): Array<[string, string]> => [
  [`pkg.${n}.package`, name],
  [`pkg.${n}.base`, base],
  [`pkg.${n}.includedClasses`, "1"],
  [`pkg.${n}.perClass`, "825.00"],
  [`pkg.${n}.secondMarkPct`, "20"],
  [`pkg.${n}.govPerClass`, "350.00"],
];
const inc = (n: number, r: number, label: string, included = "✓", extra: Array<[string, string]> = []): Array<[string, string]> => [
  [`pkg.${n}.inc.${r}.label`, label],
  [`pkg.${n}.inc.${r}.included`, included],
  ...extra.map(([k, v]) => [`pkg.${n}.inc.${r}.${k}`, v] as [string, string]),
];
const marker = (n: number): [string, string] => [`pkg.${n}.incFields`, "1"];

describe("parsePackageList reads each package's includes rows", () => {
  it("reads the rows of a package whose form carried them, in order, with the optional cells", () => {
    const r = parsePackageList(
      toForm([...pkg(0, "Essential"), marker(0), ...inc(0, 0, "Knockout search", "✓", [["highlight", "on"]]), ...inc(0, 1, "Office action responses", "1", [["note", "Non-final only"], ["value", "$450 each"]])]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value[0].includes).toEqual([
      { label: "Knockout search", included: "✓", highlight: true },
      { label: "Office action responses", value: "$450 each", included: "1", note: "Non-final only" },
    ]);
    // The price fields are exactly what they were before.
    expect(r.value[0]).toMatchObject({ package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 });
  });

  it("keeps each package's rows with its own package, even when the posted numbers skip", () => {
    const r = parsePackageList(toForm([...pkg(0, "Essential"), marker(0), ...inc(0, 0, "A"), ...pkg(3, "Concierge"), marker(3), ...inc(3, 2, "C")]));
    expect(r.ok && r.value.map((p) => p.includes)).toEqual([[{ label: "A", included: "✓" }], [{ label: "C", included: "✓" }]]);
  });

  it("no marker: no includes key (keep what is stored); marker with no rows: [] (clear them)", () => {
    const r = parsePackageList(toForm([...pkg(0, "Essential"), ...pkg(1, "Enhanced"), marker(1)]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("includes" in r.value[0]).toBe(false);
    expect(r.value[1].includes).toEqual([]);
  });

  it("drops a row left blank, refuses a row with text but no item name", () => {
    const blank = parsePackageList(toForm([...pkg(0, "Essential"), marker(0), ...inc(0, 0, "", "")]));
    expect(blank.ok && blank.value[0].includes).toEqual([]);
    const noName = parsePackageList(toForm([...pkg(0, "Essential"), marker(0), ...inc(0, 0, "", "Unlimited")]));
    expect(noName).toEqual({ ok: false, error: "Package 1 (Essential), included item 1: give it a name." });
  });

  it("refuses too many rows and an over-long cell", () => {
    const many: Array<[string, string]> = [...pkg(0, "Essential"), marker(0)];
    for (let r = 0; r <= MAX_PACKAGE_INCLUDE_ROWS; r++) many.push(...inc(0, r, `Row ${r}`));
    expect(parsePackageList(toForm(many))).toEqual({ ok: false, error: `Package 1 (Essential): list at most ${MAX_PACKAGE_INCLUDE_ROWS} things this package includes.` });
    const long = parsePackageList(toForm([...pkg(0, "Essential"), marker(0), ...inc(0, 0, "x".repeat(301))]));
    expect(long.ok).toBe(false);
  });
});

describe("withPackages stores the rows on the package, never in the flat fields", () => {
  const ROWS = [{ label: "Knockout search", included: "✓" }];
  const STANDARD = [{ label: "Firm standard row", included: "✓" }];

  it("writes a package's rows on its own entry and leaves the firm's standard table alone", () => {
    const out = withPackages({ includes: STANDARD }, [{ ...DEFAULT_PROPOSAL_PRICING, package: "Essential", includes: ROWS }]);
    expect((out.packages as Array<Record<string, unknown>>)[0].includes).toEqual(ROWS);
    expect(out.includes).toEqual(STANDARD);
    expect(out.package).toBe("Essential");
  });

  it("an entry with no includes key keeps the rows the same-named package had (the prices-only save)", () => {
    const stored = { packages: [{ ...DEFAULT_PROPOSAL_PRICING, package: "Essential", includes: ROWS }] };
    const out = withPackages(stored, [{ ...DEFAULT_PROPOSAL_PRICING, package: " essential ", base_cents: 210_000 }]);
    const entry = (out.packages as Array<Record<string, unknown>>)[0];
    expect(entry.includes).toEqual(ROWS);
    expect(entry.base_cents).toBe(210_000);
  });

  it("[] removes the rows; a package with none has no includes key", () => {
    const stored = { packages: [{ ...DEFAULT_PROPOSAL_PRICING, package: "Essential", includes: ROWS }] };
    const out = withPackages(stored, [{ ...DEFAULT_PROPOSAL_PRICING, package: "Essential", includes: [] }, { ...DEFAULT_PROPOSAL_PRICING, package: "Enhanced" }]);
    for (const entry of out.packages as Array<Record<string, unknown>>) expect("includes" in entry).toBe(false);
  });

  it("the stored list still normalises to the same prices", () => {
    const out = withPackages({}, [{ ...DEFAULT_PROPOSAL_PRICING, package: "Essential", includes: ROWS }]);
    expect(normalisePackages(out)).toEqual([{ ...DEFAULT_PROPOSAL_PRICING, package: "Essential" }]);
  });
});

describe("validateSettingInput checks a package's rows like the standard table", () => {
  const base = { approver_user_ids: [APPROVER], default_pay_url: null, notify_email: null };
  it("accepts good rows and refuses a row with no label", () => {
    const good = validateSettingInput({ ...base, pricing: { packages: [{ ...DEFAULT_PROPOSAL_PRICING, includes: [{ label: "Search", included: "✓" }] }] } });
    expect(good.filter((i) => i.level === "error")).toEqual([]);
    const bad = validateSettingInput({ ...base, pricing: { packages: [{ ...DEFAULT_PROPOSAL_PRICING, includes: [{ label: " ", included: "✓" }] }] } });
    expect(bad.some((i) => i.level === "error" && i.path === "pricing.packages[0].includes[0].label")).toBe(true);
  });
});

describe("a new proposal gets the firm's rows", () => {
  it("saved rows reach the snapshot of a package new to the proposal; prices are unchanged", () => {
    const essential = [{ label: "Knockout search", included: "✓" }];
    const concierge = [{ label: "Comprehensive search", included: "Full" }];
    const setting = withPackages({}, [
      { package: "Essential", base_cents: 195_000, per_class_cents: 82_500, included_classes: 1, gov_per_class_cents: 35_000, second_mark_discount_pct: 20, includes: essential },
      { package: "Enhanced", base_cents: 325_000, per_class_cents: 82_500, included_classes: 2, gov_per_class_cents: 35_000, second_mark_discount_pct: 20 },
      { package: "Concierge", base_cents: 495_000, per_class_cents: 82_500, included_classes: 3, gov_per_class_cents: 35_000, second_mark_discount_pct: 20, includes: concierge },
    ]);
    const before = danielle();
    const c = danielle();
    delete c.packages;
    const snap = withPackageSnapshot(c, setting);
    expect(snap.packages?.map((p) => p.includes)).toEqual([essential, undefined, concierge]);
    expect(packageOffersFromSetting(setting)[0].includes).toEqual(essential);
    expect(quoteProposal(snap, defaultSelection(snap))).toEqual(quoteProposal(before, defaultSelection(before)));
  });
});

describe("saveProposalSettingsAction and the settings page", () => {
  beforeEach(() => vi.resetModules());

  it("saves each package's rows from the one settings form", async () => {
    const saved = vi.fn(async (input: unknown) => input);
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ gateAdminAction: vi.fn(async () => null) }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => [{ userId: APPROVER }]) }));
    vi.doMock("@/lib/proposals/store", () => ({
      getProposalSettings: vi.fn(async () => ({ org_id: "o", approver_user_ids: [APPROVER], default_pay_url: null, notify_email: null, pricing: { includes: [{ label: "Std", included: "✓" }] } })),
      saveProposalSettings: saved,
    }));
    const { saveProposalSettingsAction } = await import("../../src/app/dashboard/settings/proposals/actions");
    const form = toForm([["approver", APPROVER], ["inc.0.label", "Std"], ["inc.0.included", "✓"], ...pkg(0, "Essential"), marker(0), ...inc(0, 0, "Knockout search"), ...pkg(1, "Concierge", "4950.00"), marker(1)]);
    const result = await saveProposalSettingsAction({}, form);
    expect(result.error).toBeUndefined();
    const { pricing } = saved.mock.calls[0][0] as { pricing: Record<string, unknown> };
    expect(pricing.packages).toEqual([
      { ...DEFAULT_PROPOSAL_PRICING, package: "Essential", base_cents: 195_000, included_classes: 1, includes: [{ label: "Knockout search", included: "✓" }] },
      { ...DEFAULT_PROPOSAL_PRICING, package: "Concierge", base_cents: 495_000, included_classes: 1 },
    ]);
    expect(pricing.includes).toEqual([{ label: "Std", included: "✓" }]);
  });

  it("draws each package's stored rows under its prices, with the marker", async () => {
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined) }));
    vi.doMock("@/lib/auth/current-role", () => ({ currentRole: vi.fn(async () => "owner") }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
    vi.doMock("@/lib/proposals/store", () => ({
      getProposalSettings: vi.fn(async () => ({
        org_id: "o",
        approver_user_ids: [],
        default_pay_url: null,
        notify_email: null,
        pricing: { packages: [{ ...DEFAULT_PROPOSAL_PRICING, package: "Essential", includes: [{ label: "Knockout search", included: "✓" }] }, { ...DEFAULT_PROPOSAL_PRICING, package: "Concierge" }] },
      })),
    }));
    vi.doMock("@/app/dashboard/settings/proposals/actions", () => ({ saveProposalSettingsAction: vi.fn(), savePackagesAction: vi.fn() }));
    const { default: Page } = await import("../../src/app/dashboard/settings/proposals/page");
    const html = renderToStaticMarkup(createElement("div", null, await Page()));
    expect(html).toContain("What this package includes (1)");
    expect(html).toContain('name="pkg.0.incFields"');
    expect(html).toContain('name="pkg.1.incFields"');
    expect(html).toMatch(/name="pkg\.0\.inc\.0\.label"[^>]*value="Knockout search"/);
    expect(html).not.toContain('name="pkg.1.inc.0.label"');
  });
});
