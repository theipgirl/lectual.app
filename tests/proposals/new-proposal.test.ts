import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { DEFAULT_PROPOSAL_PRICING } from "@/lib/proposals/types";

/**
 * New proposal: `?lead=` / `?matter=` prefill (B5.3), and (Sprint 6) the package
 * dropdown over the firm's named packages. The server re-reads the package by
 * name from settings, keeps only the fields the person changed from it, and
 * records them in `content.package_basis`. The Sprint 3 service-library picker
 * is gone: its tests are replaced by the package tests below.
 */

const MATTER = "22222222-2222-4222-8222-222222222222";
const LEAD = "11111111-1111-4111-8111-111111111111";

type Rows = Record<string, unknown>;

/** A scoped client whose reads answer from `tables[table]` (a row, null, or { error }). */
function fakeClient(tables: Rows) {
  const calls: Array<{ table: string; column: string; value: unknown }> = [];
  return {
    calls,
    client: {
      from(table: string) {
        const q = {
          select: () => q,
          eq(column: string, value: unknown) {
            calls.push({ table, column, value });
            return q;
          },
          async maybeSingle() {
            const v = tables[table];
            if (v && typeof v === "object" && "error" in (v as object)) return { data: null, error: { message: "boom" } };
            return { data: v ?? null, error: null };
          },
        };
        return q;
      },
    },
  };
}

class Redirected extends Error {
  constructor(public to: string) {
    super(to);
  }
}

