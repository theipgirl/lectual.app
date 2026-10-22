import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { DEFAULT_PROPOSAL_PRICING, normalisePackages } from "@/lib/proposals/package-list";

/**
 * Settings -> Client proposals -> Package prices (Sprint 6, C). The card is its own form and
 * action: it saves the named package list and nothing else, and the main settings form keeps
 * the stored list.
 */

const APPROVER = "99999999-9999-4999-8999-999999999999";
const existingRow = (pricing: Record<string, unknown> = {}) => ({
  org_id: "org-1",
  approver_user_ids: [APPROVER],
  default_pay_url: "https://pay.example/x",
  notify_email: "owner@firm.example",
  pricing,
});

const toForm = (entries: Array<[string, string]>) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const pkg = (n: number, name: string, base: string, classes = "3", per = "825.00", pct = "20", gov = "350.00"): Array<[string, string]> => [
  [`pkg.${n}.package`, name],
  [`pkg.${n}.base`, base],
  [`pkg.${n}.includedClasses`, classes],
  [`pkg.${n}.perClass`, per],
  [`pkg.${n}.secondMarkPct`, pct],
  [`pkg.${n}.govPerClass`, gov],
];

describe("savePackagesAction", () => {
  beforeEach(() => vi.resetModules());

  async function setup(opts: { gate?: { error: string } | null; existing?: unknown; saveError?: unknown } = {}) {
    const saved = vi.fn(async (input: unknown) => {
      if (opts.saveError) throw opts.saveError;
      return input;
    });
    const revalidate = vi.fn();
    vi.doMock("next/cache", () => ({ revalidatePath: revalidate }));
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ gateAdminAction: vi.fn(async () => opts.gate ?? null) }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
    vi.doMock("@/lib/proposals/store", () => ({
      getProposalSettings: vi.fn(async () => (opts.existing === undefined ? existingRow({ includes: [{ label: "a", included: "b" }], office_action_note: "note", keep: 1 }) : opts.existing)),
      saveProposalSettings: saved,
    }));
    const { savePackagesAction } = await import("../../src/app/dashboard/settings/proposals/actions");
    return { saved, revalidate, run: (entries: Array<[string, string]>) => savePackagesAction({}, toForm(entries)) };
  }
  const savedWith = (saved: ReturnType<typeof vi.fn>) =>
    saved.mock.calls[0][0] as { approverUserIds: string[]; defaultPayUrl: string | null; notifyEmail: string | null; pricing: Record<string, unknown> };

  it("saves three packages, the first as the flat fields", async () => {
    const { saved, run, revalidate } = await setup();
    const result = await run([...pkg(0, "Concierge", "4950.00"), ...pkg(1, "Enhanced", "3250.00", "2", "700.00", "15"), ...pkg(2, "Essential", "1950.00", "1", "600.00", "10")]);
    expect(result.error).toBeUndefined();
    expect(result.saved).toBe(true);
    const { pricing } = savedWith(saved);
    expect(normalisePackages(pricing).map((p) => p.package)).toEqual(["Concierge", "Enhanced", "Essential"]);
    expect(pricing.packages).toHaveLength(3);
    expect(pricing).toMatchObject({ package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 });
    expect((pricing.packages as Array<{ base_cents: number }>)[2].base_cents).toBe(195_000);
    expect(revalidate).toHaveBeenCalledWith("/dashboard/settings/proposals/");
    expect(revalidate).toHaveBeenCalledWith("/dashboard/proposals/new/");
  });

  it("preserves approvers, links, notify address, includes and the office-action note", async () => {
    const { saved, run } = await setup();
    await run(pkg(0, "Concierge", "4950.00"));
    const input = savedWith(saved);
    expect(input.approverUserIds).toEqual([APPROVER]);
    expect(input.defaultPayUrl).toBe("https://pay.example/x");
    expect(input.notifyEmail).toBe("owner@firm.example");
    expect(input.pricing.includes).toEqual([{ label: "a", included: "b" }]);
    expect(input.pricing.office_action_note).toBe("note");
    expect(input.pricing.keep).toBe(1);
  });

  it("keeps the Lawmatics LOE fields setting (Sprint 19), on or off, exactly as stored", async () => {
    const loe = { enabled: true, map: { "LOE Package": "301", "LOE Legal Fee": "304" } };
    const { saved, run } = await setup({ existing: existingRow({ lawmatics_loe_fields: loe }) });
    await run(pkg(0, "Concierge", "4950.00"));
    expect(savedWith(saved).pricing.lawmatics_loe_fields).toEqual(loe);
  });

  it("works for a firm with nothing saved yet", async () => {
    const { saved, run } = await setup({ existing: null });
    const result = await run(pkg(0, "Concierge", "4950.00"));
    expect(result.saved).toBe(true);
    expect(savedWith(saved).approverUserIds).toEqual([]);
    expect(savedWith(saved).pricing.packages).toHaveLength(1);
  });

  it("refuses removing the last package (no rows posted) and saves nothing", async () => {
    const { saved, run } = await setup();
    const result = await run([]);
    expect(result.error).toBe("Keep at least one package.");
    expect(saved).not.toHaveBeenCalled();
  });

  it("refuses duplicate names, ignoring case", async () => {
    const { saved, run } = await setup();
    const result = await run([...pkg(0, "Concierge", "4950.00"), ...pkg(1, "concierge", "3250.00")]);
    expect(result.error).toMatch(/another package already uses that name/);
    expect(saved).not.toHaveBeenCalled();
  });

  it.each([
    ["a blank name", pkg(0, "  ", "4950.00"), /give the package a name/],
    ["a negative price", pkg(0, "A", "-5"), /^Package 1 \(A\), price with the included classes/],
    ["zero classes", pkg(0, "A", "100", "0"), /Classes included must be 1 or more/],
    ["a discount over 100", pkg(0, "A", "100", "3", "825", "150"), /^Package 1 \(A\), second mark discount/],
    ["a price that is not a number", pkg(0, "A", "lots"), /enter a dollar amount/],
  ])("refuses %s with a sentence", async (_name, entries, pattern) => {
    const { saved, run } = await setup();
    const result = await run(entries as Array<[string, string]>);
    expect(result.error).toMatch(pattern as RegExp);
    expect(saved).not.toHaveBeenCalled();
  });

  it("is refused for a role that cannot change the settings, before reading anything", async () => {
    const { saved, run } = await setup({ gate: { error: "Only owners, admins and senior admins can change the proposal settings." } });
    expect(await run(pkg(0, "Concierge", "4950.00"))).toEqual({ error: "Only owners, admins and senior admins can change the proposal settings." });
    expect(saved).not.toHaveBeenCalled();
  });

  it("shows the store's own refusal, and a plain sentence for anything unexpected", async () => {
    // Same module instance as the action's, or its instanceof check could not match.
    const { ProposalError } = await import("@/lib/proposals/errors");
    const refused = await setup({ saveError: new ProposalError("forbidden", "You don't have permission to change the proposal settings.") });
    expect((await refused.run(pkg(0, "Concierge", "4950.00"))).error).toBe("You don't have permission to change the proposal settings.");
    vi.resetModules();
    const broken = await setup({ saveError: new Error("secret db detail") });
    expect((await broken.run(pkg(0, "Concierge", "4950.00"))).error).toBe("Couldn't save the package prices.");
  });
});

