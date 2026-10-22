import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");

type LeadRow = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; email: string | null };
type MatterRow = { id: string; type: string; title: string | null; mark_text: string | null; matter_number: string; owner_name: string | null };
type Case = {
  modules?: string[];
  session?: { kind: string; role?: string } | null;
  leads?: LeadRow[] | "error";
  matters?: MatterRow[] | "error";
  q?: string;
  skill?: string;
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lead = (n: number, over: Partial<LeadRow> = {}): LeadRow => ({ id: uuid(n), first_name: `Pat${n}`, last_name: `Lead${n}`, business_name: null, email: `pat${n}@example.com`, ...over });
const matter = (n: number, over: Partial<MatterRow> = {}): MatterRow => ({
  id: uuid(1000 + n),
  type: "TM",
  title: null,
  mark_text: `MARK${n}`,
  matter_number: `TM-2026-${String(n).padStart(4, "0")}`,
  owner_name: `Client ${n}`,
  ...over,
});

const ALL = ["agent-toolkit", "document-center", "agents"];

async function render(c: Case) {
  const notFound = vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  const listLeads = vi.fn(async () => {
    if (c.leads === "error") throw new Error("down");
    return c.leads ?? [];
  });
  const listMatters = vi.fn(async () => {
    if (c.matters === "error") throw new Error("down");
    return c.matters ?? [];
  });
  vi.doMock("next/navigation", () => ({ notFound }));
  const modules = c.modules ?? ALL;
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => modules.includes(m)) }));
  const session = c.session === undefined ? { kind: "ok", role: "owner" } : c.session;
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => session ?? { kind: "signed-out", redirectTo: "/login" }),
  }));
  vi.doMock("@/lib/pipeline", () => ({ listLeads }));
  vi.doMock("@/lib/matters", () => ({ listMatters }));
  const { default: Page } = await import("../../src/app/dashboard/skills/page");
  const searchParams = Promise.resolve({ ...(c.q !== undefined ? { q: c.q } : {}), ...(c.skill ? { skill: c.skill } : {}) });
  const html = renderToStaticMarkup(await Page({ searchParams }));
  return { html, notFound, listLeads, listMatters };
}

const NAMES = ["Prep a consult", "Draft the engagement letter", "Welcome a client", "Filing follow-up", "Opinion letter", "Trademark clearance", "Meeting follow-up"];
/** One card's markup, from its section to the next one. */
const card = (html: string, name: string) => {
  const start = html.indexOf(`>${name}<`);
  expect(start, name).toBeGreaterThan(-1);
  const from = html.lastIndexOf("<section", start);
  return html.slice(from, html.indexOf("</section>", start));
};
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const hrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);

