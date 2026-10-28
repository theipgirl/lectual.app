import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("@/app/dashboard/settings/proposals/actions", () => ({ saveProposalSettingsAction: vi.fn(), savePackagesAction: vi.fn() }));

const APPROVER = "99999999-9999-4999-8999-999999999999";
const PKG = { package: "Concierge", base: "4950.00", includedClasses: "3", perClass: "825.00", secondMarkPct: "20", govPerClass: "350.00" };

describe("F15: one form, one Save, approvers first", () => {
  it("renders exactly one form and one submit button, approvers before the package prices", async () => {
    const { SettingsForm } = await import("@/components/proposal-editor/SettingsForm");
    const html = renderToStaticMarkup(
      createElement(SettingsForm, {
        members: [{ userId: APPROVER, name: "Rebecca", email: "r@firm.test", role: "owner" }],
        values: { approverUserIds: [APPROVER], notifyEmail: "", officeActionNote: "", includes: [] },
        packages: [PKG],
      }),
    );
    expect(html.match(/<form\b/g)).toHaveLength(1);
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain("Save proposal settings");
    expect(html).not.toContain("Save prices");
    expect(html.indexOf("Who may create client links")).toBeGreaterThan(-1);
    expect(html.indexOf("Who may create client links")).toBeLessThan(html.indexOf("Packages"));
    expect(html.indexOf("Packages")).toBeLessThan(html.indexOf("Links and notifications"));
    expect(html).toContain('name="pkg.0.package"');
    expect(html).toContain('name="approver"');
  });

  it("the page no longer draws a second form for the prices, and has no default pay link field", () => {
    const page = readFileSync("src/app/dashboard/settings/proposals/page.tsx", "utf8");
    expect(page).not.toContain("<PackagePricesForm");
    expect(page).toContain("packages={packages.map");
    expect(readFileSync("src/components/proposal-editor/SettingsForm.tsx", "utf8")).not.toMatch(/Default pay link|defaultPayUrl/);
  });
});

describe("F15: the one save keeps the stored default pay link and the approver rules", () => {
  const existing = {
    org_id: "org-1",
    approver_user_ids: [APPROVER],
    default_pay_url: "https://pay.example/x",
    notify_email: "owner@firm.example",
    pricing: { includes: [{ label: "a", included: "b" }], keep: 1 },
  };
  const form = (entries: Array<[string, string]>) => {
    const f = new FormData();
    for (const [k, v] of entries) f.append(k, v);
    return f;
  };
  const pkgEntries = (name: string, base: string): Array<[string, string]> => [
    ["pkg.0.package", name],
    ["pkg.0.base", base],
    ["pkg.0.includedClasses", "3"],
    ["pkg.0.perClass", "825.00"],
    ["pkg.0.secondMarkPct", "20"],
    ["pkg.0.govPerClass", "350.00"],
  ];

  beforeEach(() => vi.resetModules());

  async function setup(gate: { error: string } | null = null) {
    const saved = vi.fn(async (input: unknown) => input);
    vi.doUnmock("@/app/dashboard/settings/proposals/actions");
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ gateAdminAction: vi.fn(async () => gate) }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => [{ userId: APPROVER, displayName: "R", email: null, role: "owner" }]) }));
    vi.doMock("@/lib/proposals/store", () => ({ getProposalSettings: vi.fn(async () => existing), saveProposalSettings: saved }));
    const { saveProposalSettingsAction } = await vi.importActual<typeof import("../../src/app/dashboard/settings/proposals/actions")>("../../src/app/dashboard/settings/proposals/actions");
    return { saved, run: (e: Array<[string, string]>) => saveProposalSettingsAction({}, form(e)) };
  }
  const arg = (saved: ReturnType<typeof vi.fn>) => saved.mock.calls[0][0] as { approverUserIds: string[]; defaultPayUrl: string | null; pricing: { packages?: Array<{ package: string }>; package?: string; keep?: number } };

  it("saves approvers, the package list and the includes together, and passes default_pay_url through untouched", async () => {
    const { saved, run } = await setup();
    const res = await run([["approver", APPROVER], ["notifyEmail", "a@b.co"], ...pkgEntries("Signature", "6500.00")]);
    expect(res).toEqual({ saved: true });
    const call = arg(saved);
    expect(call.approverUserIds).toEqual([APPROVER]);
    expect(call.defaultPayUrl).toBe("https://pay.example/x");
    expect(call.pricing.packages?.map((p) => p.package)).toEqual(["Signature"]);
    expect(call.pricing.keep).toBe(1);
  });

  it("a post without package fields keeps the stored list as it was", async () => {
    const { saved, run } = await setup();
    await run([["approver", APPROVER]]);
    expect(arg(saved).pricing.packages).toBeUndefined();
    expect(arg(saved).defaultPayUrl).toBe("https://pay.example/x");
  });

  it("refuses a bad package without saving anything, and still refuses a non-admin and a stranger as approver", async () => {
    const bad = await setup();
    expect(await bad.run([["approver", APPROVER], ...pkgEntries("", "6500.00")])).toHaveProperty("error");
    expect(bad.saved).not.toHaveBeenCalled();
    vi.resetModules();
    const denied = await setup({ error: "Only owners, admins and senior admins can change the proposal settings." });
    expect(await denied.run([["approver", APPROVER]])).toEqual({ error: "Only owners, admins and senior admins can change the proposal settings." });
    expect(denied.saved).not.toHaveBeenCalled();
    vi.resetModules();
    const stranger = await setup();
    expect(await stranger.run([["approver", "11111111-1111-4111-8111-111111111111"]])).toHaveProperty("error");
    expect(stranger.saved).not.toHaveBeenCalled();
  });
});
