import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Matter } from "@/lib/matters";
import type { MatterStage } from "@/lib/matters/stages";

/**
 * The Matters page's phase groups: chips, URL, default, both views, and the three states of the stage read.
 */
const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const st = (id: string, label: string, phase: string | null | undefined, order: number, open = true): MatterStage =>
  ({ id, code: id, label, order_index: order, is_open: open, waiting_on: "firm", ...(phase === undefined ? {} : { phase }) }) as MatterStage;
const S = {
  a: st("sa", "New client", "pipeline", 1),
  b: st("sb", "Questionnaire", "pre_filing", 2),
  b2: st("sb2", "Balance received", "pre_filing", 3),
  c: st("sc", "Published", "post_filing", 4),
  none: st("sn", "Misc", null, 5),
};
let n = 0;
const m = (type: string, stage: MatterStage | null, o: Partial<Matter> = {}) =>
  ({
    id: `m${++n}`,
    matter_number: `${type}-${n}`,
    mark_text: `Mk${n}z`,
    title: null,
    owner_name: "Dana",
    status: "open",
    type,
    assigned_to: null,
    stage,
    stage_id: stage?.id ?? null,
    stage_entered_at: daysAgo(2),
    ...o,
  }) as unknown as Matter;

type Read = { status: "ok" | "not-set-up"; stages: MatterStage[] } | { status: "unavailable"; error: unknown };

async function render(opts: { matters: Matter[]; read: Read; params?: { group?: string; seg?: string; view?: string; q?: string } }) {
  vi.resetModules();
  vi.doMock("@/lib/matters", async (orig) => ({ ...(await orig<typeof import("@/lib/matters")>()), listMatters: vi.fn(async () => opts.matters) }));
  vi.doMock("@/lib/pipeline", async (orig) => ({ ...(await orig<typeof import("@/lib/pipeline")>()), listLeads: vi.fn(async () => []) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "unconfigured" })) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("@/lib/matters/stages", () => ({ listMatterStages: vi.fn(async () => []), loadMatterStages: vi.fn(async () => opts.read) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "attorney" })) }));
  vi.doMock("@/components/matters/MatterForms", () => ({ NewMatterForm: () => null }));
  vi.doMock("@/app/dashboard/matters/[id]/actions", () => ({ updateMatterStageAction: vi.fn() }));
  vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
  const { default: MattersPage } = await import("../../src/app/dashboard/matters/page");
  return renderToStaticMarkup(await MattersPage({ searchParams: Promise.resolve(opts.params ?? {}) }));
}

