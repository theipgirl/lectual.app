import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

/** D1/D2/D3/D4: New document uses New proposal's picker; reads fail on their own; a lead finds its matter. */

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("<!-- -->", "");
const LEAD = "77777777-7777-4777-8777-777777777777";

const matter = (i: number, over: Record<string, unknown> = {}) => ({
  id: `matter-${i}`,
  type: "TM",
  title: `Matter title ${i}`,
  mark_text: `MARK${i}`,
  matter_number: `TM-2026-${String(i).padStart(4, "0")}`,
  owner_name: `Client ${i}`,
  status: "open",
  stage: null,
  lead_id: null,
  ...over,
});
const lead = (i: number) => ({ id: `lead-${i}`, first_name: `First${i}`, last_name: `Last${i}`, business_name: null, email: `l${i}@example.com` });

type Opts = { matters?: unknown[] | "fail"; leads?: unknown[] | "fail"; leadMatters?: unknown[] | "fail"; getLead?: unknown; params?: Record<string, string> };

class Redirected extends Error {
  constructor(public href: string) {
    super("redirect");
  }
}

async function render(opts: Opts = {}) {
  vi.resetModules();
  const listMatters = vi.fn(async (filter?: { leadId?: string }) => {
    const rows = filter?.leadId ? opts.leadMatters : opts.matters;
    if (rows === "fail") throw new Error("down");
    return rows ?? [];
  });
  vi.doMock("@/lib/matters", () => ({ listMatters }));
  vi.doMock("@/lib/pipeline", () => ({
    listLeads: vi.fn(async () => {
      if (opts.leads === "fail") throw new Error("down");
      return opts.leads ?? [];
    }),
    getLead: vi.fn(async () => (opts.getLead === undefined ? { id: LEAD, first_name: "Amara", last_name: "Okafor", business_name: null, email: "a@example.com" } : opts.getLead)),
  }));
  vi.doMock("next/navigation", () => ({
    redirect: (href: string) => {
      throw new Redirected(href);
    },
  }));
  const { default: Page } = await import("@/app/dashboard/documents/new/page");
  return text(renderToStaticMarkup(await Page({ searchParams: Promise.resolve(opts.params ?? {}) })));
}

beforeEach(() => vi.resetModules());

describe("D2: the picker on New document", () => {
  it("shows the Leads | Matters switch, a search box, the 8 most recent rows and 'Showing 8 of 23.'", async () => {
    const html = await render({ matters: Array.from({ length: 23 }, (_, i) => matter(i + 1)) });
    expect(html).toContain("Who is this for?");
    expect(html).toContain('aria-label="Kind of record"');
    expect(html).toContain("Leads");
    expect(html).toContain("Matters");
    expect(html).toContain('aria-label="Search matters"');
    expect((html.match(/href="\/dashboard\/documents\/new\/matter-\d+\/"/g) ?? []).length).toBe(8);
    expect(html).toContain("Showing 8 of 23.");
    expect(html).toContain('action="/dashboard/documents/new/"');
  });

  it("matters link to their template page, and there is no Start blank", async () => {
    const html = await render({ matters: [matter(1)] });
    expect(html).toContain('href="/dashboard/documents/new/matter-1/"');
    expect(html).not.toMatch(/Start blank|Starting blank|blank=1/);
  });

  it("closed matters are not offered (the page's existing rule)", async () => {
    const html = await render({ matters: [matter(1), matter(2, { status: "closed" })] });
    expect(html).toContain("MARK1");
    expect(html).not.toContain("MARK2");
    expect(html).toContain("Showing 1 of 1.");
  });

  it("a failed matters read is its own alert, never 'No matches'; the other kind still works", async () => {
    const html = await render({ matters: "fail", leads: [lead(1)] });
    expect(html).toContain("We couldn't load your matters.");
    expect(html).not.toMatch(/No matches|No matters on file/);
  });

  it("a failed leads read (Leads tab) is its own alert, and the matters tab still lists", async () => {
    const leadsTab = await render({ leads: "fail", matters: [matter(1)], params: { kind: "lead" } });
    expect(leadsTab).toContain("We couldn't load your leads.");
    expect(leadsTab).not.toContain("No matches");
    const mattersTab = await render({ leads: "fail", matters: [matter(1)] });
    expect(mattersTab).toContain("MARK1");
    expect(mattersTab).toContain("We couldn't load your leads.");
  });

  it("a search narrows the list and says so when nothing matches", async () => {
    const html = await render({ matters: [matter(1), matter(2)], params: { q: "mark2" } });
    expect(html).toContain("MARK2");
    expect(html).not.toContain("MARK1");
    expect(await render({ matters: [matter(1)], params: { q: "zzz" } })).toContain('No matches for "zzz".');
  });

  it("the Leads tab links a lead to ?lead=", async () => {
    const html = await render({ leads: [lead(1)], params: { kind: "lead" } });
    expect(html).toContain('href="/dashboard/documents/new/?lead=lead-1"');
  });
});

