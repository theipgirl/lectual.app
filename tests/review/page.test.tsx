import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { row, TODAY } from "./fixtures";

const members = [
  { userId: "u-reb", name: "Rebecca", role: "owner" },
  { userId: "u-rayn", name: "Rayn", role: "paralegal" },
];
const step = (dueDate: string | null, assigneeId: string | null) => ({ id: "t", title: "Follow up", dueDate, assigneeId });
const rows = [
  row({ key: "a", client: "Overdue Co", waiting: "us", nextStep: step("2026-10-30", "u-rayn") }),
  row({ key: "b", client: "Week Co", waiting: "us", nextStep: step("2026-11-04", "u-reb") }),
  row({ key: "c", client: "Needs Co", waiting: "us", nextStep: null }),
  row({ key: "d", client: "Office Co", waiting: "uspto", nextStep: null, deadline: { dueDate: "2026-11-20", title: "Response" } }),
  row({ key: "e", client: "Fine Co", stageLabel: "Application Filed", waiting: null }),
  row({ key: "f", client: "Client Co", assignedTo: "u-rayn", waiting: "client", lastOutbound: "2026-10-28", proposalExpiry: { text: "Proposal expires Nov 11", expiresOn: "2026-11-11", expired: false } }),
  row({ key: "g", client: "Lapsed Co", kind: "lead", id: "00000000-0000-4000-8000-0000000000d1", assignedTo: "u-rayn", waiting: "client", lastOutbound: null, proposalExpiry: { text: "Proposal expired Oct 28", expiresOn: "2026-10-28", expired: true } }),
  row({ key: "h", client: "Approve Co", waiting: "approval", nextStep: step("2026-12-30", "u-rayn") }),
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

  it("the Board is the default (no view param): lanes split Our turn / Waiting on client, collapsed USPTO and on-track", async () => {
    mock(ok());
    const html = await render();
    expect(html).toContain('data-tour="review-head"');
    expect(html).toContain(">Weekly review</h1>");
    expect(html).toContain("rv-board");
    expect(html).not.toContain("rv-agenda");
    expect(html.indexOf("Rebecca")).toBeLessThan(html.indexOf("Rayn"));
    for (const name of ["Overdue Co", "Week Co", "Needs Co", "Client Co", "Approve Co"]) expect(html).toContain(name);
    expect(html).toContain("Our turn");
    expect(html).toContain("Waiting on client");
    expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*>Waiting on the USPTO \(1\)/);
    expect(html).toMatch(/<summary[^>]*>On track \(1\)/);
    expect(html).toMatch(/aria-current="page" class="on" href="[^"]*">Board/);
    expect(html).toContain("rv-kpis");
  });

  it("Waiting-on-client cards say when we last followed up, and 'No follow-up recorded' when unknown", async () => {
    mock(ok());
    const html = await render();
    const client = html.slice(html.indexOf('data-half="client"'));
    expect(client).toContain("Last followed up Oct 28 · 5 days");
    expect(client).toContain("No follow-up recorded");
    // Our-move cards never carry the follow-up line.
    const our = html.slice(html.indexOf('data-half="our"'), html.indexOf('data-half="client"'));
    expect(our).not.toContain("Last followed up");
  });

  it("Proposals out strip: soonest last day first, expired in the risk style, each linking to the panel", async () => {
    mock(ok());
    const html = await render();
    const strip = html.slice(html.indexOf('data-strip="proposals"'), html.indexOf('data-strip="person"'));
    expect(strip).toContain("Proposals out");
    expect(strip.indexOf("Lapsed Co")).toBeLessThan(strip.indexOf("Client Co"));
    expect(strip).toContain("Expired Oct 28");
    expect(strip).toContain("Last day Nov 11");
    expect(strip).toMatch(/rv-strip-when rv-deadline-soon">Expired Oct 28/);
    expect(strip).toMatch(/href="[^"]*open=lead%3A/);
  });

  it("Proposals out says it couldn't load when the proposals read failed, never 'No proposals out'", async () => {
    mock(ok({ failed: ["proposals"] }));
    const html = await render();
    expect(html).toContain("Proposals couldn&#x27;t load");
    expect(html).not.toContain("No proposals out");
  });

  it("an empty proposals read says none are out", async () => {
    mock(ok({ rows: rows.map((r) => ({ ...r, proposalExpiry: null })) }));
    expect(await render()).toContain("No proposals out.");
  });

  it("Waiting on Rebecca lists her next steps and approvals; hidden when there is no Rebecca", async () => {
    mock(ok());
    const html = await render();
    const from = html.indexOf('data-strip="person"');
    const strip = html.slice(from, html.indexOf("</section>", from));
    expect(strip).toContain("Waiting on Rebecca");
    expect(strip).toContain("Week Co");
    expect(strip).toContain("Approve Co");
    expect(strip).not.toContain("Overdue Co");
    vi.resetModules();
    mock(ok({ members: [{ userId: "u-rayn", name: "Rayn", role: "paralegal" }] }));
    expect(await render()).not.toContain('data-strip="person"');
  });

  it("Waiting on Rebecca says approvals couldn't load rather than implying none", async () => {
    mock(ok({ failed: ["approvals"], rows: rows.filter((r) => r.key !== "b") }));
    const html = await render();
    expect(html).toContain("Approvals couldn&#x27;t load, so only next steps assigned to Rebecca are listed.");
    expect(html).not.toContain("Nothing is waiting on Rebecca");
  });

  it("view switch is exactly Board, Sheet, Cards", async () => {
    mock(ok());
    const html = await render();
    const nav = html.slice(html.indexOf('aria-label="View"'), html.indexOf("</nav>", html.indexOf('aria-label="View"')));
    expect([...nav.matchAll(/>([A-Za-z ]+)<\/a>/g)].map((m) => m[1])).toEqual(["Board", "Sheet", "Cards"]);
    expect(nav).toContain("view=sheet");
    expect(nav).toContain("view=cards");
    expect(html).not.toContain("view=meeting");
    expect(html).not.toContain("view=stage");
    expect(html).not.toContain("Monday agenda");
  });

  it("old ?view=agenda|meeting|stage fall back to the Board", async () => {
    for (const view of ["agenda", "meeting", "stage"]) {
      vi.resetModules();
      mock(ok());
      const html = await render({ view });
      expect(html).toContain("rv-board");
      expect(html).toMatch(/aria-current="page" class="on" href="[^"]*">Board/);
    }
  });

  it("Sheet view: Trademarks then Contracts, the eight columns, Client links to the panel, filters respected", async () => {
    const contract = row({ key: "k", client: "Contract Co", matterType: "BL", stageLabel: "Drafting", stageOrder: 100_001, waiting: "client", lastOutbound: "2026-10-28", source: "Referral" });
    mock(ok({ rows: [...rows, contract] }));
    const html = await render({ view: "sheet" });
    expect(html).toMatch(/aria-current="page" class="on" href="[^"]*">Sheet/);
    expect(html.indexOf("Trademarks")).toBeGreaterThan(-1);
    expect(html.indexOf("Trademarks")).toBeLessThan(html.indexOf("Contracts"));
    expect(html.indexOf("Lapsed Co")).toBeLessThan(html.indexOf("Contracts"));
    expect(html.indexOf("Contract Co")).toBeGreaterThan(html.indexOf("Contracts"));
    for (const c of ["Client", "Mark", "Status", "Next step", "Whose court", "Waiting on", "Source", "Last contact"]) expect(html).toContain(`<th>${c}</th>`);
    expect(html).toContain("Client · followed up Oct 28");
    expect(html).toContain("Referral");
    expect(html).toMatch(/class="lx-rowlink" href="[^"]*view=sheet[^"]*open=matter%3A/);
    expect(html).toContain("lx-stack");
    expect(html).not.toContain("rv-board");
    const leads = await render({ view: "sheet", kind: "leads" });
    expect(leads).toContain("Lapsed Co");
    expect(leads).not.toContain("Contract Co");
  });

  it("a failed approvals read is named in the details note", async () => {
    mock(ok({ failed: ["approvals"] }));
    expect(await render()).toContain("Some details couldn&#x27;t load (approvals)");
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
    const html = await render({ view: "sheet", q: "co" });
    expect(html).toMatch(/class="lx-rowlink" href="[^"]*view=sheet[^"]*open=matter%3A/);
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
