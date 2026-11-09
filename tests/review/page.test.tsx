import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { row, TODAY } from "./fixtures";

const members = [
  { userId: "u-reb", name: "Rebecca", role: "owner" },
  { userId: "u-rayn", name: "Rayn", role: "paralegal" },
];
const step = (dueDate: string | null, assigneeId: string | null) => ({ id: "t", title: "Follow up", dueDate, assigneeId });
const rows = [
  row({ key: "a", client: "Overdue Co", nextStep: step("2026-10-30", "u-rayn") }),
  row({ key: "b", client: "Week Co", nextStep: step("2026-11-04", "u-reb") }),
  row({ key: "c", client: "Needs Co", nextStep: null }),
  row({ key: "d", client: "Office Co", waiting: "uspto", nextStep: null, deadline: { dueDate: "2026-11-20", title: "Response" } }),
  row({ key: "e", client: "Fine Co", stageLabel: "Application Filed" }),
];

function mock(load: unknown, role: string | null = "attorney") {
  vi.doMock("@/lib/review/load", () => ({ loadReview: vi.fn(async () => load) }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => (role ? { kind: "ok", role, user: { id: "u-rayn" } } : { kind: "signed-out", redirectTo: "/" })),
  }));
  vi.doMock("@/app/dashboard/review/actions", () => ({
    setNextStepAction: vi.fn(), completeNextStepAction: vi.fn(), logWhatHappenedAction: vi.fn(), closeLeadAction: vi.fn(),
    updateNextStepAction: vi.fn(), snoozeNextStepAction: vi.fn(), moveStageAction: vi.fn(), assignRecordAction: vi.fn(),
  }));
  vi.doMock("@/lib/review/detail-load", () => ({
    loadReviewDetail: vi.fn(async () => detailResult),
    loadLatestNote: vi.fn(async () => ({ status: "ok", text: "Spoke to the client" })),
  }));
}

let detailResult: unknown = { status: "ok", currentStageId: null, assignedTo: null, cameFrom: null, steps: { ok: true, items: [] }, activity: { ok: true, items: [] }, stages: { ok: true, options: [] } };

/** The toolbar's search box is a form; the cards and the panel are what must not carry one for a viewer. */
const withoutSearch = (html: string) => html.replace(/<form class="lp-search"[\s\S]*?<\/form>/, "");

const ok = (over: object = {}) => ({ status: "ok", rows, today: TODAY, timeZone: "America/New_York", members, failed: [], closeStages: [], ...over });

