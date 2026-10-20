import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { DEFAULT_PROPOSAL_PRICING } from "@/lib/proposals/types";

/**
 * New proposal (B5.3): the service-library package picker (the server re-reads
 * the item, so a price the browser sends is ignored) and `?matter=` prefill.
 */

const MATTER = "22222222-2222-4222-8222-222222222222";
const LEAD = "11111111-1111-4111-8111-111111111111";
const ITEM = "33333333-3333-4333-8333-333333333333";

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

describe("new proposal page: ?matter= prefill and the package picker", () => {
  beforeEach(() => vi.resetModules());

  async function render(search: { lead?: string; matter?: string }, tables: Rows, extra: { packages?: unknown; strip?: unknown } = {}) {
    const { client } = fakeClient(tables);
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined) }));
    vi.doMock("@/lib/auth/current-role", () => ({ currentRole: vi.fn(async () => "intake") }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => client) }));
    vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
    vi.doMock("@/lib/proposals/store", () => ({ getProposalSettings: vi.fn(async () => ({ default_pay_url: "https://pay.example/x" })) }));
    vi.doMock("@/lib/proposals/packages", () => ({
      loadPackageChoices: vi.fn(async () => extra.packages ?? { status: "ok", choices: [{ id: ITEM, label: "Concierge", description: null, amountCents: 495_000 }] }),
    }));
    vi.doMock("@/lib/proposals/consult-strip-load", () => ({ loadConsultStrip: vi.fn(async () => extra.strip ?? { status: "none" }) }));
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

  it("lists the library's packages with their price, and posts only an id", async () => {
    const html = await render({}, {});
    expect(html).toContain('name="serviceItemId"');
    expect(html).toContain(`value="${ITEM}"`);
    expect(html).toContain("Concierge · $4,950");
    expect(html).not.toContain('name="base_cents"');
    expect(html).not.toContain('name="base"');
  });

  it("a failed library read still renders the form, with a note", async () => {
    const html = await render({}, {}, { packages: { status: "unavailable" } });
    expect(html).toContain("The service library couldn&#x27;t be loaded, so the standard prices will be used.");
    expect(html).toContain('name="fullName"');
    expect(html).not.toContain('name="serviceItemId"');
  });

  it("an empty library offers no picker and no failure note", async () => {
    const html = await render({}, {}, { packages: { status: "ok", choices: [] } });
    expect(html).not.toContain('name="serviceItemId"');
    expect(html).not.toContain("service library couldn");
  });
});