const PACKAGES = [
  { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
  { package: "Enhanced", base_cents: 325_000, included_classes: 2, per_class_cents: 70_000, second_mark_discount_pct: 15, gov_per_class_cents: 35_000 },
  { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 60_000, second_mark_discount_pct: 10, gov_per_class_cents: 35_000 },
];
const settingsWith = (pricing: Record<string, unknown>) => ({ default_pay_url: "https://pay.example/x", pricing });

describe("new proposal page: ?matter= prefill and the package dropdown", () => {
  beforeEach(() => vi.resetModules());

  async function render(search: { lead?: string; matter?: string }, tables: Rows, extra: { settings?: unknown; settingsFails?: boolean; strip?: unknown } = {}) {
    const { client } = fakeClient(tables);
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined) }));
    vi.doMock("@/lib/auth/current-role", () => ({ currentRole: vi.fn(async () => "intake") }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => client) }));
    vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
    vi.doMock("@/lib/proposals/store", () => ({
      getProposalSettings: vi.fn(async () => {
        if (extra.settingsFails) throw new Error("db down");
        return extra.settings === undefined ? settingsWith({ packages: PACKAGES }) : extra.settings;
      }),
    }));
    vi.doMock("@/lib/proposals/consult-strip-load", () => ({ loadConsultStrip: vi.fn(async () => extra.strip ?? { status: "none" }) }));
    // Sprint 20: the page now also draws the "Who is this for?" picker (two list reads) and reads the lead's reviewed consult.
    vi.doMock("@/lib/pipeline", () => ({ listLeads: vi.fn(async () => []) }));
    vi.doMock("@/lib/matters", () => ({ listMatters: vi.fn(async () => []) }));
    vi.doMock("@/lib/proposals/consult-prefill-load", () => ({ loadConsultForPrefill: vi.fn(async () => ({ status: "ok", details: null, unreadable: false, unreviewed: false })) }));
    vi.doMock("@/app/dashboard/proposals/actions", () => ({ createProposalAction: vi.fn() }));
    const { default: Page } = await import("../../src/app/dashboard/proposals/new/page");
    return renderToStaticMarkup(createElement("div", null, await Page({ searchParams: Promise.resolve(search) })));
  }

  const lead = { id: LEAD, first_name: "Ana", last_name: "Ruiz", business_name: "Zephyr", email: "ana@example.com" };
  const input = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";

  it("?matter=<uuid> with a matter whose lead is Ana Ruiz prefills the client and sets matterId", async () => {
    const html = await render({ matter: MATTER }, { crm_matter: { id: MATTER, lead_id: LEAD, owner_name: "Owner Name" }, crm_lead: lead });
    expect(input(html, "fullName")).toContain('value="Ana Ruiz"');
    expect(input(html, "matterId")).toContain(`value="${MATTER}"`);
    expect(input(html, "leadId")).toContain(`value="${LEAD}"`);
    expect(input(html, "clientEmail")).toContain('value="ana@example.com"');
    expect(html).toContain("Linked to the matter you came from.");
  });

  it("a matter with no lead falls back to its owner name", async () => {
    const html = await render({ matter: MATTER }, { crm_matter: { id: MATTER, lead_id: null, owner_name: "Dana Lopez" } });
    expect(input(html, "fullName")).toContain('value="Dana Lopez"');
    expect(input(html, "matterId")).toContain(`value="${MATTER}"`);
    expect(input(html, "leadId")).toContain('value=""');
  });

  it("?matter= wins when ?lead= is given too", async () => {
    const html = await render({ matter: MATTER, lead: LEAD }, { crm_matter: { id: MATTER, lead_id: null, owner_name: "Dana Lopez" }, crm_lead: lead });
    expect(input(html, "fullName")).toContain('value="Dana Lopez"');
    expect(input(html, "leadId")).toContain('value=""');
  });

  it("a matter from another firm (null through the scoped client) shows the not-found note and a blank form", async () => {
    const html = await render({ matter: MATTER }, { crm_matter: null });
    expect(html).toContain("That matter couldn&#x27;t be found, so the form is blank.");
    expect(input(html, "fullName")).toContain('value=""');
    expect(input(html, "matterId")).toContain('value=""');
  });

  it("a malformed uuid shows the invalid-link note and reads nothing", async () => {
    const html = await render({ matter: "not-a-uuid" }, {});
    expect(html).toContain("That matter link isn&#x27;t valid, so the form is blank.");
    expect(input(html, "matterId")).toContain('value=""');
  });

  it("a matter that couldn't be read says so, rather than 'not found'", async () => {
    const html = await render({ matter: MATTER }, { crm_matter: { error: true } });
    expect(html).toContain("couldn&#x27;t be loaded just now");
    expect(html).not.toContain("couldn&#x27;t be found");
  });

  it("?lead= still prefills as before", async () => {
    const html = await render({ lead: LEAD }, { crm_lead: lead });
    expect(input(html, "fullName")).toContain('value="Ana Ruiz"');
    expect(input(html, "matterId")).toContain('value=""');
  });

  it("shows the consult strip only when a lead is linked", async () => {
    const withLead = await render({ lead: LEAD }, { crm_lead: lead });
    expect(withLead).toContain("Latest consult");
    expect(withLead).toContain("No consult recorded");
    const without = await render({}, {});
    expect(without).not.toContain("Latest consult");
  });

  it("lists each package as its name plus price and classes, and fills the five fields from the first", async () => {
    const html = await render({}, {});
    expect(html).toContain('name="package"');
    expect(html).toContain("Concierge — $4,950 · 3 classes");
    expect(html).toContain("Enhanced — $3,250 · 2 classes");
    expect(html).toContain("Essential — $1,950 · 1 class");
    expect(input(html, "base")).toContain('value="4950.00"');
    expect(input(html, "includedClasses")).toContain('value="3"');
    expect(input(html, "perClass")).toContain('value="825.00"');
    expect(input(html, "secondMarkPct")).toContain('value="20"');
    expect(input(html, "govPerClass")).toContain('value="350.00"');
    // The fields stay editable: not disabled or read-only.
    for (const n of ["base", "includedClasses", "perClass", "secondMarkPct", "govPerClass"]) {
      expect(input(html, n)).not.toMatch(/disabled|readonly/i);
    }
  });

  it("a firm with no saved settings is offered the default package, with the note", async () => {
    const html = await render({}, {}, { settings: null });
    expect(html).toContain("Concierge — $4,950 · 3 classes");
    expect(html).toContain("hasn’t saved its standard prices yet");
  });

  it("a legacy firm (flat fields only) is offered one package", async () => {
    const html = await render({}, {}, { settings: settingsWith({ package: "Signature", base_cents: 650_000, included_classes: 2 }) });
    expect(html).toContain("Signature — $6,500 · 2 classes");
    // Only the package dropdown counts: the 2026-10-30 package-choice groups under More options add their own "Starts selected" selects.
    const packageSelect = /<select[^>]*name="package"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
    expect(packageSelect.match(/<option/g)?.length).toBe(1);
  });

  it("a failed settings read still renders the form, with a note and no dropdown", async () => {
    const html = await render({}, {}, { settingsFails: true });
    expect(html).toContain("Your packages couldn&#x27;t be loaded just now");
    expect(html).toContain('name="fullName"');
    expect(html).not.toContain('name="package"');
    expect(html).not.toContain('name="base"');
    expect(html).not.toContain("hasn’t saved its standard prices yet");
  });
});

