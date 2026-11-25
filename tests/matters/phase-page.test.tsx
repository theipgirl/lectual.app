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
  // The firm's signed-engagement stage: the Matters page draws from here on. (A firm with none cuts nothing: see below.)
  hired: st("sh", "Signed LOE / Deposit Received", "pipeline", 1.5),
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

async function render(opts: { matters: Matter[]; read: Read; params?: { group?: string; seg?: string; view?: string; q?: string; intake?: string; kind?: string } }) {
  vi.resetModules();
  vi.doMock("@/lib/matters", async (orig) => ({ ...(await orig<typeof import("@/lib/matters")>()), listMatters: vi.fn(async () => opts.matters) }));
  vi.doMock("@/lib/pipeline", async (orig) => ({ ...(await orig<typeof import("@/lib/pipeline")>()), listLeads: vi.fn(async () => []) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "unconfigured" })) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("@/lib/matters/stages", () => ({ listMatterStages: vi.fn(async () => []), loadMatterStages: vi.fn(async () => opts.read) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "attorney" })) }));
  // The firm's saved layout isn't switched on in these fixtures (a failed read is its own, separate test).
  vi.doMock("@/lib/views/layout/load", () => ({ loadViewLayout: vi.fn(async () => ({ status: "not-set-up" })) }));
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
  // A trademark on a stage with no phase: the Matters view's "Matters" group.
  m("TM", S.none),
]);
const ok: Read = { status: "ok", stages: Object.values(S) };

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("phase groups on the Matters page", () => {
  it("draws the three group chips plus All, with their counts, and the existing status chips as a second row; no Intake chip", async () => {
    const html = await render({ matters: sample(), read: ok });
    const nav = groupNav(html);
    expect(nav).not.toContain(">Intake<");
    expect(nav).toMatch(/>Pre-filing<span class="lp-chip-count">2</);
    expect(nav).toMatch(/>Post-filing<span class="lp-chip-count">3</);
    // Contracts are their own view now: the "Matters" group holds the trademarks on a stage with no phase.
    expect(nav).toMatch(/>Matters<span class="lp-chip-count">1</);
    const kinds = html.slice(html.indexOf('aria-label="Kind of matter"'), html.indexOf("</nav>", html.indexOf('aria-label="Kind of matter"')));
    expect(kinds).toMatch(/aria-current="page"[^>]*>Matters<span class="lp-chip-count">6</);
    expect(kinds).toMatch(/href="\/dashboard\/matters\/?\?kind=contracts"[^>]*>Contracts<span class="lp-chip-count">3</);
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
    const onlyPost = [m("TM", S.c), m("TM", S.none)];
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

  it("?group= picks the group; a bad value, and the retired intake, are the default", async () => {
    const intake = await render({ matters: sample(), read: ok, params: { group: "intake" } });
    expect(groupNav(intake)).toMatch(/aria-current="page"[^>]*>Pre-filing/);
    expect(intake).not.toContain("Mk1z<");
    const other = await render({ matters: sample(), read: ok, params: { group: "other" } });
    expect(other).toContain("Mk11z");
    expect(other).not.toContain("Mk8z");
    expect(other).not.toContain("Mk3z<");
    const bad = await render({ matters: sample(), read: ok, params: { group: "nope" } });
    expect(groupNav(bad)).toMatch(/aria-current="page"[^>]*>Pre-filing/);
  });

  it("the links keep the group, status, view and search; the default group is left out of the URL", async () => {
    const html = await render({ matters: sample(), read: ok, params: { group: "post", seg: "unassigned", view: "table", q: "x" } });
    expect(html).toMatch(/href="\/dashboard\/matters\/?\?group=all&amp;seg=unassigned&amp;q=x&amp;view=table"/);
    expect(html).toMatch(/href="\/dashboard\/matters\/?\?seg=unassigned&amp;q=x&amp;view=table"[^>]*>Pre-filing/);
    expect(html).toContain('name="group" value="post"');
  });

  it("group counts follow the status chip, and the other way round", async () => {
    const closed = m("TM", S.b, { status: "closed" });
    const html = await render({ matters: [...sample(), closed], read: ok, params: { seg: "closed" } });
    expect(groupNav(html)).toMatch(/>Pre-filing<span class="lp-chip-count">1</);
    expect(groupNav(html)).toMatch(/>Post-filing<span class="lp-chip-count">0</);
  });

  it("an empty group says so in words", async () => {
    const html = await render({ matters: [m("TM", S.c)], read: ok, params: { group: "pre" } });
    expect(html).toContain("No matters in Pre-filing match these filters.");
  });

  it("All means past Signed LOE: every matter outside intake-phase stages exactly once, with the All chip last", async () => {
    const all = sample();
    const html = await render({ matters: all, read: ok, params: { group: "all" } });
    const nav = groupNav(html);
    expect(nav).toMatch(/aria-current="page"[^>]*>All<span class="lp-chip-count">6</);
    expect(nav.lastIndexOf(">All<")).toBeGreaterThan(nav.lastIndexOf(">Matters<"));
    for (const i of [3, 4, 5, 6, 7, 11]) expect(html.split(`Mk${i}z<`).length - 1).toBe(1);
    // the intake matters are cut, and the contracts (8 to 10) are the Contracts view's
    for (const i of [1, 2, 8, 9, 10]) expect(html).not.toContain(`Mk${i}z<`);
    const status = html.slice(html.indexOf('aria-label="Filter matters"'));
    expect(status).toMatch(/>Open<span class="lp-chip-count">6</);
  });

  it("matters in intake stages are named in one quiet line with a Show them link, not silently dropped", async () => {
    const html = await render({ matters: sample(), read: ok });
    expect(html).toContain("2 matters are in intake stages · ");
    expect(html).toMatch(/<a href="\/dashboard\/matters\/?\?intake=1">Show them<\/a>/);
    n = 0;
    const one = await render({ matters: [m("TM", S.a), m("TM", S.b)], read: ok });
    expect(one).toContain("1 matter is in intake stages");
    const none = await render({ matters: [m("TM", S.b)], read: ok });
    expect(none).not.toContain("in intake stages");
  });

  it("Show them lists the intake matters, and only those, with a way back", async () => {
    const html = await render({ matters: sample(), read: ok, params: { intake: "1", view: "table" } });
    expect(html).toContain("Showing matters still in intake stages.");
    expect(html).toContain("Mk1z");
    expect(html).toContain("Mk2z");
    expect(html).not.toContain("Mk3z<");
    expect(html).not.toContain("Matter group");
    expect(html).toMatch(/<a href="\/dashboard\/matters\/?\?view=table">Back to matters<\/a>/);
  });

  it("the intake line follows the chip in use and, with a search, counts the matches only", async () => {
    const closed = await render({ matters: sample(), read: ok, params: { seg: "closed" } });
    expect(closed).not.toContain("in intake stages");
    n = 0;
    const found = await render({ matters: sample(), read: ok, params: { q: "Mk1z" } });
    expect(found).toContain("1 matching matter is in intake stages");
  });

  it("Closed: a closed matter on an intake stage is named on the Closed chip, and Show them keeps the chip", async () => {
    n = 0;
    const list = [m("TM", S.a, { status: "closed" }), m("TM", S.c, { status: "closed" }), m("TM", S.a)];
    const html = await render({ matters: list, read: ok, params: { seg: "closed", view: "table" } });
    expect(html).toContain("1 matter is in intake stages · ");
    expect(html).toMatch(/<a href="\/dashboard\/matters\/?\?intake=1&amp;seg=closed&amp;view=table">Show them<\/a>/);
    n = 0;
    const shown = await render({ matters: [m("TM", S.a, { status: "closed" }), m("TM", S.c, { status: "closed" }), m("TM", S.a)], read: ok, params: { seg: "closed", intake: "1", view: "table" } });
    expect(shown).toContain("Mk1z");
    expect(shown).not.toContain("Mk3z");
  });

  it("Unassigned: intake matters left out of the Unassigned chip are counted there too", async () => {
    n = 0;
    const list = [m("TM", S.a), m("TM", S.a, { assigned_to: "u1" } as Partial<Matter>), m("TM", S.c)];
    const html = await render({ matters: list, read: ok, params: { seg: "unassigned" } });
    expect(html).toContain("1 matter is in intake stages · ");
    expect(html).toMatch(/\?intake=1&amp;seg=unassigned">Show them<\/a>/);
  });

  it("phases with no signed-engagement stage say so in one quiet warn line; with one, nothing is said", async () => {
    n = 0;
    const { hired: _hired, ...noHired } = S;
    void _hired;
    const without = await render({ matters: sample(), read: { status: "ok", stages: Object.values(noHired) } });
    expect(without).toContain("No signed-engagement stage was found");
    n = 0;
    const withIt = await render({ matters: sample(), read: ok });
    expect(withIt).not.toContain("No signed-engagement stage was found");
  });

  it("when every matter is in an intake stage the empty state says so, not 'match these filters'", async () => {
    n = 0;
    const html = await render({ matters: [m("TM", S.a), m("TM", S.a)], read: ok, params: { view: "table" } });
    expect(html).toContain("No matters past intake yet");
    expect(html).not.toContain("match these filters");
    expect(html).toContain("2 matters are in intake stages");
  });

  it("a contract is not on the Matters view at all, and the Contracts view is never cut by the signed-engagement line", async () => {
    n = 0;
    const list = () => (n = 0, [m("BL", S.a), m("BL", null), m("TM", S.c)]);
    const matters = await render({ matters: list(), read: ok, params: { group: "all", view: "table" } });
    expect(matters).toContain("Mk3z");
    expect(matters).not.toContain("Mk1z<");
    expect(matters).not.toContain("Mk2z<");
    expect(matters).not.toContain("in intake stages");
    const contracts = await render({ matters: list(), read: ok, params: { kind: "contracts", view: "table" } });
    expect(contracts).toContain("Mk1z");
    expect(contracts).toContain("Mk2z");
    expect(contracts).not.toContain("Mk3z<");
    expect(contracts).not.toContain("in intake stages");
    expect(contracts).not.toContain("Matter group");
  });

  it("the board draws no intake-phase column or card, and the Move menu offers no intake stage", async () => {
    const html = await render({ matters: sample(), read: ok, params: { view: "board", group: "all" } });
    expect(html).not.toContain("New client");
    expect(html).not.toContain("Mk1z<");
    expect(html).toContain("Questionnaire");
    expect(html).toContain("Published");
  });

  it("the stage's name never decides: a pipeline stage named 'Filed' is intake, a pre_filing one named 'Intake review' is drawn", async () => {
    n = 0;
    const tricky = [st("x1", "Intake review", "pre_filing", 1), st("x2", "Filed", "pipeline", 2), st("x3", "Signed LOE / Deposit Received", "pipeline", 3)];
    const html = await render({ matters: [m("TM", tricky[0]), m("TM", tricky[1])], read: { status: "ok", stages: tricky }, params: { group: "all" } });
    expect(html).toContain("Mk1z");
    expect(html).not.toContain("Mk2z<");
    expect(html).toContain("1 matter is in intake stages");
  });

  it("a card can be moved to any stage, not only the group's", async () => {
    const html = await render({ matters: sample(), read: ok, params: { view: "board" } });
    // Sprint 10: each card's ⋯ menu holds Move to stage… (the old Move button moved into it).
    expect(html).toContain('aria-label="More for ');
  });

  describe("RPB's real docket (lectual-prod phases, Nov 17)", () => {
    const rpb = [
      ...[1, 2, 3, 4, 5, 6].map((c) => st(`c${c}`, `Intake ${c}`, "pipeline", c - 1)),
      st("c7", "Signed LOE / Deposit Received", "pipeline", 6),
      st("c8", "Application Preparation", "pre_filing", 7),
      st("c17", "Application Filed", "post_filing", 16),
      st("c23", "Abandoned", "inactive", 22, false),
      st("c24", "Trademark Registered", "maintenance", 23, false),
      st("c25", "Lost/Nurture", null, 24, false),
    ];
    const read: Read = { status: "ok", stages: rpb };
    const byId = Object.fromEntries(rpb.map((s) => [s.id, s]));
    const board = () => (n = 0, [m("TM", byId.c1), m("TM", byId.c6), m("TM", byId.c7), m("TM", byId.c8), m("TM", byId.c17), m("TM", byId.c24, { status: "closed" }), m("TM", byId.c25, { status: "closed" }), m("TM", byId.c23, { status: "closed" })]);

    it("codes 1 to 6 are intake and named; Signed LOE (also pipeline) stays visible, as Pre-filing", async () => {
      const html = await render({ matters: board(), read, params: { group: "pre", view: "table" } });
      expect(html).toContain("2 matters are in intake stages");
      expect(html).not.toContain("Mk1z<");
      expect(html).not.toContain("Mk2z<");
      expect(html).toContain("Mk3z");
      expect(html).toContain("Mk4z");
      expect(groupNav(html)).toMatch(/>Pre-filing<span class="lp-chip-count">2</);
    });

    it("the board draws the Signed LOE column and no intake column", async () => {
      const html = await render({ matters: board(), read, params: { group: "all", view: "board" } });
      expect(html).toContain("Signed LOE / Deposit Received");
      expect(html).not.toContain("Intake 1");
      expect(html).not.toContain("Intake 6");
    });

    it("a null phase (Lost/Nurture) does not crash, is not intake, and shows under All and Closed", async () => {
      const open = await render({ matters: board(), read, params: { group: "all", view: "table" } });
      expect(open).not.toContain("Mk7z<");
      const closed = await render({ matters: board(), read, params: { group: "all", seg: "closed", view: "table" } });
      expect(closed).toContain("Mk7z");
      expect(closed).not.toContain("in intake stages");
    });

    it("inactive and maintenance (closed) stages are not intake either and show under All / Closed", async () => {
      const closed = await render({ matters: board(), read, params: { group: "all", seg: "closed", view: "table" } });
      expect(closed).toContain("Mk6z");
      expect(closed).toContain("Mk8z");
    });
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
    expect(html).not.toContain('name="group"');
    // a contract is on the Contracts view
    expect(await render({ matters: sample(), read, params: { kind: "contracts" } })).toContain("Mk8z");
  });

  it("board view draws every stage as before (empty ones included, no empty-stages row)", async () => {
    const html = await render({ matters: [m("TM", st("p1", "Filed", undefined, 1))], read: { status: "not-set-up", stages: plain() }, params: { view: "board" } });
    expect(html).toContain("No matters here yet.");
    expect(html).not.toContain("empty stage");
  });
});

describe("a failed stage read is a failed read", () => {
  it("shows today's page with one plain warning, never 'no phases' and never the chips", async () => {
    const html = await render({ matters: sample(), read: { status: "unavailable", error: new Error("boom") } });
    expect(html).toContain("Can&#x27;t show the Pre-filing and Post-filing groups right now");
    expect(html).not.toContain("Matter group");
    expect(html).toContain("Mk1z");
    expect(html).not.toContain("boom");
  });
});