describe("saveProposalSettingsAction keeps the stored packages", () => {
  beforeEach(() => vi.resetModules());

  it("saves includes and the note without touching the prices or the list", async () => {
    const stored = { packages: [{ ...DEFAULT_PROPOSAL_PRICING, package: "Enhanced" }, DEFAULT_PROPOSAL_PRICING], package: "Enhanced", base_cents: 495_000 };
    const saved = vi.fn(async (input: unknown) => input);
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ gateAdminAction: vi.fn(async () => null) }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => [{ userId: APPROVER }]) }));
    vi.doMock("@/lib/proposals/store", () => ({ getProposalSettings: vi.fn(async () => existingRow(stored)), saveProposalSettings: saved }));
    const { saveProposalSettingsAction } = await import("../../src/app/dashboard/settings/proposals/actions");
    const form = toForm([["approver", APPROVER], ["officeActionNote", "New note"], ["inc.0.label", "Search"], ["inc.0.included", "yes"], ["base", "1"], ["package", "Hacked"]]);
    const result = await saveProposalSettingsAction({}, form);
    expect(result.saved).toBe(true);
    const { pricing } = saved.mock.calls[0][0] as { pricing: Record<string, unknown> };
    expect(pricing.packages).toEqual(stored.packages);
    expect(pricing.package).toBe("Enhanced");
    expect(pricing.base_cents).toBe(495_000);
    expect(pricing.office_action_note).toBe("New note");
    expect(pricing.includes).toEqual([{ label: "Search", included: "yes" }]);
  });
});