describe("fieldsForPackage (what the dropdown's change handler sets)", () => {
  it("fills the five fields from the chosen package, and leaves them alone for an unknown one", async () => {
    const { fieldsForPackage } = await import("../../src/components/proposal-editor/NewProposalForm");
    const { packageOption } = await import("@/lib/proposals/package-list");
    const options = PACKAGES.map(packageOption);
    const current = { base: "1", includedClasses: "1", perClass: "1", secondMarkPct: "1", govPerClass: "1" };
    expect(fieldsForPackage(options, "Enhanced", current)).toEqual({
      base: "3250.00",
      includedClasses: "2",
      perClass: "700.00",
      secondMarkPct: "15",
      govPerClass: "350.00",
    });
    expect(fieldsForPackage(options, "Nope", current)).toBe(current);
  });
});

describe("the server action files stay server actions", () => {
  it.each(["src/app/dashboard/proposals/actions.ts", "src/app/dashboard/proposals/transcript-actions.ts", "src/app/dashboard/settings/proposals/actions.ts"])(
    "%s starts with the use server directive (a client form imports it)",
    async (file) => {
      const { readFileSync } = await import("node:fs");
      expect(readFileSync(file, "utf8").trimStart().startsWith('"use server"')).toBe(true);
    },
  );
});