describe("Skills page: render", () => {
  beforeEach(() => vi.resetModules());

  it("is titled Skills, and shows the seven cards in order", async () => {
    const { html } = await render({ leads: [lead(1)], matters: [matter(1)] });
    expect(html).toMatch(/<h1[^>]*>Skills<\/h1>/);
    const at = NAMES.map((n) => html.indexOf(`>${n}<`));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("every card says what it does, what it reads, and 'Drafts only, attorney reviews'", async () => {
    const { html } = await render({ leads: [lead(1)], matters: [matter(1)] });
    for (const name of NAMES) {
      const c = card(html, name);
      expect(c, name).toContain("Reads · ");
      expect(c, name).toContain("Drafts only, attorney reviews");
      expect(c.replace(/<[^>]+>/g, " ").length, name).toBeGreaterThan(200);
    }
  });

  it("every card has a 'Run it on...' search box for an owner", async () => {
    const { html } = await render({ leads: [lead(1)], matters: [matter(1)] });
    for (const name of NAMES) {
      const c = card(html, name);
      expect(c, name).toContain("Run it on...");
      expect(c, name).toMatch(/<input[^>]*name="q"/);
      expect(c, name).toMatch(/<form[^>]*method="get"/);
      expect(c, name).toContain('name="skill"');
    }
  });

  it("with no term: up to 8 recent records of the right kind, and 'Showing 8 of 12'", async () => {
    const leads = Array.from({ length: 12 }, (_, i) => lead(i + 1));
    const matters = Array.from({ length: 12 }, (_, i) => matter(i + 1));
    const { html } = await render({ leads, matters });
    const prep = card(html, "Prep a consult");
    expect(hrefs(prep).filter((h) => h.startsWith("/dashboard/leads/"))).toHaveLength(8);
    expect(decode(prep)).toContain("Showing 8 of 12. Type a narrower search");
    const opinion = card(html, "Opinion letter");
    expect(hrefs(opinion)).toHaveLength(8);
    expect(opinion).toContain("Showing 8 of 12");
  });

  it("few records: all of them, and the count line says so", async () => {
    const { html } = await render({ leads: [lead(1), lead(2)], matters: [] });
    const prep = card(html, "Prep a consult");
    expect(prep).toContain("Showing 2 of 2.");
    expect(prep).not.toContain("narrower");
  });

  it("each record is a link to exactly the target for its skill", async () => {
    const { html } = await render({ leads: [lead(1)], matters: [matter(1)] });
    const L = uuid(1);
    const M = uuid(1001);
    expect(hrefs(card(html, "Prep a consult"))).toEqual([`/dashboard/leads/${L}/#prep-consult`]);
    expect(hrefs(card(html, "Draft the engagement letter"))).toEqual([`/dashboard/documents/new/${M}/loe/`]);
    expect(hrefs(card(html, "Welcome a client"))).toEqual([`/dashboard/matters/${M}/#client-updates`]);
    expect(hrefs(card(html, "Filing follow-up"))).toEqual([`/dashboard/matters/${M}/#client-updates`]);
    expect(hrefs(card(html, "Opinion letter"))).toEqual([`/dashboard/documents/new/${M}/opinion-letter/`]);
    expect(hrefs(card(html, "Trademark clearance"))).toEqual([`/dashboard/documents/new/${M}/trademark-clearance/`]);
    expect(hrefs(card(html, "Meeting follow-up"))).toEqual([`/dashboard/leads/${L}/`, `/dashboard/matters/${M}/`, "/dashboard/meetings/"]);
  });

  it("Meeting follow-up lists leads and matters and offers Open Meetings", async () => {
    const { html } = await render({ leads: [lead(1)], matters: [matter(1)] });
    const c = card(html, "Meeting follow-up");
    expect(c).toContain(">Leads<");
    expect(c).toContain(">Matters<");
    expect(c).toContain(">Open Meetings<");
  });

  it("Welcome a client lists only trademark matters", async () => {
    const matters = [matter(1), matter(2, { type: "COPYRIGHT", mark_text: "COPYMARK" }), matter(3, { type: "PATENT", mark_text: "PATMARK" })];
    const { html } = await render({ matters });
    const welcome = card(html, "Welcome a client");
    expect(welcome).toContain("MARK1");
    expect(welcome).not.toContain("COPYMARK");
    expect(welcome).not.toContain("PATMARK");
    expect(card(html, "Opinion letter")).toContain("COPYMARK");
  });

  it("makes no mention of modules or of which firms have them", async () => {
    const { html } = await render({ leads: [lead(1)], matters: [matter(1)] });
    expect(html).not.toMatch(/module|agent-toolkit|document-center/i);
  });
});

describe("Skills page: search", () => {
  beforeEach(() => vi.resetModules());
  const leads = [lead(1, { first_name: "Jane", last_name: "Doe" }), lead(2, { first_name: "Bob", last_name: "Smith" }), lead(3, { business_name: "Doe Brothers" })];

  it("?skill=<slug>&q=<term> narrows that card only, case-insensitively, and keeps the term in the box", async () => {
    const { html } = await render({ leads, matters: [matter(1)], skill: "prep-consult", q: "DOE" });
    const prep = card(html, "Prep a consult");
    expect(prep).toContain("Jane Doe");
    expect(prep).toContain("Doe Brothers");
    expect(prep).not.toContain("Bob Smith");
    expect(prep).toContain("Showing 2 of 2.");
    expect(prep).toContain('value="DOE"');
    // Meeting follow-up shows the recent leads, not the filtered list.
    expect(card(html, "Meeting follow-up")).toContain("Bob Smith");
  });

  it("trims the term, and a term over 80 characters is cut to 80", async () => {
    const trimmed = await render({ leads, skill: "prep-consult", q: "   jane  " });
    expect(card(trimmed.html, "Prep a consult")).toContain('value="jane"');
    expect(card(trimmed.html, "Prep a consult")).toContain("Jane Doe");
    vi.resetModules();
    const long = await render({ leads, skill: "prep-consult", q: "j".repeat(120) });
    expect(card(long.html, "Prep a consult")).toContain(`value="${"j".repeat(80)}"`);
    expect(card(long.html, "Prep a consult")).not.toContain("j".repeat(81));
  });

  it("an unknown skill in the URL filters nothing", async () => {
    const { html } = await render({ leads, skill: "nope", q: "jane" });
    expect(card(html, "Prep a consult")).toContain("Bob Smith");
  });

  it("'No matches' only after a read that worked and matched nothing", async () => {
    const { html } = await render({ leads, matters: [matter(1)], skill: "prep-consult", q: "zzz" });
    expect(decode(card(html, "Prep a consult"))).toContain('No matches for "zzz".');
    expect(card(html, "Opinion letter")).not.toContain("No matches");
    expect(html).not.toContain("couldn&#x27;t load");
  });

  it("no records at all is said as no records, not as a failed read", async () => {
    const { html } = await render({ leads: [], matters: [] });
    expect(card(html, "Prep a consult")).toContain("No leads on file yet.");
    expect(card(html, "Opinion letter")).toContain("No matters on file yet.");
    expect(html).not.toContain("couldn&#x27;t load");
  });

  it("the search form carries the skill and returns to the card", async () => {
    const { html } = await render({ leads });
    const prep = card(html, "Prep a consult");
    expect(prep).toContain('action="#skill-prep-consult"');
    expect(prep).toContain('<input type="hidden" name="skill" value="prep-consult"/>');
    expect(prep).toContain('maxLength="80"');
  });
});

describe("Skills page: failed reads", () => {
  beforeEach(() => vi.resetModules());

  it("a failed lead read says so on the lead cards, never 'No matches', and the matter cards still render", async () => {
    const { html } = await render({ leads: "error", matters: [matter(1)], skill: "prep-consult", q: "x" });
    const prep = card(html, "Prep a consult");
    expect(decode(prep)).toContain("We couldn't load your leads.");
    expect(prep).not.toContain("No matches");
    expect(prep).not.toContain("Showing");
    expect(card(html, "Opinion letter")).toContain("MARK1");
    expect(card(html, "Opinion letter")).not.toContain("couldn&#x27;t load");
  });

  it("a failed matter read says so on the matter cards, and the lead card still renders", async () => {
    const { html } = await render({ leads: [lead(1)], matters: "error" });
    for (const name of ["Draft the engagement letter", "Welcome a client", "Filing follow-up", "Opinion letter", "Trademark clearance"]) {
      expect(decode(card(html, name)), name).toContain("We couldn't load your matters.");
      expect(card(html, name), name).not.toContain("No matches");
    }
    expect(card(html, "Prep a consult")).toContain("Pat1 Lead1");
  });

  it("Meeting follow-up names the half that failed and still lists the other", async () => {
    const { html } = await render({ leads: "error", matters: [matter(1)] });
    const c = decode(card(html, "Meeting follow-up"));
    expect(c).toContain("We couldn't load your leads.");
    expect(c).toContain("MARK1");
  });
});

describe("Skills page: the gate", () => {
  beforeEach(() => vi.resetModules());

  it("a firm without agent-toolkit gets notFound() and no markup, and nothing is read", async () => {
    for (const modules of [[], ["agents", "document-center", "mailbox"]]) {
      vi.resetModules();
      await expect(render({ modules, leads: [lead(1)] })).rejects.toThrow("NEXT_NOT_FOUND");
    }
    vi.resetModules();
    const notFound = vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    const listLeads = vi.fn(async () => []);
    vi.doMock("next/navigation", () => ({ notFound }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "owner" })) }));
    vi.doMock("@/lib/pipeline", () => ({ listLeads }));
    vi.doMock("@/lib/matters", () => ({ listMatters: vi.fn() }));
    const { default: Page } = await import("../../src/app/dashboard/skills/page");
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(listLeads).not.toHaveBeenCalled();
  });

  it("a signed-out or unresolvable session gets notFound()", async () => {
    await expect(render({ session: null })).rejects.toThrow("NEXT_NOT_FOUND");
    vi.resetModules();
    await expect(render({ session: { kind: "no-access" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("without document-center, the three letter cards have no picker and no link into documents", async () => {
    const { html } = await render({ modules: ["agent-toolkit", "agents"], leads: [lead(1)], matters: [matter(1)] });
    for (const name of ["Draft the engagement letter", "Opinion letter", "Trademark clearance"]) {
      const c = card(html, name);
      expect(c, name).toContain("Not switched on for this firm.");
      expect(c, name).not.toContain("<form");
      expect(c, name).not.toContain("<input");
      expect(c, name).not.toContain("<a ");
      expect(c, name).toContain("Drafts only, attorney reviews");
      expect(c, name).toContain("Reads · ");
    }
    expect(html).not.toContain("/dashboard/documents/");
    // The other cards are untouched.
    expect(card(html, "Prep a consult")).not.toContain("Not switched on");
    expect(card(html, "Meeting follow-up")).not.toContain("Not switched on");
  });

  it("without agents, Meeting follow-up has no picker and no Open Meetings link", async () => {
    const { html } = await render({ modules: ["agent-toolkit", "document-center"], leads: [lead(1)], matters: [matter(1)] });
    const c = card(html, "Meeting follow-up");
    expect(c).toContain("Not switched on for this firm.");
    expect(c).not.toContain("<form");
    expect(c).not.toContain("<a ");
    expect(html).not.toContain("/dashboard/meetings/");
  });

  it("with only agent-toolkit, nothing in the page links to a route the firm would get a 404 for", async () => {
    const { html } = await render({ modules: ["agent-toolkit"], leads: [lead(1)], matters: [matter(1)] });
    for (const h of hrefs(html)) expect(h, h).toMatch(/^\/dashboard\/(leads|matters)\//);
  });

  it("reads a list only when a card that draws a picker needs it", async () => {
    const { listLeads, listMatters } = await render({ modules: ["agent-toolkit"], leads: [lead(1)], matters: [matter(1)] });
    expect(listLeads).toHaveBeenCalledTimes(1);
    expect(listMatters).toHaveBeenCalledTimes(1);
  });
});

describe("Skills page: roles", () => {
  beforeEach(() => vi.resetModules());

  it.each(["viewer", "social_media"])("%s sees the catalog, no picker, and a line about their role", async (role) => {
    const { html, listLeads, listMatters } = await render({ session: { kind: "ok", role }, leads: [lead(1)], matters: [matter(1)] });
    expect(decode(html)).toContain("Your role can't run skills.");
    for (const name of NAMES) {
      const c = card(html, name);
      expect(c, name).toContain("Reads · ");
      expect(c, name).toContain("Drafts only, attorney reviews");
      expect(c, name).not.toContain("<form");
      expect(c, name).not.toContain("<input");
      expect(c, name).not.toContain("<a ");
    }
    expect(listLeads).not.toHaveBeenCalled();
    expect(listMatters).not.toHaveBeenCalled();
  });

  it("an attorney, a paralegal and an intake coordinator get pickers and no role line", async () => {
    for (const role of ["attorney", "paralegal", "intake"]) {
      vi.resetModules();
      const { html } = await render({ session: { kind: "ok", role }, leads: [lead(1)], matters: [matter(1)] });
      expect(html, role).not.toContain("Your role");
      expect(card(html, "Prep a consult"), role).toContain("<form");
    }
  });
});

describe("Skills page: the Cowork section", () => {
  beforeEach(() => vi.resetModules());

  const section = (html: string) => {
    const start = html.indexOf("In Claude (Cowork plugin)");
    expect(start).toBeGreaterThan(-1);
    return html.slice(html.lastIndexOf("<section", start), html.indexOf("</section>", start));
  };

  it("lists the nine plugin-only skills, one line each, after the cards", async () => {
    const { html } = await render({ leads: [lead(1)], matters: [matter(1)] });
    const s = section(html);
    const items = [...s.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
    expect(items).toHaveLength(9);
    for (const name of ["Start my day", "End my day", "Triage the pipeline", "Monday review", "Weekly wrap", "Process a consult", "Wrap a consult", "Show my dashboard", "Manage the pipeline"]) {
      expect(items.some((i) => i.startsWith(name)), name).toBe(true);
    }
    expect(html.indexOf("In Claude (Cowork plugin)")).toBeGreaterThan(html.indexOf(">Meeting follow-up<"));
    expect(decode(s)).toContain("These run in Claude, not in this app.");
  });

  it("has no button, form or link inside it", async () => {
    const { html } = await render({ leads: [lead(1)], matters: [matter(1)] });
    const s = section(html);
    expect(s).not.toContain("<button");
    expect(s).not.toContain("<form");
    expect(s).not.toContain("<a ");
    expect(s).not.toContain("<input");
  });

  it("is still shown to a role that can't run skills", async () => {
    const { html } = await render({ session: { kind: "ok", role: "viewer" } });
    expect(html).toContain("In Claude (Cowork plugin)");
  });
});

describe("Skills page: no writes, no sends, no placeholders", () => {
  const files = (dir: string): string[] =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const sources = [...files("src/app/dashboard/skills"), ...files("src/components/skills"), ...files("src/lib/skills")].map((f) => [f, readFileSync(path.join(root, f), "utf8")] as const);

  it("covers the page, the components and the library", () => {
    expect(sources.map(([f]) => f).sort()).toEqual(
      [
        "src/app/dashboard/skills/page.tsx",
        "src/components/skills/CoworkSkills.tsx",
        "src/components/skills/SkillCard.tsx",
        "src/components/skills/SkillPicker.tsx",
        "src/lib/skills/catalog.ts",
        "src/lib/skills/pick.ts",
      ].sort(),
    );
  });

  it("performs no write and defines no server action", () => {
    for (const [f, src] of sources) {
      expect(src, f).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(src, f).not.toMatch(/["']use server["']/);
      expect(src, f).not.toMatch(/sendMail|Mail\.Send|dangerouslySetInnerHTML|db\/admin|getAdminClient/);
      expect(src, f).not.toMatch(/coming soon|todo|lorem|placeholder="?(?:todo|tbd)/i);
    }
  });

  it("reads only through the existing lead and matter lists", () => {
    const page = readFileSync(path.join(root, "src/app/dashboard/skills/page.tsx"), "utf8");
    expect(page).toContain('from "@/lib/pipeline"');
    expect(page).toContain('from "@/lib/matters"');
    expect(page).not.toContain("getScopedClient");
  });
});