describe("D3: choosing a lead", () => {
  it("0 open matters: the sentence and a link to the lead page", async () => {
    const html = await render({ leadMatters: [], params: { lead: LEAD } });
    expect(html).toContain("Letters are drafted on a matter. Open a matter for Amara Okafor first.");
    // next/link drops the trailing slash in tests (AGENTS.md), so the link is matched without it.
    expect(html).toMatch(new RegExp(`href="/dashboard/leads/${LEAD}/?"`));
  });

  it("a lead whose only matters are closed reads as no open matter", async () => {
    const html = await render({ leadMatters: [matter(1, { status: "closed" })], params: { lead: LEAD } });
    expect(html).toContain("Open a matter for Amara Okafor first.");
  });

  it("1 open matter redirects straight to its template page", async () => {
    await expect(render({ leadMatters: [matter(1)], params: { lead: LEAD } })).rejects.toMatchObject({ href: "/dashboard/documents/new/matter-1/" });
  });

  it("several open matters list each one with its template link", async () => {
    const html = await render({ leadMatters: [matter(1), matter(2)], params: { lead: LEAD } });
    expect(html).toMatch(/href="\/dashboard\/documents\/new\/matter-1\/?"/);
    expect(html).toMatch(/href="\/dashboard\/documents\/new\/matter-2\/?"/);
    expect(html).toContain("more than one open matter");
  });

  it("a failed matters read for the lead is an alert, not the 'none' message", async () => {
    const html = await render({ leadMatters: "fail", params: { lead: LEAD } });
    expect(html).toContain("We couldn't load this lead's matters.");
    expect(html).not.toContain("Open a matter for");
  });

  it("a lead that is not there (or another firm's) is 'couldn't be found' and the picker stays", async () => {
    const html = await render({ getLead: null, params: { lead: LEAD }, matters: [matter(1)] });
    expect(html).toContain("That lead couldn't be found.");
    expect(html).toContain("Who is this for?");
    expect(await render({ params: { lead: "nope" } })).toContain("That lead link isn't valid.");
  });
});

describe("D1/D4: reuse and gates", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  it("the page uses the shared picker and holds no second copy of the pick/search logic", () => {
    const page = read("src/app/dashboard/documents/new/page.tsx");
    expect(page).toContain("WhoIsThisFor");
    expect(page).toContain("@/lib/proposals/new-picker");
    expect(page).toContain("@/lib/skills/pick");
    for (const f of ["src/app/dashboard/documents/new/page.tsx", "src/lib/documents/new-picker.ts"]) {
      expect(read(f), f).not.toMatch(/pickRecords|PICK_LIMIT|Showing \$\{|\.slice\(0, ?8\)|toLowerCase\(\)\.includes/);
    }
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
    const copies = files("src").filter((f) => /showingLine|Showing \$\{/.test(read(f)));
    // The picker's own two files and the Skills picker (an older, separate card); nothing under documents.
    expect(copies.sort()).toEqual(["src/components/proposal-editor/WhoIsThisFor.tsx", "src/components/skills/SkillPicker.tsx", "src/lib/proposals/new-picker.ts"]);
  });

  it("the module gate is still the segment layout's, and reads go through the scoped helpers only", () => {
    expect(read("src/app/dashboard/documents/new/layout.tsx")).toContain('orgHasModule("document-center")');
    expect(read("src/app/dashboard/documents/new/layout.tsx")).toContain("notFound()");
    expect(read("src/app/dashboard/documents/new/page.tsx")).not.toMatch(/db\/admin|getAdminClient/);
  });

  it("New proposal keeps its blank form and its own text", async () => {
    vi.resetModules();
    const { WhoIsThisFor } = await import("@/components/proposal-editor/WhoIsThisFor");
    const { buildPicker } = await import("@/lib/proposals/new-picker");
    const view = buildPicker({ kind: "lead", term: "", leads: { status: "ok", records: [] }, matters: { status: "ok", records: [] } });
    const html = renderToStaticMarkup(WhoIsThisFor({ view, chosen: null }));
    expect(html).toContain("Start blank");
    expect(html).toContain('action="/dashboard/proposals/new/"');
    expect(html).toContain("the form below is filled from it");
  });
});
