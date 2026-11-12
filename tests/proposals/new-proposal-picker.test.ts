import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ConsultMark, StoredConsultDetails } from "@/lib/consult/vocab";
import type { ReviewedConsultRead } from "@/lib/consult/store";

/**
 * New proposal: the "Who is this for?" picker (Sprint 20, reworked in Sprint 3) and the one-button page a lead or
 * matter link opens. In Sprint 3 a picker row CREATES the draft (a form posting only the record's id) and the
 * second-stage form is gone, so what choosing a record "fills in" is tested where it is built
 * (create-proposal-one-step.test.ts); this file keeps the picker's own rules and the chosen-record page.
 * The page is rendered with a fake scoped client and mocked list and consult reads. Nothing touches a database.
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
    listProposals: vi.fn(async () => []),
    getProposalSettings: vi.fn(async () => {
      if (opts.settingsFails) throw new Error("db down");
      return opts.settings === undefined ? { default_pay_url: "https://pay.example/x", pricing: { packages: PACKAGES } } : opts.settings;
    }),
  }));
  vi.doMock("@/lib/proposals/consult-strip-load", () => ({ loadConsultStrip: h.stripLoad }));
  vi.doMock("@/lib/consult-proposal/draft-gate", () => ({ loadDraftBlock: vi.fn(async () => null) }));
  vi.doMock("@/lib/meetings/connection", () => ({ listMeetingConnections: vi.fn(async () => ({ ok: true, connections: [] })) }));
  vi.doMock("@/lib/proposals/consults-load", () => ({ loadConsultsStrip: vi.fn() }));
  vi.doMock("@/lib/proposals/lead-options", () => ({ loadLeadOptions: vi.fn(async () => ({ status: "ok", leads: [] })) }));
  vi.doMock("@/lib/proposals/consult-prefill-load", () => ({ loadConsultForPrefill: h.consultLoad }));
  vi.doMock("@/lib/pipeline", () => ({ listLeads: h.listLeads }));
  vi.doMock("@/lib/matters", () => ({ listMatters: h.listMatters }));
  vi.doMock("@/app/dashboard/proposals/actions", () => ({ createProposalAction: vi.fn() }));
  const { default: Page } = await import("../../src/app/dashboard/proposals/new/page");
  // Sprint 3: with nothing chosen the page is the start screen; "Who is this for?" is the Start from scratch door.
  const search = opts.search ?? {};
  const chosenOrBlank = ["lead", "matter", "blank", "door"].some((k) => k in search);
  return renderToStaticMarkup(createElement("div", null, await Page({ searchParams: Promise.resolve(chosenOrBlank ? search : { door: "scratch", ...search }) })));
}

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const input = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
const picker = (html: string) => html.slice(html.indexOf('aria-labelledby="who-title"'), html.indexOf("</section>", html.indexOf('aria-labelledby="who-title"')));

beforeEach(() => vi.resetModules());

const rowForms = (html: string) => [...html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)].map((m) => m[0]);
const idsPosted = (html: string, field: string) => [...html.matchAll(new RegExp(`<input[^>]*name="${field}"[^>]*value="([^"]*)"`, "g"))].map((m) => m[1]);

describe("the picker, with nothing chosen", () => {
  it("shows 'Who is this for?', Leads selected, a search box, Start blank and the recent leads, each creating the draft", async () => {
    const html = await render({ leads: [lead(1), lead(2)], matters: [matter(1)] });
    const p = picker(html);
    expect(p).toContain("Who is this for?");
    expect(p).toMatch(/<a href="\/dashboard\/proposals\/new\/\?kind=lead"[^>]*aria-current="page"[^>]*>Leads</);
    expect(p).toMatch(/<a href="\/dashboard\/proposals\/new\/\?kind=matter"(?![^>]*aria-current)[^>]*>Matters</);
    expect(p).toMatch(/<input[^>]*type="search"[^>]*aria-label="Search leads"/);
    expect(p).toContain('<a href="/dashboard/proposals/new/?blank=1" class="pe-who-blank">Start blank</a>');
    // A row is a form posting ONLY the id (and the type), never a link that carries it into a second form.
    expect(idsPosted(p, "leadId")).toEqual([uuid(101), uuid(102)]);
    expect(p.match(/data-start-row/g)).toHaveLength(2);
    expect(p).toContain("Create draft");
    expect(hrefs(p).some((x) => x.includes("?lead="))).toBe(false);
    expect(text(p)).toContain("Showing 2 of 2.");
  });

  it("no brand name, package or pay-link field is drawn anywhere", async () => {
    const html = await render({ leads: [lead(1)] });
    for (const n of ["brandName", "package", "payUrl", "base", "perClass", "useConsult"]) expect(input(html, n)).toBe("");
    expect(html).not.toContain('name="package"');
    expect(html).not.toContain("Filled from");
  });

  it("?kind=matter shows the matters, and only the matters; a row posts the matter id", async () => {
    const html = await render({ search: { kind: "matter" }, leads: [lead(1)], matters: [matter(1), matter(2)] });
    const p = picker(html);
    expect(p).toMatch(/\?kind=matter"[^>]*aria-current="page"/);
    expect(p).toContain("MARK1");
    expect(p).not.toContain("Pat1");
    expect(idsPosted(p, "matterId")).toEqual([uuid(1001), uuid(1002)]);
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
    expect(p.match(/data-start-row/g)).toHaveLength(8);
    expect(p.indexOf("Pat1 ")).toBeLessThan(p.indexOf("Pat2 "));
    expect(p).not.toContain("Pat9 ");
    expect(text(p)).toContain("Showing 8 of 12.");
  });

  it("a search narrows the list and is shown again in the box; it stays on the picker (door=scratch)", async () => {
    const html = await render({ search: { q: "  pat2  " }, leads: [lead(1), lead(2), lead(20)] });
    const p = picker(html);
    expect(p).toMatch(/<input[^>]*name="q"[^>]*value="pat2"/);
    expect(input(html, "door")).toContain('value="scratch"');
    expect(text(p)).toContain("Showing 2 of 2.");
    expect(idsPosted(p, "leadId")).toEqual([uuid(102), uuid(120)]);
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

  it("no label, name or email is in any href; ids are posted, not linked; labels are escaped", async () => {
    const html = await render({ leads: [lead(1, { id: 'a&b"c', first_name: "<b>Ana</b>", last_name: "Ruiz", business_name: "Zephyr", email: "ana@example.com" })] });
    const p = picker(html);
    expect(p).toContain('<span class="pe-who-name">&lt;b&gt;Ana&lt;/b&gt; Ruiz</span>');
    expect(p).toContain('<span class="pe-who-sub">Zephyr · ana@example.com</span>');
    expect(p).not.toContain("<b>Ana");
    for (const href of hrefs(p)) for (const word of ["Ana", "Ruiz", "Zephyr", "example"]) expect(href).not.toContain(word);
  });

  it("the search is a plain GET form to the same page, carrying the kind", async () => {
    const html = await render({ search: { kind: "matter" } });
    expect(html).toMatch(/<form[^>]*role="search"[^>]*action="\/dashboard\/proposals\/new\/"[^>]*method="get"/);
    expect(input(html, "kind")).toContain('value="matter"');
  });

  it("the type switch keeps the picker: a flat-fee type rides on the rows' forms and the search", async () => {
    const html = await render({ search: { type: "general" }, leads: [lead(1)] });
    expect(text(html)).toContain("Contract or other matter (flat fee)");
    expect(rowForms(picker(html)).some((f) => /name="kind" value="general"/.test(f))).toBe(true);
    expect(input(html, "type")).toContain('value="general"');
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

  it("both failed names both, and still offers Start blank", async () => {
    const html = await render({ leads: "error", matters: "error" });
    expect(text(picker(html))).toContain("We couldn't load your leads.");
    expect(text(picker(html))).toContain("We couldn't load your matters.");
    expect(picker(html)).toContain("Start blank");
  });
});

describe("Start blank", () => {
  it("hides the picker's list and shows a name form that creates the draft", async () => {
    const html = await render({ search: { blank: "1" }, leads: [lead(1)] });
    expect(html).not.toContain("who-title");
    expect(html).not.toContain("Pat1");
    expect(text(html)).toContain("Starting blank");
    expect(input(html, "fullName")).toContain("required");
    expect(html).toContain("Create draft");
    for (const n of ["brandName", "package", "payUrl"]) expect(input(html, n)).toBe("");
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

  it.each(["viewer", "social_media", null])("a role that can't write proposals (%s) sees the role message, no door, no picker, and no list is read", async (role) => {
    const html = await render({ role, leads: [lead(1)] });
    expect(text(html)).toContain("Your role can't start proposals");
    expect(html).not.toContain("Who is this for?");
    expect(html).not.toContain("data-door");
    expect(html).not.toContain('name="fullName"');
    expect(h.listLeads).not.toHaveBeenCalled();
    expect(h.listMatters).not.toHaveBeenCalled();
    expect(h.consultLoad).not.toHaveBeenCalled();
  });
});

describe("a lead or matter chosen from its own page: who it is for, one button", () => {
  it("?lead=<id> shows 'For: <label> . Change' and a Create draft form, not the list; opening it creates nothing", async () => {
    const html = await render({ search: { lead: LEAD }, tables: { crm_lead: ANA }, leads: [lead(1)] });
    expect(text(html)).toContain("For:</span> <strong>Ana Ruiz · Zephyr Co</strong> · <a");
    expect(html).not.toContain("who-title");
    expect(html).not.toContain("Pat1");
    expect(hrefs(html)).toContain("/dashboard/proposals/new/?door=scratch");
    expect(idsPosted(html, "leadId")).toEqual([LEAD]);
    expect(html).toContain("Create draft");
    for (const n of ["brandName", "package", "payUrl", "base"]) expect(input(html, n)).toBe("");
    expect(h.listLeads).not.toHaveBeenCalled();
  });

  it("?matter=<id> is labelled by the matter's mark and posts the matter id", async () => {
    const html = await render({ search: { matter: MATTER }, tables: { crm_matter: { id: MATTER, lead_id: null, owner_name: "Dana Lopez", mark_text: "Zephyr", title: "Zephyr filing", matter_number: "TM-2026-0001" } } });
    expect(text(html)).toContain("<strong>Zephyr</strong>");
    expect(idsPosted(html, "matterId")).toEqual([MATTER]);
  });

  it("a matter with no mark is labelled by its title, else its number", async () => {
    const byTitle = await render({ search: { matter: MATTER }, tables: { crm_matter: { id: MATTER, lead_id: null, owner_name: null, mark_text: null, title: "Acme refresh", matter_number: "TM-1" } } });
    expect(text(byTitle)).toContain("<strong>Acme refresh</strong>");
    const byNumber = await render({ search: { matter: MATTER }, tables: { crm_matter: { id: MATTER, lead_id: null, owner_name: null, mark_text: null, title: null, matter_number: "TM-1" } } });
    expect(text(byNumber)).toContain("<strong>TM-1</strong>");
  });

  it("?matter= wins when ?lead= is given too", async () => {
    const html = await render({ search: { matter: MATTER, lead: LEAD }, tables: { crm_matter: { id: MATTER, lead_id: null, owner_name: "x", mark_text: "Birch", title: null, matter_number: "TM-1" }, crm_lead: ANA } });
    expect(text(html)).toContain("<strong>Birch</strong>");
    expect(idsPosted(html, "matterId")).toEqual([MATTER]);
  });

  it.each([
    ["an invalid id", { lead: "not-a-uuid" }, {}, "That lead or matter couldn't be found."],
    ["an invalid matter id", { matter: "nope" }, {}, "That lead or matter couldn't be found."],
    ["an id that isn't there (or is another firm's)", { lead: LEAD }, { crm_lead: null }, "That lead or matter couldn't be found."],
    ["a matter that isn't there", { matter: MATTER }, { crm_matter: null }, "That lead or matter couldn't be found."],
    ["a read that fails", { lead: LEAD }, { crm_lead: { error: "boom" } }, "That record couldn't be loaded just now. Refresh to try again."],
    ["a matter read that fails", { matter: MATTER }, { crm_matter: { error: "boom" } }, "That record couldn't be loaded just now. Refresh to try again."],
  ])("%s says so, offers the picker link, draws no Create draft and no consult read", async (_name, search, tables, sentence) => {
    const html = await render({ search, tables });
    expect(text(html)).toContain(sentence);
    expect(hrefs(html).some((x) => /^\/dashboard\/proposals\/new\/?\?door=scratch$/.test(x))).toBe(true);
    expect(html).not.toContain("Create draft");
    expect(h.consultLoad).not.toHaveBeenCalled();
  });
});

describe("the reviewed consult on the chosen-record page", () => {
  const go = (consult: ReviewedConsultRead, extra: Partial<Opts> = {}) => render({ search: { lead: LEAD }, tables: { crm_lead: ANA }, consult, ...extra });

  it("reviewed: shows the ticked box and what it will add (each mark, its kinds and classes), and the 'Filled from' line", async () => {
    const html = await go(reviewed(details([ZEPHYR])));
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="useConsult"[^>]*checked/);
    expect(text(html)).toContain("Use the marks and classes from the reviewed consult");
    expect(html).toContain("Clothing, namely t-shirts");
    expect(html).toContain("Online retail store services");
    expect(text(html)).toContain("Rebecca Beliard");
    expect(h.consultLoad).toHaveBeenCalledWith(LEAD);
  });

  it("says how many classes the per-brand limit left off", async () => {
    const many = mark("m1", "Zephyr", "word", [[1, "A goods"], [2, "B goods"], [3, "C goods"], [4, "D goods"], [5, "E goods"]]);
    const html = await go(reviewed(details([many])));
    expect(text(html)).toContain("2 more classes weren't added (3 per brand name).");
    expect(html).not.toContain("D goods");
  });

  const nothingFromConsult = (html: string) => {
    expect(html).not.toContain("useConsult");
    expect(html).not.toContain("Use the marks and classes");
    expect(html).not.toContain("Clothing, namely");
    expect(html).toContain("Create draft");
  };

  it("not reviewed: the review line with a link to the lead; the draft can still be created", async () => {
    const html = await go({ status: "ok", details: null, unreadable: false, unreviewed: true });
    expect(text(html)).toContain("Consult details aren't reviewed yet, so marks and classes weren't filled.");
    expect(html).toContain(`<a href="/dashboard/leads/${LEAD}/">Review them on the lead.</a>`);
    nothingFromConsult(html);
  });

  it("an unreadable record, and a failed read, say they couldn't be loaded (never 'no consult')", async () => {
    for (const consult of [{ status: "ok", details: null, unreadable: true, unreviewed: false } as ReviewedConsultRead, { status: "unavailable" } as ReviewedConsultRead]) {
      const html = await go(consult);
      expect(text(html)).toContain("Consult details couldn't be loaded.");
      nothingFromConsult(html);
    }
  });

  it("reviewed but listing no marks", async () => {
    const html = await go(reviewed(details([])));
    expect(text(html)).toContain("The reviewed consult details list no marks, so none were filled.");
    nothingFromConsult(html);
  });

  it("no consult details at all has no line of its own", async () => {
    const html = await go({ status: "ok", details: null, unreadable: false, unreviewed: false });
    expect(html).not.toContain("aren't reviewed");
    expect(html).not.toContain("Consult details couldn");
    nothingFromConsult(html);
  });

  it("a flat-fee proposal reads no consult at all", async () => {
    const html = await go(reviewed(details([ZEPHYR])), { search: { lead: LEAD, type: "general" } });
    expect(h.consultLoad).not.toHaveBeenCalled();
    expect(html).not.toContain("useConsult");
  });

  it("no price is read from any record: a matter's package and a consult's discount draw nothing", async () => {
    const html = await render({
      search: { matter: MATTER },
      tables: {
        crm_matter: { id: MATTER, lead_id: LEAD, owner_name: "x", mark_text: "Birch", title: null, matter_number: "TM-1", package_name: "Essential", price_cents: 1 },
        crm_lead: { ...ANA, value_band: "high", quote_cents: 5 },
      },
      consult: reviewed(details([ZEPHYR], { discount_discussed: "20% off for a second mark" })),
    });
    expect(html).not.toContain("20% off");
    expect(html).not.toMatch(/\$\d/);
  });
});