const groupNav = (html: string) => {
  const i = html.indexOf('aria-label="Matter group"');
  return i < 0 ? "" : html.slice(i, html.indexOf("</nav>", i));
};
const sample = () => (n = 0, [
  m("TM", S.a),
  m("TM", S.a),
  m("TM", S.b),
  m("CR", S.b),
  m("TM", S.c),
  m("PATENT", S.c),
  m("TM", S.c),
  m("BL", null),
  m("LIT", null),
  m("BL", S.none),
]);
const ok: Read = { status: "ok", stages: Object.values(S) };

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("phase groups on the Matters page", () => {
  it("draws the four group chips with their counts, and the existing status chips as a second row", async () => {
    const html = await render({ matters: sample(), read: ok });
    const nav = groupNav(html);
    expect(nav).toMatch(/>Intake<span class="lp-chip-count">2</);
    expect(nav).toMatch(/>Pre-filing<span class="lp-chip-count">2</);
    expect(nav).toMatch(/>Post-filing<span class="lp-chip-count">3</);
    expect(nav).toMatch(/>Matters<span class="lp-chip-count">3</);
    const status = html.slice(html.indexOf('aria-label="Filter matters"'));
    for (const label of ["Open", "Unassigned", "Closed"]) expect(status).toContain(`>${label}`);
  });

  it("defaults to Pre-filing and lists only its matters", async () => {
    const html = await render({ matters: sample(), read: ok });
    expect(groupNav(html)).toMatch(/aria-current="page"[^>]*>Pre-filing/);
    expect(html).toContain("Mk3z");
    expect(html).toContain("Mk4z");
    expect(html).not.toContain("Mk1z<");
    expect(html).not.toContain("Mk5z<");
  });

  it("falls back to All when Pre-filing is empty for the status, and links agree", async () => {
    n = 0;
    const onlyPost = [m("TM", S.c), m("BL", null)];
    const html = await render({ matters: onlyPost, read: ok });
    expect(groupNav(html)).toMatch(/aria-current="page"[^>]*>All</);
    expect(html).toContain("Mk1z");
    expect(html).toContain("Mk2z");
    // All is the default here, so its chip omits group; Pre-filing becomes the explicit one
    expect(groupNav(html)).toMatch(/href="\/dashboard\/matters\/?"[^>]*>All</);
    expect(groupNav(html)).toMatch(/href="\/dashboard\/matters\/?\?group=pre"[^>]*>Pre-filing/);
    // an explicit, empty group still wins
    const pre = await render({ matters: onlyPost, read: ok, params: { group: "pre" } });
    expect(groupNav(pre)).toMatch(/aria-current="page"[^>]*>Pre-filing/);
  });

  it("?group= picks the group; a bad value is the default", async () => {
    const intake = await render({ matters: sample(), read: ok, params: { group: "intake" } });
    expect(groupNav(intake)).toMatch(/aria-current="page"[^>]*>Intake/);
    expect(intake).toContain("Mk1z");
    const other = await render({ matters: sample(), read: ok, params: { group: "other" } });
    expect(other).toContain("Mk8z");
    expect(other).toContain("Mk9z");
    expect(other).toContain("Mk10z");
    expect(other).not.toContain("Mk3z<");
    const bad = await render({ matters: sample(), read: ok, params: { group: "nope" } });
    expect(groupNav(bad)).toMatch(/aria-current="page"[^>]*>Pre-filing/);
  });

  it("the links keep the group, status, view and search; the default group is left out of the URL", async () => {
    const html = await render({ matters: sample(), read: ok, params: { group: "post", seg: "unassigned", view: "board", q: "x" } });
    expect(html).toMatch(/href="\/dashboard\/matters\/?\?group=intake&amp;seg=unassigned&amp;q=x&amp;view=board"/);
    expect(html).toMatch(/href="\/dashboard\/matters\/?\?seg=unassigned&amp;q=x&amp;view=board"[^>]*>Pre-filing/);
    expect(html).toContain('name="group" value="post"');
  });

  it("group counts follow the status chip, and the other way round", async () => {
    const closed = m("TM", S.b, { status: "closed" });
    const html = await render({ matters: [...sample(), closed], read: ok, params: { seg: "closed" } });
    expect(groupNav(html)).toMatch(/>Pre-filing<span class="lp-chip-count">1</);
    expect(groupNav(html)).toMatch(/>Post-filing<span class="lp-chip-count">0</);
  });

  it("an empty group says so in words", async () => {
    const html = await render({ matters: [m("TM", S.a)], read: ok, params: { group: "pre" } });
    expect(html).toContain("No matters in Pre-filing match these filters.");
  });

  it("All lists every matter exactly once, with the All chip last and counting every matter", async () => {
    const all = sample();
    const html = await render({ matters: all, read: ok, params: { group: "all" } });
    const nav = groupNav(html);
    expect(nav).toMatch(/aria-current="page"[^>]*>All<span class="lp-chip-count">10</);
    expect(nav.lastIndexOf(">All<")).toBeGreaterThan(nav.lastIndexOf(">Matters<"));
    for (let i = 1; i <= 10; i++) expect(html.split(`Mk${i}z<`).length - 1).toBe(1);
    const status = html.slice(html.indexOf('aria-label="Filter matters"'));
    expect(status).toMatch(/>Open<span class="lp-chip-count">10</);
  });

  it("the Matters group has its own empty sentence", async () => {
    const html = await render({ matters: [m("TM", S.a)], read: ok, params: { group: "other" } });
    expect(html).toContain("No contracts or one-offs match these filters.");
    expect(html).not.toContain("No matters in Matters");
  });

  it("the board draws only the group's stages that hold a matter, and names the empty ones in one row", async () => {
    const html = await render({ matters: sample(), read: ok, params: { view: "board" } });
    expect(html).toContain("Questionnaire");
    expect(html).not.toContain("New client");
    expect(html).not.toContain("Published");
    expect(html).toContain("1 empty stage: Balance received");
    expect(html).toContain("· Show");
    expect(html).not.toContain(">None<");
  });

  it("the Matters group board keeps unstaged matters visible and a stage-less stage as a column", async () => {
    const html = await render({ matters: sample(), read: ok, params: { view: "board", group: "other" } });
    expect(html).toContain("Not on the docket yet");
    expect(html).toContain("Misc");
    expect(html).not.toContain("Questionnaire");
  });

  it("a card can be moved to any stage, not only the group's", async () => {
    const html = await render({ matters: sample(), read: ok, params: { view: "board" } });
    expect(html).toContain(">Move</button>");
  });
});

describe("a firm without phases sees today's page", () => {
  const plain = (): MatterStage[] => [st("p1", "Filed", undefined, 1), st("p2", "Done", undefined, 2)];
  it.each([
    ["column missing", { status: "not-set-up", stages: plain() } as Read],
    ["every phase null", { status: "ok", stages: [st("p1", "Filed", null, 1)] } as Read],
  ])("%s: no group chips, every matter listed, no warning", async (_name, read) => {
    const html = await render({ matters: sample(), read });
    expect(html).not.toContain("Matter group");
    expect(html).not.toContain("Pre-filing");
    expect(html).not.toContain("Can&#x27;t show the Intake");
    expect(html).toContain("Mk1z");
    expect(html).toContain("Mk8z");
    expect(html).not.toContain('name="group"');
  });

  it("board view draws every stage as before (empty ones included, no empty-stages row)", async () => {
    const html = await render({ matters: [m("TM", st("p1", "Filed", undefined, 1))], read: { status: "not-set-up", stages: plain() }, params: { view: "board" } });
    expect(html).toContain(">None<");
    expect(html).not.toContain("empty stage");
  });
});

describe("a failed stage read is a failed read", () => {
  it("shows today's page with one plain warning, never 'no phases' and never the chips", async () => {
    const html = await render({ matters: sample(), read: { status: "unavailable", error: new Error("boom") } });
    expect(html).toContain("Can&#x27;t show the Intake, Pre-filing and Post-filing groups right now");
    expect(html).not.toContain("Matter group");
    expect(html).toContain("Mk1z");
    expect(html).not.toContain("boom");
  });
});