describe("createProposalAction", () => {
  beforeEach(() => vi.resetModules());

  async function setup(opts: { settings?: unknown; settingsFails?: boolean; gate?: { error: string } | null } = {}) {
    const created = vi.fn<(input: unknown) => Promise<{ id: string }>>(async () => ({ id: "new-1" }));
    // The page tests above mock the action module; this block tests the real one.
    vi.doUnmock("@/app/dashboard/proposals/actions");
    const readSettings = vi.fn(async () => {
      if (opts.settingsFails) throw new Error("db down");
      return opts.settings === undefined ? settingsWith({ packages: PACKAGES }) : opts.settings;
    });
    vi.doMock("next/navigation", () => ({
      redirect: vi.fn((to: string): never => {
        throw new Redirected(to);
      }),
    }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ gateStaffAction: vi.fn(async () => opts.gate ?? null) }));
    vi.doMock("@/lib/proposals/store", () => ({ createProposal: created, getProposalSettings: readSettings }));
    const { createProposalAction } = await import("../../src/app/dashboard/proposals/actions");
    return { created, readSettings, run: (fields: Record<string, string>) => createProposalAction({}, toForm(fields)) };
  }

  const toForm = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const base = { fullName: "Ana Ruiz", firstName: "Ana", expiresOn: "2026-11-10" };
  const enhanced = { base: "3250.00", includedClasses: "2", perClass: "700.00", secondMarkPct: "15", govPerClass: "350.00" };
  type Created = { content: { pricing: Record<string, unknown>; package_basis?: { name: string; edited: string[] } }; leadId: string | null; matterId: string | null; payUrl: string | null };
  const createdWith = (created: ReturnType<typeof vi.fn>) => created.mock.calls[0][0] as Created;

  it("re-reads the package by name from settings and uses its values when nothing was changed", async () => {
    const { created, readSettings, run } = await setup();
    await expect(run({ ...base, package: "Enhanced", ...enhanced })).rejects.toMatchObject({ to: "/dashboard/proposals/new-1/" });
    expect(readSettings).toHaveBeenCalled();
    const { content } = createdWith(created);
    expect(content.pricing).toEqual(PACKAGES[1]);
    expect(content.package_basis).toBeUndefined();
  });

  it("matches the package name ignoring case, and uses the saved spelling", async () => {
    const { created, run } = await setup();
    await expect(run({ ...base, package: "  enhanced " })).rejects.toBeInstanceOf(Redirected);
    expect(createdWith(created).content.pricing.package).toBe("Enhanced");
  });

  it("a field left out of the post takes the package's value", async () => {
    const { created, run } = await setup();
    await expect(run({ ...base, package: "Essential" })).rejects.toBeInstanceOf(Redirected);
    expect(createdWith(created).content.pricing).toEqual(PACKAGES[2]);
  });

  it("keeps a changed field as this proposal's own price and names it in package_basis", async () => {
    const { created, run } = await setup();
    await expect(run({ ...base, package: "Enhanced", ...enhanced, base: "2900", includedClasses: "4" })).rejects.toBeInstanceOf(Redirected);
    const { content } = createdWith(created);
    expect(content.pricing).toEqual({ ...PACKAGES[1], base_cents: 290_000, included_classes: 4 });
    expect(content.package_basis).toEqual({ name: "Enhanced", edited: ["price", "classes included"] });
  });

  it("never lets the browser rename the package or carry a price in another key", async () => {
    const { created, run } = await setup();
    await expect(
      run({ ...base, package: "Enhanced", ...enhanced, base_cents: "1", baseCents: "1", per_class_cents: "1", price: "1", packageName: "Free" }),
    ).rejects.toBeInstanceOf(Redirected);
    const { content } = createdWith(created);
    expect(content.pricing).toEqual(PACKAGES[1]);
    expect(content.package_basis).toBeUndefined();
  });

  it("refuses a package name that is not on the firm's list, and creates nothing", async () => {
    const { created, run } = await setup();
    const result = await run({ ...base, package: "Platinum" });
    expect(result.error).toMatch(/isn't one of your firm's packages/);
    expect(created).not.toHaveBeenCalled();
  });

  it("refuses a changed field that is not a number, naming it", async () => {
    const { created, run } = await setup();
    const result = await run({ ...base, package: "Enhanced", ...enhanced, base: "lots" });
    expect(result.error).toMatch(/^Price:/);
    expect(created).not.toHaveBeenCalled();
  });

  it("with no package chosen (an older form), the default package is used and a posted price is ignored", async () => {
    const { created, run } = await setup();
    await expect(run({ ...base, base: "1", perClass: "1" })).rejects.toBeInstanceOf(Redirected);
    const { content } = createdWith(created);
    expect(content.pricing).toEqual(PACKAGES[0]);
  });

  it("a failed settings read still creates the draft from the standard defaults", async () => {
    const { created, run } = await setup({ settingsFails: true });
    await expect(run({ ...base })).rejects.toMatchObject({ to: "/dashboard/proposals/new-1/" });
    const { content, payUrl } = createdWith(created);
    expect(content.pricing).toEqual(DEFAULT_PROPOSAL_PRICING);
    expect(payUrl).toBeNull();
  });

  it("a failed settings read refuses a package name, because there is nothing to check it against", async () => {
    const { created, run } = await setup({ settingsFails: true });
    const result = await run({ ...base, package: "Enhanced" });
    expect(result.error).toMatch(/Couldn't read your packages/);
    expect(created).not.toHaveBeenCalled();
  });

  it("a legacy firm's flat fields are its one package", async () => {
    const { created, run } = await setup({ settings: settingsWith({ package: "Signature", base_cents: 650_000, included_classes: 2, per_class_cents: 70_000 }) });
    await expect(run({ ...base, package: "Signature" })).rejects.toBeInstanceOf(Redirected);
    expect(createdWith(created).content.pricing).toMatchObject({ package: "Signature", base_cents: 650_000, included_classes: 2, per_class_cents: 70_000 });
  });

  it("carries matter_id (and lead_id) when posted, and refuses a malformed matter id", async () => {
    const { created, run } = await setup();
    await expect(run({ ...base, leadId: LEAD, matterId: MATTER })).rejects.toBeInstanceOf(Redirected);
    expect(createdWith(created)).toMatchObject({ leadId: LEAD, matterId: MATTER });
    vi.resetModules();
    const bad = await setup();
    expect((await bad.run({ ...base, matterId: "x" })).error).toMatch(/matter isn't valid/);
    expect(bad.created).not.toHaveBeenCalled();
  });

  it("passes the staff gate's refusal through before reading anything", async () => {
    const { created, readSettings, run } = await setup({ gate: { error: "Your role can view proposals but not change them." } });
    expect(await run({ ...base, package: "Enhanced" })).toEqual({ error: "Your role can view proposals but not change them." });
    expect(readSettings).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
  });
});