async function render(params: Record<string, string> = {}) {
  const { default: Page } = await import("../../src/app/dashboard/review/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}

describe("Weekly review page", () => {
  beforeEach(() => vi.resetModules());

  it("exports a page title", async () => {
    mock(ok());
    const mod = await import("../../src/app/dashboard/review/page");
    expect(String(mod.metadata.title)).toBe("Weekly review · Lectual");
  });

  it("the Monday agenda is the default: five numbered sections in the meeting's order, Parked collapsed, owner on each card", async () => {
    mock(ok());
    const html = await render();
    expect(html).toContain("rv-agenda");
    expect(html).not.toContain("rv-board");
    const at = (t: string) => html.indexOf(t);
    expect(at("1. New clients and consults")).toBeGreaterThan(-1);
    expect(at("1. New clients")).toBeLessThan(at("2. Trademarks in progress"));
    expect(at("2. Trademarks in progress")).toBeLessThan(at("3. USPTO matters"));
    expect(at("3. USPTO matters")).toBeLessThan(at("4. Contracts and business matters"));
    expect(at("4. Contracts")).toBeLessThan(at("5. Parked"));
    expect(html).toMatch(/<details[^>]*data-section="parked"[^>]*>\s*<summary[^>]*>[\s\S]*?5\. Parked/);
    expect(html).toMatch(/data-section="new-clients"[\s\S]*Nothing here this week\./);
    // Fine Co is Application Filed with nothing to do: parked, so it comes after the Parked heading.
    expect(at("Fine Co")).toBeGreaterThan(at("5. Parked"));
    // Overdue Co sits in section 2, ahead of Needs Co; the next step's owner is named on the card.
    expect(at("Overdue Co")).toBeLessThan(at("Needs Co"));
    expect(html).toMatch(/rv-card-owner[^>]*><span class="lx-label">Next step<\/span> Rayn/);
    expect(html).toMatch(/rv-card-owner[^>]*><span class="lx-label">Next step<\/span> Unassigned/);
    expect(html).toMatch(/aria-current="page" class="on" href="[^"]*">Monday agenda/);
    expect(html.indexOf("Monday agenda")).toBeLessThan(html.indexOf(">Board<"));
  });

  it("agenda respects the Matters / Leads filter and shows one quiet line for an empty section", async () => {
    const lead = row({ key: "l1", kind: "lead", id: "00000000-0000-4000-8000-0000000000c1", client: "Lead Co", stageLabel: "Proposal Sent" });
    mock(ok({ rows: [...rows, lead] }));
    const leads = await render({ kind: "leads" });
    expect(leads).toContain("Lead Co");
    expect(leads).not.toContain("Overdue Co");
    expect(leads.match(/Nothing here this week\./g)).toHaveLength(4);
  });

  it("board stays reachable at ?view=board: h1, tour hook, KPI strip, lanes, columns, collapsed USPTO and on-track", async () => {
    mock(ok());
    const html = await render({ view: "board" });
    expect(html).toContain('data-tour="review-head"');
    expect(html).toContain(">Weekly review</h1>");
    expect(html).toContain("rv-kpis");
    expect(html).toContain("Waiting on the USPTO");
    expect(html.indexOf("Rebecca")).toBeLessThan(html.indexOf("Rayn"));
    for (const name of ["Overdue Co", "Week Co", "Needs Co"]) expect(html).toContain(name);
    expect(html).toContain("rv-board");
    expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*>Waiting on the USPTO \(1\)/);
    expect(html).toMatch(/<summary[^>]*>On track \(1\)/);
    expect(html).toMatch(/aria-current="page" class="on" href="[^"]*">Board/);
  });

  it("view switch links to the three views", async () => {
    mock(ok());
    const html = await render();
    expect(html).toContain("view=board");
    expect(html).toContain("view=meeting");
    expect(html).toContain("view=stage");
  });

  it("KPI tile is a dash and 'Couldn't load' when approvals failed, never 0", async () => {
    mock(ok({ failed: ["approvals"] }));
    const html = await render();
    expect(html).toMatch(/Waiting on approval<\/span><span[^>]*>—<\/span><span[^>]*>Couldn&#x27;t load/);
    expect(html).toContain("Some details couldn&#x27;t load (approvals)");
  });

  it("meeting mode shows one card, progress and server-rendered Prev/Next", async () => {
    mock(ok());
    const html = await render({ view: "meeting", i: "2" });
    expect(html).toContain("2 of 4");
    expect(html).toContain("Trademarks in progress");
    expect(html).toContain("Last contact");
    expect(html).toMatch(/href="\/dashboard\/review\/?\?view=meeting"[^>]*>Previous/);
    expect(html).toMatch(/href="\/dashboard\/review\/?\?view=meeting&amp;i=3"[^>]*>Keep and go to next/);
    expect(html).toContain("Open details");
  });

  it("meeting mode past the end clamps to the last card", async () => {
    mock(ok());
    expect(await render({ view: "meeting", i: "99" })).toContain("4 of 4");
  });

  it("stage view groups by stage with counts", async () => {
    mock(ok());
    const html = await render({ view: "stage" });
    expect(html).toContain("Application Filed");
    expect(html).toContain("Application Preparation");
    expect(html).toMatch(/\d matters? · \d need attention/);
  });

  it("a failed critical source is one alert and no sections", async () => {
    mock({ status: "unavailable", failed: ["tasks"] });
    const html = await render();
    expect(html).toContain("tasks couldn&#x27;t load");
    expect(html).not.toContain("rv-board");
    expect(html).not.toContain("Needs a next step");
  });

  it("a viewer sees no Done button or form anywhere", async () => {
    mock(ok(), "viewer");
    const html = await render();
    expect(withoutSearch(html)).not.toContain("<form");
    expect(html).toContain("Overdue Co");
    expect(html).toContain(">Open<");
  });

  it("an editor gets Done and Open on a card, and no form inside any card link", async () => {
    mock(ok());
    const html = await render();
    expect(html).toContain(">Done<");
    expect(html).not.toContain("Set next step");
    expect(html).not.toContain("<details class=\"rv-act\"");
    for (const m of html.matchAll(/<a class="rv-card-link"[\s\S]*?<\/a>/g)) {
      expect(m[0]).not.toMatch(/<form|<button|<input|<select|<textarea/);
    }
  });

  it("a card is a link that opens the panel and keeps the other review params", async () => {
    mock(ok());
    const html = await render({ view: "stage", q: "co" });
    expect(html).toMatch(/class="lx-rowlink" href="[^"]*view=stage[^"]*open=matter%3A/);
    const board = await render({ kind: "matters" });
    expect(board).toMatch(/class="rv-card-link" href="[^"]*kind=matters[^"]*open=matter%3A/);
  });

  it("card count per column and at most two tags then +N", async () => {
    mock(ok({ rows: [row({ key: "t", client: "Tag Co", nextStep: step("2026-10-30", "u-rayn"), deadline: { dueDate: "2026-11-10", title: null }, proposalExpiry: { text: "Proposal expires Nov 4", expiresOn: "2026-11-04", expired: false } })] }));
    const html = await render();
    expect(html).toContain("+1");
  });

  it("empty states are never a blank page", async () => {
    mock(ok({ rows: [] }));
    expect(await render()).toContain("Nothing to review");
  });

  describe("detail panel", () => {
    const ID = "00000000-0000-4000-8000-000000000001";
    const lead = row({ key: "l1", kind: "lead", id: ID, client: "Lead Co", nextStep: step("2026-11-04", "u-reb") });
    const detailOk = { status: "ok", currentStageId: "s1", assignedTo: "u-reb", cameFrom: "Referral", steps: { ok: true, items: [{ id: "t", title: "Follow up", dueDate: "2026-11-04", assigneeId: "u-reb" }, { id: "t2", title: "Send form", dueDate: null, assigneeId: null }] }, activity: { ok: true, items: [{ id: "a1", type: "note", actor_type: "user", created_at: "2026-10-31T15:00:00Z", payload: { note: "Spoke to the client" } }] }, stages: { ok: true, options: [{ id: "s1", name: "Proposal" }, { id: "s2", name: "Hired" }] } };
    const stages = [{ id: "00000000-0000-4000-8000-0000000000aa", name: "Nurture 2027", category: "nurture" }];

    it("renders for a valid open param with facts, editable next step, snooze, other steps, stage, owner, note, activity", async () => {
      detailResult = detailOk;
      mock(ok({ rows: [lead], closeStages: stages }));
      const html = await render({ open: `lead:${ID}` });
      expect(html).toContain('role="dialog"');
      expect(html).toContain("Lead Co");
      expect(html).toContain("Referral");
      expect(html).toMatch(/name="title"[^>]*value="Follow up"/);
      expect(html).toMatch(/name="dueAt"[^>]*value="2026-11-04"/);
      for (const w of ["Tomorrow", "Next Monday", "In 2 weeks", "Add another next step", "Send form", "Move stage", "Log what happened", "Recent activity", "Spoke to the client", "Lost / Nurture"]) expect(html).toContain(w);
      expect(html).toContain("Open the full lead page");
      expect(html).toMatch(/data-close[^>]*href="\/dashboard\/review\/?"|href="\/dashboard\/review\/?"[^>]*data-close/);
      expect(html).not.toContain("Hired</option><option");
    });
    it("a foreign or missing id reads 'couldn't be found' with a close link and no record data", async () => {
      detailResult = { status: "missing" };
      mock(ok({ rows: [lead] }));
      const html = await render({ open: `lead:${ID}` });
      expect(html).toContain("This record couldn&#x27;t be found.");
      expect(html).toContain("data-close");
      expect(html).not.toContain('name="title"');
    });
    it("a failed read is its own sentence, never 'not found'", async () => {
      detailResult = { status: "unavailable" };
      mock(ok({ rows: [lead] }));
      const html = await render({ open: `lead:${ID}` });
      expect(html).toContain("couldn&#x27;t be loaded");
      expect(html).not.toContain("couldn&#x27;t be found");
    });
    it("a bad open param opens nothing", async () => {
      detailResult = detailOk;
      mock(ok({ rows: [lead] }));
      const html = await render({ open: "lead:not-a-uuid" });
      expect(html).not.toContain('role="dialog"');
    });
    it("a viewer sees the facts and no form", async () => {
      detailResult = detailOk;
      mock(ok({ rows: [lead], closeStages: stages }), "viewer");
      const html = await render({ open: `lead:${ID}` });
      expect(html).toContain('role="dialog"');
      expect(html).toContain("Follow up");
      const panel = html.slice(html.indexOf('role="dialog"'));
      expect(panel).not.toContain("<form");
      expect(panel).not.toContain("<textarea");
    });
    it("optional reads that failed say so", async () => {
      detailResult = { ...detailOk, steps: { ok: false }, activity: { ok: false }, stages: { ok: false } };
      mock(ok({ rows: [lead] }));
      const html = await render({ open: `lead:${ID}` });
      expect(html).toContain("Recent activity couldn&#x27;t load.");
      expect(html).toContain("Other steps couldn&#x27;t load.");
      expect(html).toContain("Stages couldn&#x27;t load.");
    });
    it("Lost / Nurture shows for a lead only and not without such stages", async () => {
      detailResult = detailOk;
      mock(ok({ rows: [lead], closeStages: [] }));
      expect(await render({ open: `lead:${ID}` })).not.toContain("Lost / Nurture");
      const m = row({ key: "m1", kind: "matter", id: ID, client: "Matter Co" });
      mock(ok({ rows: [m], closeStages: stages }));
      expect(await render({ open: `matter:${ID}` })).not.toContain("Lost / Nurture");
    });
  });

  describe("cards view", () => {
    const rowsC = [
      row({ key: "a", client: "Overdue Co", nextStep: step("2026-10-30", "u-rayn") }),
      row({ key: "b", client: "Week Co", nextStep: step("2026-11-04", "u-rayn") }),
      row({ key: "c", client: "Reb Co", nextStep: step("2026-10-29", "u-reb") }),
    ];
    it("renders the deck for the default person (the one named Rebecca) with chips, progress and big buttons", async () => {
      mock(ok({ rows: rowsC }));
      const html = await render({ view: "cards" });
      expect(html).toContain("Whose cards");
      expect(html.indexOf("Rebecca")).toBeLessThan(html.indexOf("Rayn"));
      expect(html).toContain("1 of 1");
      expect(html).toContain("Reb Co");
      expect(html).not.toContain("Overdue Co</a></h2>");
      for (const w of ["Done", "Snooze: Tomorrow", "Snooze: Next Monday", "Hand to", "Add note", "Open"]) expect(html).toContain(w);
      expect(html).toContain("Latest note: Spoke to the client");
      expect(html).toMatch(/aria-current="page"[^>]*>[\s\S]*?Rebecca/);
    });
    it("person param picks another deck, i clamps, Back and Skip are links", async () => {
      mock(ok({ rows: rowsC }));
      const p = "u-rayn";
      // person must be a uuid: use the members' ids through a uuid-shaped fixture
      const html = await render({ view: "cards", person: p, i: "9" });
      expect(html).toContain("1 of 1"); // non-uuid person is ignored, default deck
      const two = [
        { userId: "00000000-0000-4000-8000-0000000000b1", name: "Rebecca", role: "owner" },
        { userId: "00000000-0000-4000-8000-0000000000b2", name: "Rayn", role: "paralegal" },
      ];
      const rr = [
        row({ key: "a", client: "A Co", nextStep: { id: "t", title: "x", dueDate: "2026-10-30", assigneeId: two[1].userId } }),
        row({ key: "b", client: "B Co", nextStep: { id: "t", title: "y", dueDate: "2026-11-04", assigneeId: two[1].userId } }),
      ];
      vi.resetModules();
      mock(ok({ rows: rr, members: two }));
      const deck = await render({ view: "cards", person: two[1].userId, i: "9" });
      expect(deck).toContain("2 of 2");
      expect(deck).toMatch(/data-deck-prev/);
      expect(deck).not.toMatch(/data-deck-next/);
    });
    it("an empty deck says so", async () => {
      mock(ok({ rows: [row({ key: "z", client: "Z", nextStep: step("2026-12-30", "u-reb") })] }));
      const html = await render({ view: "cards", person: "00000000-0000-4000-8000-00000000ffff" });
      expect(html).toMatch(/Nothing on Rebecca&#x27;s cards right now\./);
    });
    it("a viewer sees the card with no action forms", async () => {
      mock(ok({ rows: rowsC }), "viewer");
      const html = await render({ view: "cards" });
      expect(html).toContain("Reb Co");
      expect(withoutSearch(html)).not.toContain("<form");
    });
    it("shows a fixed notice after a refused action", async () => {
      mock(ok({ rows: rowsC }));
      expect(await render({ view: "cards", notice: "denied" })).toContain("You don&#x27;t have permission");
      expect(await render({ view: "cards", notice: "<script>" })).not.toContain("<script>alert");
    });
  });
});