describe("createProposalAction", () => {
  beforeEach(() => vi.resetModules());

  async function setup(tables: Rows = {}, gate: { error: string } | null = null) {
    const created = vi.fn<(input: unknown) => Promise<{ id: string }>>(async () => ({ id: "new-1" }));
    // The page tests above mock the action module; this block tests the real one.
    vi.doUnmock("@/app/dashboard/proposals/actions");
    vi.doUnmock("@/lib/proposals/packages");
    const { client, calls } = fakeClient(tables);
    vi.doMock("next/navigation", () => ({
      redirect: vi.fn((to: string): never => {
        throw new Redirected(to);
      }),
    }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => client) }));
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ gateStaffAction: vi.fn(async () => gate) }));
    vi.doMock("@/lib/proposals/store", () => ({
      createProposal: created,
      getProposalSettings: vi.fn(async () => ({ pricing: { per_class_cents: 70_000, included_classes: 2 }, default_pay_url: null })),
    }));
    const { createProposalAction } = await import("../../src/app/dashboard/proposals/actions");
    return { created, calls, run: (fields: Record<string, string>) => createProposalAction({}, toForm(fields)) };
  }

  const toForm = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const base = { fullName: "Ana Ruiz", firstName: "Ana", expiresOn: "2026-11-10" };
  const libraryItem = { id: ITEM, label: "Signature Package", kind: "legal_fee", charge_at: "signing", unit_amount_cents: 650_000, active: true };
  const createdWith = (created: ReturnType<typeof vi.fn>) =>
    created.mock.calls[0][0] as { content: { pricing: Record<string, unknown> }; leadId: string | null; matterId: string | null };

  it("re-reads the library item and sets only the package name and base price from it", async () => {
    const { created, calls, run } = await setup({ crm_service_item: libraryItem });
    await expect(run({ ...base, serviceItemId: ITEM })).rejects.toMatchObject({ to: "/dashboard/proposals/new-1/" });
    expect(calls).toContainEqual({ table: "crm_service_item", column: "id", value: ITEM });
    const { content } = createdWith(created);
    expect(content.pricing).toMatchObject({
      package: "Signature Package",
      base_cents: 650_000,
      // everything else is the firm's standard
      per_class_cents: 70_000,
      included_classes: 2,
      second_mark_discount_pct: DEFAULT_PROPOSAL_PRICING.second_mark_discount_pct,
      gov_per_class_cents: DEFAULT_PROPOSAL_PRICING.gov_per_class_cents,
    });
  });

  it("ignores a price, package or per-class field posted by the browser", async () => {
    const { created, run } = await setup({ crm_service_item: libraryItem });
    await expect(
      run({ ...base, serviceItemId: ITEM, base_cents: "1", baseCents: "1", per_class_cents: "1", perClass: "1", package: "Free", base: "0.01", price: "1" }),
    ).rejects.toBeInstanceOf(Redirected);
    const { content } = createdWith(created);
    expect(content.pricing.base_cents).toBe(650_000);
    expect(content.pricing.package).toBe("Signature Package");
    expect(content.pricing.per_class_cents).toBe(70_000);
  });

  it("with no package chosen, a posted price is still ignored and the standard prices are used", async () => {
    const { created, run } = await setup();
    await expect(run({ ...base, base_cents: "1", package: "Free" })).rejects.toBeInstanceOf(Redirected);
    const { content } = createdWith(created);
    expect(content.pricing.base_cents).toBe(DEFAULT_PROPOSAL_PRICING.base_cents);
    expect(content.pricing.package).toBe("Concierge");
    expect(content.pricing.per_class_cents).toBe(70_000);
  });

  it.each([
    ["a government fee", { kind: "government_fee", charge_at: "filing" }],
    ["a legal fee charged at filing", { charge_at: "filing" }],
    ["an inactive item", { active: false }],
    ["an expense", { kind: "expense" }],
    ["a negative amount", { unit_amount_cents: -5 }],
  ])("refuses %s with a sentence and creates nothing", async (_name, over) => {
    const { created, run } = await setup({ crm_service_item: { ...libraryItem, ...over } });
    const result = await run({ ...base, serviceItemId: ITEM });
    expect(result.error).toMatch(/isn't available/);
    expect(created).not.toHaveBeenCalled();
  });

  it("refuses an id that resolves to nothing (another firm's item), a bad id, and a failed read", async () => {
    const a = await setup({ crm_service_item: null });
    expect((await a.run({ ...base, serviceItemId: ITEM })).error).toMatch(/isn't available/);
    expect(a.created).not.toHaveBeenCalled();
    vi.resetModules();
    const b = await setup();
    expect((await b.run({ ...base, serviceItemId: "nope" })).error).toMatch(/isn't valid/);
    expect(b.created).not.toHaveBeenCalled();
    vi.resetModules();
    const c = await setup({ crm_service_item: { error: true } });
    const failed = await c.run({ ...base, serviceItemId: ITEM });
    expect(failed.error).toMatch(/Couldn't read the service library/);
    expect(c.created).not.toHaveBeenCalled();
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
    const { created, calls, run } = await setup({}, { error: "Your role can view proposals but not change them." });
    expect(await run({ ...base, serviceItemId: ITEM })).toEqual({ error: "Your role can view proposals but not change them." });
    expect(calls).toEqual([]);
    expect(created).not.toHaveBeenCalled();
  });
});
