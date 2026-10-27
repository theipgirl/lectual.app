import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ConsultMark, StoredConsultDetails } from "@/lib/consult/vocab";
import type { ReviewedConsultRead } from "@/lib/consult/store";

/**
 * New proposal, Sprint 20: the "Who is this for?" picker, and what choosing a lead or matter fills in.
 * The page is rendered with a fake scoped client, mocked list reads and a mocked consult read, the same
 * way tests/proposals/new-proposal.test.ts does. Nothing here touches a database.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LEAD = uuid(1);
const MATTER = uuid(2);

type LeadRow = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; email: string | null; mark_text?: string | null };
type MatterRow = { id: string; type: string; title: string | null; mark_text: string | null; matter_number: string; owner_name: string | null; lead_id?: string | null };

const lead = (n: number, over: Partial<LeadRow> = {}): LeadRow => ({
  id: uuid(100 + n),
  first_name: `Pat${n}`,
  last_name: `Lead${n}`,
  business_name: null,
  email: `pat${n}@example.com`,
  ...over,
});
const matter = (n: number, over: Partial<MatterRow> = {}): MatterRow => ({
  id: uuid(1000 + n),
  type: "TM",
  title: null,
  mark_text: `MARK${n}`,
  matter_number: `TM-2026-${String(n).padStart(4, "0")}`,
  owner_name: `Client ${n}`,
  ...over,
});

const ANA: LeadRow = { id: LEAD, first_name: "Ana", last_name: "Ruiz", business_name: "Zephyr Co", email: "ana@example.com", mark_text: "Zephyr" };

const PACKAGES = [
  { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
  { package: "Enhanced", base_cents: 325_000, included_classes: 2, per_class_cents: 70_000, second_mark_discount_pct: 15, gov_per_class_cents: 35_000 },
  { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 60_000, second_mark_discount_pct: 10, gov_per_class_cents: 35_000 },
];

const mark = (id: string, text: string, type: ConsultMark["mark_type"], classes: Array<[number | null, string]> = []): ConsultMark => ({
  id,
  mark: text,
  mark_type: type,
  classes: classes.map(([cls, goods]) => ({ class: cls, goods })),
  filing_basis: "unknown",
  extracted_basis: null,
  basis_evidence: null,
  first_use_date: null,
});
const REVIEW = { reviewed_at: "2026-10-21T16:00:00Z", reviewed_by: "u1", reviewed_by_name: "Rebecca Beliard", reviewed_by_role: "senior_admin" };
const details = (marks: ConsultMark[], over: Partial<StoredConsultDetails> = {}): StoredConsultDetails => ({
  version: 1,
  rev: 1,
  marks,
  recommended_package: null,
  discount_discussed: null,
  extracted: null,
  review: REVIEW,
  ...over,
});
const reviewed = (d: StoredConsultDetails): ReviewedConsultRead => ({ status: "ok", details: d, unreadable: false, unreviewed: false });
const ZEPHYR = mark("m1", "Zephyr", "word", [
  [25, "Clothing, namely t-shirts"],
  [35, "Online retail store services"],
]);

type Tables = Record<string, unknown>;
type Opts = {
  search?: Record<string, string | string[]>;
  tables?: Tables;
  leads?: LeadRow[] | "error";
  matters?: MatterRow[] | "error";
  consult?: ReviewedConsultRead;
  settings?: unknown;
  settingsFails?: boolean;
  role?: string | null;
  noModule?: boolean;
};

function fakeClient(tables: Tables) {
  return {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        async maybeSingle() {
          const v = tables[table];
          if (v && typeof v === "object" && "error" in (v as object)) return { data: null, error: { message: "boom" } };
          return { data: v ?? null, error: null };
        },
      };
      return q;
    },
  };
}

const h = vi.hoisted(() => ({
  listLeads: vi.fn(),
  listMatters: vi.fn(),
  consultLoad: vi.fn(),
  stripLoad: vi.fn(),
  scoped: vi.fn(),
}));

async function render(opts: Opts = {}) {
  vi.resetModules();
  h.listLeads.mockReset();
  h.listMatters.mockReset();
  h.consultLoad.mockReset();
  h.stripLoad.mockReset();
  h.scoped.mockReset();
  h.listLeads.mockImplementation(async () => {
    if (opts.leads === "error") throw new Error("leads down");
    return opts.leads ?? [];
  });
  h.listMatters.mockImplementation(async () => {
    if (opts.matters === "error") throw new Error("matters down");
    return opts.matters ?? [];
  });
  h.consultLoad.mockImplementation(async () => opts.consult ?? { status: "ok", details: null, unreadable: false, unreviewed: false });
  h.stripLoad.mockImplementation(async () => ({ status: "none" }));
  h.scoped.mockImplementation(async () => fakeClient(opts.tables ?? {}));

  vi.doMock("@/app/dashboard/proposals/gate", () => ({
    requireProposalsModule: vi.fn(async () => {
      if (opts.noModule) throw new Error("NEXT_NOT_FOUND");
    }),
  }));
  vi.doMock("@/lib/auth/current-role", () => ({ currentRole: vi.fn(async () => (opts.role === undefined ? "intake" : opts.role)) }));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: h.scoped }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/proposals/store", () => ({
    getProposalSettings: vi.fn(async () => {
      if (opts.settingsFails) throw new Error("db down");
      return opts.settings === undefined ? { default_pay_url: "https://pay.example/x", pricing: { packages: PACKAGES } } : opts.settings;
    }),
  }));
  vi.doMock("@/lib/proposals/consult-strip-load", () => ({ loadConsultStrip: h.stripLoad }));
  vi.doMock("@/lib/proposals/consult-prefill-load", () => ({ loadConsultForPrefill: h.consultLoad }));
  vi.doMock("@/lib/pipeline", () => ({ listLeads: h.listLeads }));
  vi.doMock("@/lib/matters", () => ({ listMatters: h.listMatters }));
  vi.doMock("@/app/dashboard/proposals/actions", () => ({ createProposalAction: vi.fn() }));
  const { default: Page } = await import("../../src/app/dashboard/proposals/new/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ searchParams: Promise.resolve(opts.search ?? {}) })));
}

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const input = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
const picker = (html: string) => html.slice(html.indexOf('aria-labelledby="who-title"'), html.indexOf("</section>", html.indexOf('aria-labelledby="who-title"')));

beforeEach(() => vi.resetModules());

describe("the picker, with nothing chosen", () => {
  it("shows 'Who is this for?', Leads selected, a search box, Start blank and the recent leads as links", async () => {
    const html = await render({ leads: [lead(1), lead(2)], matters: [matter(1)] });
    const p = picker(html);
    expect(p).toContain("Who is this for?");
    expect(p).toMatch(/<a href="\/dashboard\/proposals\/new\/\?kind=lead"[^>]*aria-current="page"[^>]*>Leads</);
    expect(p).toMatch(/<a href="\/dashboard\/proposals\/new\/\?kind=matter"(?![^>]*aria-current)[^>]*>Matters</);
    expect(p).toMatch(/<input[^>]*type="search"[^>]*aria-label="Search leads"/);
    expect(p).toContain('<a href="/dashboard/proposals/new/?blank=1" class="pe-who-blank">Start blank</a>');
    expect(hrefs(p)).toContain(`/dashboard/proposals/new/?lead=${uuid(101)}`);
    expect(hrefs(p)).toContain(`/dashboard/proposals/new/?lead=${uuid(102)}`);
    expect(text(p)).toContain("Showing 2 of 2.");
  });

  it("the blank form is still drawn below the picker", async () => {
    const html = await render({ leads: [lead(1)] });
    expect(input(html, "fullName")).toContain('value=""');
    expect(html).toContain('name="package"');
    expect(html).not.toContain("Filled from");
  });

  it("?kind=matter shows the matters, and only the matters", async () => {
    const html = await render({ search: { kind: "matter" }, leads: [lead(1)], matters: [matter(1), matter(2)] });
    const p = picker(html);
    expect(p).toMatch(/\?kind=matter"[^>]*aria-current="page"/);
    expect(p).toContain("MARK1");
    expect(p).not.toContain("Pat1");
    expect(hrefs(p)).toContain(`/dashboard/proposals/new/?matter=${uuid(1001)}`);
    expect(p).toMatch(/<input[^>]*aria-label="Search matters"/);
  });

  it("an unknown kind is leads", async () => {
    const html = await render({ search: { kind: "everything" }, leads: [lead(1)], matters: [matter(1)] });
    expect(picker(html)).toContain("Pat1");
    expect(picker(html)).not.toContain("MARK1");
  });

  it("more than 8 matches draw exactly 8, in the order read, and say 'Showing 8 of 12.'", async () => {
    const html = await render({ leads: Array.from({ length: 12 }, (_, i) => lead(i + 1)) });
    const p = picker(html);
    expect(p.match(/<li>/g)).toHaveLength(8);
    expect(p.indexOf("Pat1 ")).toBeLessThan(p.indexOf("Pat2 "));
    expect(p).not.toContain("Pat9 ");
    expect(text(p)).toContain("Showing 8 of 12.");
  });

  it("a search narrows the list, is shown again in the box, and rides on the choose links", async () => {
    const html = await render({ search: { q: "  pat2  " }, leads: [lead(1), lead(2), lead(20)] });
    const p = picker(html);
    expect(p).toMatch(/<input[^>]*name="q"[^>]*value="pat2"/);
    expect(text(p)).toContain("Showing 2 of 2.");
    expect(hrefs(p)).toContain(`/dashboard/proposals/new/?lead=${uuid(102)}&q=pat2`);
    expect(p).not.toContain("Pat1 ");
  });

  it("the search term is capped at 80 characters", async () => {
    const html = await render({ search: { q: "z".repeat(200) }, leads: [lead(1)] });
    expect(picker(html)).toContain(`value="${"z".repeat(80)}"`);
    expect(picker(html)).not.toContain("z".repeat(81));
  });

  it("'No matches' appears only when the read worked and nothing matched", async () => {
    const html = await render({ search: { q: "nobody" }, leads: [lead(1)] });
    expect(text(picker(html))).toContain('No matches for "nobody".');
    const none = await render({ leads: [] });
    expect(text(picker(none))).toContain("No leads on file yet.");
    const noneMatters = await render({ search: { kind: "matter" }, matters: [] });
    expect(text(picker(noneMatters))).toContain("No matters on file yet.");
  });

  it("no label, name or email is in any href; ids are encoded; labels are escaped", async () => {
    const html = await render({ leads: [lead(1, { id: 'a&b"c', first_name: "<b>Ana</b>", last_name: "Ruiz", business_name: "Zephyr", email: "ana@example.com" })] });
    const p = picker(html);
    expect(p).toContain('href="/dashboard/proposals/new/?lead=a%26b%22c"');
    expect(p).toContain('<span class="pe-who-name">&lt;b&gt;Ana&lt;/b&gt; Ruiz</span>');
    expect(p).toContain('<span class="pe-who-sub">Zephyr · ana@example.com</span>');
    expect(p).not.toContain("<b>Ana");
    const choose = hrefs(p).filter((x) => x.includes("lead=a"));
    for (const href of choose) for (const word of ["Ana", "Ruiz", "Zephyr", "example"]) expect(href).not.toContain(word);
  });

  it("the search is a plain GET form to the same page, carrying the kind", async () => {
    const html = await render({ search: { kind: "matter" } });
    expect(html).toMatch(/<form[^>]*role="search"[^>]*action="\/dashboard\/proposals\/new\/"[^>]*method="get"/);
    expect(input(html, "kind")).toContain('value="matter"');
  });
});

describe("three states: a failed read is never 'No matches'", () => {
  it("a failed leads read says so, as an alert; the matters list still works", async () => {
    const html = await render({ leads: "error", matters: [matter(1)] });
    const p = picker(html);
    expect(p).toMatch(/<p[^>]*role="alert"[^>]*>We couldn(?:'|&#x27;)t load your leads\.<\/p>/);
    expect(p).not.toContain("No matches");
    expect(p).not.toContain("No leads on file yet");
    const matters = await render({ search: { kind: "matter" }, leads: "error", matters: [matter(1)] });
    expect(picker(matters)).toContain("MARK1");
  });

  it("a failed matters read says so; the leads list still works", async () => {
    const matters = await render({ search: { kind: "matter" }, leads: [lead(1)], matters: "error" });
    expect(text(picker(matters))).toContain("We couldn't load your matters.");
    expect(picker(matters)).not.toContain("No matches");
    const leads = await render({ leads: [lead(1)], matters: "error" });
    expect(picker(leads)).toContain("Pat1");
  });

  it("both failed names both, and still offers Start blank and the blank form", async () => {
    const html = await render({ leads: "error", matters: "error" });
    expect(text(picker(html))).toContain("We couldn't load your leads.");
    expect(text(picker(html))).toContain("We couldn't load your matters.");
    expect(picker(html)).toContain("Start blank");
    expect(input(html, "fullName")).toContain('value=""');
  });
});

describe("Start blank", () => {
  it("hides the picker's list and keeps today's blank form", async () => {
    const html = await render({ search: { blank: "1" }, leads: [lead(1)] });
    expect(html).not.toContain("who-title");
    expect(html).not.toContain("Pat1");
    expect(text(html)).toContain("Starting blank");
    expect(hrefs(html)).toContain("/dashboard/proposals/new/");
    expect(input(html, "fullName")).toContain('value=""');
    expect(h.listLeads).not.toHaveBeenCalled();
  });
});

describe("access is unchanged", () => {
  it("no Proposals module: the gate's not-found comes before anything is read", async () => {
    await expect(render({ noModule: true, leads: [lead(1)] })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.listLeads).not.toHaveBeenCalled();
    expect(h.listMatters).not.toHaveBeenCalled();
    expect(h.scoped).not.toHaveBeenCalled();
  });

  it.each(["viewer", "social_media", null])("a role that can't write proposals (%s) sees the role message, no picker, and no list is read", async (role) => {
    const html = await render({ role, leads: [lead(1)] });
    expect(text(html)).toContain("Your role can't start proposals");
    expect(html).not.toContain("Who is this for?");
    expect(html).not.toContain('name="fullName"');
    expect(h.listLeads).not.toHaveBeenCalled();
    expect(h.listMatters).not.toHaveBeenCalled();
    expect(h.consultLoad).not.toHaveBeenCalled();
  });
});

describe("choosing a record collapses the picker", () => {
  it("?lead=<id> shows 'For: <label> . Change', not the list", async () => {
    const html = await render({ search: { lead: LEAD }, tables: { crm_lead: ANA }, leads: [lead(1)] });
    expect(text(html)).toContain("For:</span> <strong>Ana Ruiz · Zephyr Co</strong> · <a");
    expect(html).not.toContain("who-title");
    expect(html).not.toContain("Pat1");
    expect(hrefs(html)).toContain("/dashboard/proposals/new/?kind=lead");
    expect(h.listLeads).not.toHaveBeenCalled();
  });

  it("?matter=<id> is labelled by the matter's mark, and Change returns to the matters picker with the typed search", async () => {
    const html = await render({
      search: { matter: MATTER, q: "zeph" },
      tables: { crm_matter: { id: MATTER, lead_id: null, owner_name: "Dana Lopez", mark_text: "Zephyr", title: "Zephyr filing", matter_number: "TM-2026-0001" } },
    });
    expect(text(html)).toContain("<strong>Zephyr</strong>");
    expect(hrefs(html)).toContain("/dashboard/proposals/new/?kind=matter&q=zeph");
  });

  it("a matter with no mark is labelled by its title, else its number", async () => {
    const byTitle = await render({ search: { matter: MATTER }, tables: { crm_matter: { id: MATTER, lead_id: null, owner_name: null, mark_text: null, title: "Acme refresh", matter_number: "TM-1" } } });
    expect(byTitle).toContain("<strong>Acme refresh</strong>");
    const byNumber = await render({ search: { matter: MATTER }, tables: { crm_matter: { id: MATTER, lead_id: null, owner_name: null, mark_text: null, title: null, matter_number: "TM-2026-0009" } } });
    expect(byNumber).toContain("<strong>TM-2026-0009</strong>");
  });

  it("?matter= wins when ?lead= is given too", async () => {
    const html = await render({
      search: { matter: MATTER, lead: LEAD },
      tables: { crm_matter: { id: MATTER, lead_id: null, owner_name: "Dana Lopez", mark_text: "Birch", title: null, matter_number: "TM-1" }, crm_lead: ANA },
    });
    expect(html).toContain("<strong>Birch</strong>");
    expect(input(html, "fullName")).toContain('value="Dana Lopez"');
    expect(input(html, "leadId")).toContain('value=""');
  });

  it.each([
    ["an invalid id", { lead: "not-a-uuid" }, {}, "That lead link isn't valid"],
    ["an id that isn't there (or is another firm's)", { lead: LEAD }, { crm_lead: null }, "That lead couldn't be found"],
    ["a read that fails", { lead: LEAD }, { crm_lead: { error: true } }, "That lead couldn't be loaded just now"],
    ["an invalid matter id", { matter: "nope" }, {}, "That matter link isn't valid"],
    ["a matter that isn't there", { matter: MATTER }, { crm_matter: null }, "That matter couldn't be found"],
    ["a matter read that fails", { matter: MATTER }, { crm_matter: { error: true } }, "That matter couldn't be loaded just now"],
  ])("%s shows the picker (not the collapsed bar), the note and the blank form", async (_name, search, tables, note) => {
    const html = await render({ search, tables, leads: [lead(1)] });
    expect(html).toContain("who-title");
    expect(html).not.toContain("pe-who-bar");
    expect(text(html)).toContain(note);
    expect(input(html, "fullName")).toContain('value=""');
    expect(html).not.toContain("Filled from");
    // The consult is never read for a record that wasn't found.
    expect(h.consultLoad).not.toHaveBeenCalled();
  });
});

describe("pre-fill from a lead", () => {
  it("fills name, first name, company, email and the first brand name from the lead's mark; all editable", async () => {
    const html = await render({ search: { lead: LEAD }, tables: { crm_lead: ANA } });
    expect(input(html, "fullName")).toContain('value="Ana Ruiz"');
    expect(input(html, "firstName")).toContain('value="Ana"');
    expect(input(html, "company")).toContain('value="Zephyr Co"');
    expect(input(html, "clientEmail")).toContain('value="ana@example.com"');
    expect(input(html, "brandName")).toContain('value="Zephyr"');
    expect(input(html, "leadId")).toContain(`value="${LEAD}"`);
    for (const n of ["fullName", "firstName", "company", "clientEmail", "brandName"]) expect(input(html, n)).not.toMatch(/disabled|readonly/i);
  });

  it("with no mark the brand name is the business name; with neither it is blank", async () => {
    const byBusiness = await render({ search: { lead: LEAD }, tables: { crm_lead: { ...ANA, mark_text: null } } });
    expect(input(byBusiness, "brandName")).toContain('value="Zephyr Co"');
    const none = await render({ search: { lead: LEAD }, tables: { crm_lead: { ...ANA, mark_text: null, business_name: null } } });
    expect(input(none, "brandName")).toContain('value=""');
  });

  it("says 'Filled from: lead <label>.' and nothing about a consult or package that wasn't used", async () => {
    const html = await render({ search: { lead: LEAD }, tables: { crm_lead: ANA } });
    expect(text(html)).toContain("Filled from: lead Ana Ruiz · Zephyr Co.");
    expect(html).not.toContain("consult details reviewed");
    expect(html).not.toContain("; package");
  });
});

describe("pre-fill from a matter", () => {
  const row = { id: MATTER, lead_id: LEAD, owner_name: "Owner Name", mark_text: "Birch", title: "Birch filing", matter_number: "TM-2026-0003" };

  it("links the matter and takes its lead's details plus the matter's own mark", async () => {
    const html = await render({ search: { matter: MATTER }, tables: { crm_matter: row, crm_lead: ANA } });
    expect(input(html, "matterId")).toContain(`value="${MATTER}"`);
    expect(input(html, "leadId")).toContain(`value="${LEAD}"`);
    expect(input(html, "fullName")).toContain('value="Ana Ruiz"');
    expect(input(html, "clientEmail")).toContain('value="ana@example.com"');
    expect(input(html, "brandName")).toContain('value="Birch"');
    expect(text(html)).toContain("Filled from: matter Birch; lead Ana Ruiz · Zephyr Co.");
  });

  it("a matter with no mark uses its title; with neither, its lead's brand", async () => {
    const byTitle = await render({ search: { matter: MATTER }, tables: { crm_matter: { ...row, mark_text: null }, crm_lead: ANA } });
    expect(input(byTitle, "brandName")).toContain('value="Birch filing"');
    const byLead = await render({ search: { matter: MATTER }, tables: { crm_matter: { ...row, mark_text: null, title: null }, crm_lead: ANA } });
    expect(input(byLead, "brandName")).toContain('value="Zephyr"');
  });

  it("a matter with no lead fills the owner name and the brand name, and says there are no consult details", async () => {
    const html = await render({ search: { matter: MATTER }, tables: { crm_matter: { ...row, lead_id: null } } });
    expect(input(html, "fullName")).toContain('value="Owner Name"');
    expect(input(html, "brandName")).toContain('value="Birch"');
    expect(input(html, "leadId")).toContain('value=""');
    expect(text(html)).toContain("This matter has no linked lead, so there are no consult details to fill from.");
    expect(h.consultLoad).not.toHaveBeenCalled();
    expect(text(html)).toContain("Filled from: matter Birch.");
  });

  it("another firm's matter (the scoped client returns no row) is not found, and no consult is read", async () => {
    const html = await render({ search: { matter: MATTER }, tables: { crm_matter: null } });
    expect(text(html)).toContain("That matter couldn't be found, so the form is blank.");
    expect(h.consultLoad).not.toHaveBeenCalled();
  });
});

describe("reviewed consult details", () => {
  const withConsult = (d: StoredConsultDetails, extra: Partial<Opts> = {}) =>
    render({ search: { lead: LEAD }, tables: { crm_lead: ANA }, consult: reviewed(d), ...extra });

  it("shows the ticked box and what it will add: each mark, its kinds and its classes as labels", async () => {
    const html = await withConsult(details([ZEPHYR, mark("m2", "Swirl", "design")]));
    expect(html).toMatch(/<input type="checkbox" name="useConsult" checked=""/);
    expect(text(html)).toContain("Use the marks and classes from the reviewed consult");
    expect(text(html)).toContain("Zephyr</strong><span class=\"lx-note\"> · Word mark");
    expect(html).toContain("Clothing, namely t-shirts");
    expect(html).toContain("Online retail store services");
    expect(text(html)).toContain("Swirl");
    expect(text(html)).toContain("Logo mark");
    // The consult read goes through the lead the page resolved, and only that.
    expect(h.consultLoad).toHaveBeenCalledWith(LEAD);
  });

  it("names the review in the 'Filled from' line, with the date in the firm's zone", async () => {
    const html = await withConsult(details([ZEPHYR]));
    expect(text(html)).toContain("Filled from: lead Ana Ruiz · Zephyr Co; consult details reviewed by Rebecca Beliard on Oct 21, 2026.");
  });

  it("a package on the current list selects the dropdown, and the five fields equal that package's", async () => {
    const html = await withConsult(details([ZEPHYR], { recommended_package: "  enhanced " }));
    expect(html).toMatch(/<option value="Enhanced" selected="">/);
    expect(input(html, "base")).toContain('value="3250.00"');
    expect(input(html, "includedClasses")).toContain('value="2"');
    expect(input(html, "perClass")).toContain('value="700.00"');
    expect(input(html, "secondMarkPct")).toContain('value="15"');
    expect(input(html, "govPerClass")).toContain('value="350.00"');
    expect(text(html)).toContain("; package Enhanced.");
    expect(html).not.toContain("isn't on your list");
    expect(html).not.toContain("isn&#x27;t on your list");
  });

  it("a package that isn't on the list leaves the first package and says so, with the name escaped", async () => {
    const html = await withConsult(details([ZEPHYR], { recommended_package: "Plat<i>num" }));
    expect(html).toMatch(/<option value="Concierge" selected="">/);
    expect(input(html, "base")).toContain('value="4950.00"');
    expect(text(html)).toContain("Package from the consult (Plat&lt;i&gt;num) isn't on your list. Choose one.");
    expect(html).not.toContain("Plat<i>num");
    expect(html).not.toContain("; package");
  });

  it("no package named: the default, and no package note", async () => {
    const html = await withConsult(details([ZEPHYR]));
    expect(html).toMatch(/<option value="Concierge" selected="">/);
    expect(html).not.toContain("Package from the consult");
  });

  it("if the firm's settings couldn't be read there is no dropdown and no package note", async () => {
    const html = await withConsult(details([ZEPHYR], { recommended_package: "Enhanced" }), { settingsFails: true });
    expect(html).not.toContain('name="package"');
    expect(html).not.toContain("Package from the consult");
    expect(html).toContain("Your packages couldn&#x27;t be loaded just now");
  });

  it("says how many classes the per-brand limit left off", async () => {
    const many = mark("m1", "Zephyr", "word", [[1, "A goods"], [2, "B goods"], [3, "C goods"], [4, "D goods"], [5, "E goods"]]);
    const html = await withConsult(details([many]));
    expect(text(html)).toContain("2 more classes weren't added (3 per brand name).");
    expect(html).not.toContain("D goods");
  });

  it("no price is read from any record: the matter's package, the lead's and consult's discount change nothing", async () => {
    const html = await render({
      search: { matter: MATTER },
      tables: {
        crm_matter: { id: MATTER, lead_id: LEAD, owner_name: "x", mark_text: "Birch", title: null, matter_number: "TM-1", package_name: "Essential", price_cents: 1 },
        crm_lead: { ...ANA, value_band: "high", quote_cents: 5 },
      },
      consult: reviewed(details([ZEPHYR], { discount_discussed: "20% off for a second mark" })),
    });
    expect(input(html, "base")).toContain('value="4950.00"');
    expect(input(html, "perClass")).toContain('value="825.00"');
    expect(html).toMatch(/<option value="Concierge" selected="">/);
    expect(html).not.toContain("20% off");
  });

  it("every pre-filled input stays editable", async () => {
    const html = await withConsult(details([ZEPHYR], { recommended_package: "Enhanced" }));
    for (const n of ["fullName", "firstName", "company", "clientEmail", "brandName", "base", "includedClasses", "perClass", "secondMarkPct", "govPerClass"]) {
      expect(input(html, n)).not.toMatch(/disabled|readonly/i);
    }
  });
});

describe("a consult that fills nothing says why, and the rest is still filled", () => {
  const go = (consult: ReviewedConsultRead) => render({ search: { lead: LEAD }, tables: { crm_lead: ANA }, consult });
  const stillFilled = (html: string) => {
    expect(input(html, "fullName")).toContain('value="Ana Ruiz"');
    expect(input(html, "company")).toContain('value="Zephyr Co"');
    expect(input(html, "clientEmail")).toContain('value="ana@example.com"');
    expect(input(html, "brandName")).toContain('value="Zephyr"');
  };
  const nothingFromConsult = (html: string) => {
    expect(html).not.toContain("useConsult");
    expect(html).not.toContain("Use the marks and classes");
    expect(html).not.toContain("consult details reviewed");
    expect(html).not.toContain("Clothing, namely");
  };

  it("not reviewed: the review line with a link to the lead", async () => {
    const html = await go({ status: "ok", details: null, unreadable: false, unreviewed: true });
    expect(text(html)).toContain("Consult details aren't reviewed yet, so marks and classes weren't filled.");
    expect(html).toContain(`<a href="/dashboard/leads/${LEAD}/">Review them on the lead.</a>`);
    nothingFromConsult(html);
    stillFilled(html);
  });

  it("an unreadable record", async () => {
    const html = await go({ status: "ok", details: null, unreadable: true, unreviewed: false });
    expect(text(html)).toContain("Consult details couldn't be loaded.");
    nothingFromConsult(html);
    stillFilled(html);
  });

  it("a failed read", async () => {
    const html = await go({ status: "unavailable" });
    expect(text(html)).toContain("Consult details couldn't be loaded.");
    nothingFromConsult(html);
    stillFilled(html);
  });

  it("reviewed but listing no marks, even with a package named", async () => {
    const html = await go(reviewed(details([], { recommended_package: "Enhanced" })));
    expect(text(html)).toContain("The reviewed consult details list no marks, so none were filled.");
    nothingFromConsult(html);
    expect(html).toMatch(/<option value="Concierge" selected="">/);
    stillFilled(html);
  });

  it("no consult details at all has no line of its own (the consult strip says so)", async () => {
    const html = await go({ status: "ok", details: null, unreadable: false, unreviewed: false });
    expect(html).not.toContain("aren't reviewed");
    expect(html).not.toContain("Consult details couldn");
    nothingFromConsult(html);
    stillFilled(html);
  });
});