describe("Settings -> Client proposals page: the Package prices card", () => {
  beforeEach(() => vi.resetModules());

  async function render(pricing: Record<string, unknown> | null, role = "owner") {
    vi.resetModules();
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined) }));
    vi.doMock("@/lib/auth/current-role", () => ({ currentRole: vi.fn(async () => role) }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => [{ userId: APPROVER, displayName: "Rebecca", email: "r@firm.example", role: "owner" }]) }));
    vi.doMock("@/lib/proposals/store", () => ({ getProposalSettings: vi.fn(async () => (pricing === null ? null : existingRow(pricing))) }));
    vi.doMock("@/app/dashboard/settings/proposals/actions", () => ({ saveProposalSettingsAction: vi.fn(), savePackagesAction: vi.fn() }));
    const { default: Page } = await import("../../src/app/dashboard/settings/proposals/page");
    return renderToStaticMarkup(createElement("div", null, await Page()));
  }
  const names = (html: string) => [...html.matchAll(/name="pkg\.(\d+)\.package"[^>]*value="([^"]*)"/g)].map((m) => [m[1], m[2]]);

  it("shows the design's copy, labels and controls", async () => {
    const html = await render({});
    expect(html).toContain("Package prices");
    expect(html).toContain("Dollars here, whole cents underneath. Totals are always worked out from these, never typed. USPTO fees are due at filing and are shown to the");
    for (const label of ["Package name", "Price with the included classes ($)", "Classes included", "Per class over / under ($)", "Second mark discount (%)", "USPTO fee per class per mark ($)"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Add package");
    expect(html).toContain("Save prices");
    expect(html).toContain("Remove");
    expect(html).not.toContain("Standard prices");
  });

  it("one card per stored package, with dollars in the fields", async () => {
    const html = await render({ packages: [{ ...DEFAULT_PROPOSAL_PRICING }, { ...DEFAULT_PROPOSAL_PRICING, package: "Enhanced", base_cents: 325_000, included_classes: 2 }] });
    expect(html.match(/<fieldset[^>]*aria-label="Package \d"/g)).toHaveLength(2);
    expect(html).toContain('value="4950.00"');
    expect(html).toContain('value="3250.00"');
    expect(html).toContain("Package 1 · default for new proposals");
    expect(html.match(/name="pkg\.\d+\.package"/g)).toHaveLength(2);
  });

  it("Remove is disabled on the only package", async () => {
    const html = await render({});
    const remove = html.match(/<button[^>]*>Remove<\/button>/)?.[0] ?? "";
    expect(remove).toContain("disabled");
    const two = await render({ packages: [{ ...DEFAULT_PROPOSAL_PRICING }, { ...DEFAULT_PROPOSAL_PRICING, package: "Enhanced" }] });
    for (const m of two.matchAll(/<button[^>]*>Remove<\/button>/g)) expect(m[0]).not.toContain("disabled");
  });

  it("a legacy firm sees its one package; a firm with nothing saved sees Concierge", async () => {
    const legacy = await render({ package: "Signature", base_cents: 650_000 });
    expect(names(legacy)).toEqual([["0", "Signature"]]);
    const none = await render(null);
    expect(names(none)).toEqual([["0", "Concierge"]]);
  });

  it("is not shown to a role that can't change the settings", async () => {
    const html = await render({}, "paralegal");
    expect(html).toContain("Restricted to the firm");
    expect(html).not.toContain("Package prices");
  });
});
