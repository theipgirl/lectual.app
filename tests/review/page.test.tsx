import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { row, TODAY } from "./fixtures";
import { Tags } from "@/components/review/shared";
import { NOW, TZ, facts as stepFacts } from "../lead-step/fixtures";

// The opened card draws the upload control for writers; it holds a router for its refresh.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/dashboard/review/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: async () => ({}) }));

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
  row({ key: "f", client: "Client Co", assignedTo: "u-rayn", waiting: "client", lastOutbound: "2026-10-28", lastOutboundType: "email_sent", proposalExpiry: { text: "Proposal expires Nov 11", expiresOn: "2026-11-11", expired: false } }),
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
    updateNextStepAction: vi.fn(), snoozeNextStepAction: vi.fn(), moveStageAction: vi.fn(), assignRecordAction: vi.fn(), setSourceAction: vi.fn(),
  }));
  vi.doMock("@/lib/record-card/load", () => ({ loadRecordCard: cardLoader }));
  vi.doMock("@/lib/review/detail-load", () => ({
    loadLatestNote: vi.fn(async () => ({ status: "ok", text: "Spoke to the client" })),
    loadDeckDocuments: vi.fn(async () => ({ ok: true, read: { files: { status: "ok", files: [], capped: false }, letters: null } })),
  }));
}

// What `loadRecordCard` answers for the opened card (the review no longer has a loader of its own).
let cardResult: unknown = { status: "not-found" };
const cardLoader = vi.fn(async () => cardResult);

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
    expect(html).toMatch(/aria-current="page" href="[^"]*">Board/);
    expect(html).toContain("rv-kpis");
  });

  it("every card carries the timeline line (newest thing sent); Waiting-on-client cards add how long ago", async () => {
    mock(ok());
    const html = await render();
    const client = html.slice(html.indexOf('data-half="client"'));
    expect(client).toContain("Sent Oct 28 · email · 5 days");
    expect(client).toContain("Nothing sent yet");
    // An Our-turn card has the line too, without the day count.
    const our = html.slice(html.indexOf('data-half="our"'), html.indexOf('data-half="client"'));
    expect(our).toContain("rv-card-sent");
    expect(our).not.toMatch(/Sent [A-Z][a-z]{2} \d+ · (email|call) · \d+ days?/);
  });

  it("a failed contact read says the sent line couldn't load, never 'Nothing sent yet'", async () => {
    mock(ok({ rows: [row({ key: "x", client: "Unread Co", waiting: "us", contactKnown: false, lastContact: null, lastOutbound: null, nextStep: step("2026-10-30", "u-rayn") })] }));
    const html = await render();
    expect(html).toContain("Sent: couldn&#x27;t load");
    expect(html).not.toContain("Nothing sent yet");
  });

  it("Proposals are not part of the first wave: no Proposals out strip and no expiry tag anywhere, but the cards still draw", async () => {
    mock(ok());
    const html = await render();
    expect(html).not.toContain("Proposals out");
    expect(html).not.toContain('data-strip="proposals"');
    expect(html).not.toMatch(/Proposal expire/);
    expect(html).toContain("Client Co");
    const sheet = await render({ view: "sheet" });
    expect(sheet).not.toMatch(/Proposal expire/);
  });

  it("a person's lane is an h2, its two lists are h3s over two separate lists, and the count covers cards only", async () => {
    mock(ok());
    const html = await render();
    expect(html).toMatch(/<h2 class="lx-board-title lx-board-heading">Rayn<\/h2>/);
    expect(html).toMatch(/<h3 class="rv-lane-head lx-label">Our turn · 2<\/h3>/);
    expect(html).toMatch(/<h3 class="rv-lane-head lx-label">Waiting on client · 2<\/h3>/);
    expect(html).not.toMatch(/<li[^>]*rv-lane-head/);
    // Rayn: 2 our + 2 client cards = 4 (the headings are not counted), and the count says what it covers.
    expect(html).toMatch(/title="Cards in this column: our turn plus waiting on client">4</);
    const lane = html.slice(html.indexOf('data-lane="u-rayn"'), html.indexOf('data-lane="none"') > 0 ? html.indexOf('data-lane="none"') : undefined);
    expect(lane.split('<li class="lx-board-card').length - 1).toBe(4);
  });

  it("no review person and not an approver: no empty strips wrapper is drawn", async () => {
    mock(ok({ members: [{ userId: "u-rayn", name: "Rayn", role: "paralegal" }] }), "paralegal");
    const html = await render();
    expect(html).not.toContain("rv-strips");
  });

  it("each person's column says how much they hold, split into overdue and due this week", async () => {
    mock(ok());
    const html = await render();
    expect(html).toContain('aria-label="Rayn · 4, 1 overdue"');
    expect(html).toContain('aria-label="Rebecca · 1, 1 due this week"');
    expect(html).toMatch(/data-lane-load[^>]*>1 overdue</);
  });

  it("Waiting on Rebecca lists her next steps and approvals; hidden when there is no Rebecca", async () => {
    mock(ok(), "paralegal");
    const html = await render();
    const from = html.indexOf('data-strip="person"');
    const strip = html.slice(from, html.indexOf("</section>", from));
    expect(strip).toContain("Waiting on Rebecca");
    expect(strip).toContain("Week Co");
    expect(strip).toContain("Approve Co");
    expect(strip).not.toContain("Overdue Co");
    vi.resetModules();
    mock(ok({ members: [{ userId: "u-rayn", name: "Rayn", role: "paralegal" }] }), "paralegal");
    expect(await render()).not.toContain('data-strip="person"');
  });

  it("Waiting on Rebecca says approvals couldn't load rather than implying none", async () => {
    mock(ok({ failed: ["approvals"], rows: rows.filter((r) => r.key !== "b") }), "paralegal");
    const html = await render();
    expect(html).toContain("Approvals couldn&#x27;t load, so only next steps assigned to Rebecca are listed.");
    expect(html).not.toContain("Nothing is waiting on Rebecca");
  });

  it("an approver gets Waiting on you, even with no Rebecca; the failed-approvals sentence stays", async () => {
    mock(ok({ failed: ["approvals"], members: [{ userId: "u-rayn", name: "Rayn", role: "attorney" }] }));
    const html = await render();
    expect(html).toContain("Waiting on you");
    expect(html).not.toContain("Waiting on Rebecca");
    expect(html).toContain("only next steps assigned to you are listed.");
  });

  it("view switch is exactly Board, List, Cards", async () => {
    mock(ok());
    const html = await render();
    const nav = html.slice(html.indexOf('aria-label="View"'), html.indexOf("</nav>", html.indexOf('aria-label="View"')));
    expect([...nav.matchAll(/>([A-Za-z ]+)<\/a>/g)].map((m) => m[1])).toEqual(["Board", "List", "Cards"]);
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
      expect(html).toMatch(/aria-current="page" href="[^"]*">Board/);
    }
  });

  it("Sheet view: Trademarks then Contracts, the eight columns, Client links to the panel, filters respected", async () => {
    const contract = row({ key: "k", client: "Contract Co", matterType: "BL", stageLabel: "Drafting", stageOrder: 100_001, waiting: "client", lastOutbound: "2026-10-28", source: "Referral" });
    mock(ok({ rows: [...rows, contract] }));
    const html = await render({ view: "sheet" });
    expect(html).toMatch(/aria-current="page" href="[^"]*">List/);
    expect(html.indexOf("Trademarks")).toBeGreaterThan(-1);
    expect(html.indexOf("Trademarks")).toBeLessThan(html.indexOf("Contracts"));
    expect(html.indexOf("Lapsed Co")).toBeLessThan(html.indexOf("Contracts"));
    expect(html.indexOf("Contract Co")).toBeGreaterThan(html.indexOf("Contracts"));
    for (const c of ["Client", "Mark", "Status", "Next step", "Owner", "Waiting on", "Source", "Last contact"]) expect(html).toContain(`<th>${c}</th>`);
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
    for (const m of html.matchAll(/<a class="lx-rowlink"[\s\S]*?<\/a>/g)) {
      expect(m[0]).not.toMatch(/<form|<button|<input|<select|<textarea/);
    }
  });

  it("a card is a link that opens the panel and keeps the other review params", async () => {
    mock(ok());
    const html = await render({ view: "sheet", q: "co" });
    expect(html).toMatch(/class="lx-rowlink" href="[^"]*view=sheet[^"]*open=matter%3A/);
    const board = await render({ kind: "matters" });
    expect(board).toMatch(/class="lx-rowlink" href="[^"]*kind=matters[^"]*open=matter%3A/);
  });

  it("at most two tags then +N (a board card leaves out the tags its column and meta line already say)", async () => {
    const r = row({ key: "t", client: "Tag Co", waiting: "us", nextStep: step("2026-10-30", "u-rayn"), deadline: { dueDate: "2026-11-10", title: null }, proposalExpiry: { text: "Proposal expires Nov 4", expiresOn: "2026-11-04", expired: false } });
    expect(renderToStaticMarkup(<Tags row={r} today={TODAY} max={1} />)).toContain("+1");
    // The proposal expiry is never drawn in the first wave, so two tags fit in two.
    expect(renderToStaticMarkup(<Tags row={r} today={TODAY} max={2} />)).not.toContain("+1");
    mock(ok({ rows: [r] }));
    const html = await render();
    expect(html).toContain("USPTO deadline");
    expect(html).not.toContain("+1");
  });

  it("empty states are never a blank page", async () => {
    mock(ok({ rows: [] }));
    expect(await render()).toContain("Nothing to review");
  });

  describe("the opened record card (one card everywhere: no drawer)", () => {
    const ID = "00000000-0000-4000-8000-000000000001";
    const MID = "00000000-0000-4000-8000-000000000002";
    const KEEPER = "00000000-0000-4000-8000-000000000003";
    const cardMembers = { status: "ok", value: [{ userId: "u-reb", name: "Rebecca" }, { userId: "u-rayn", name: "Rayn" }] };
    const leadStages = { status: "ok", value: [{ id: "s1", name: "Proposal", category: "open" }, { id: "s-lost", name: "Lost 2026", category: "lost" }, { id: "s-won", name: "Hired", category: "won" }] };
    const task = (id: string, title: string, dueAt: string | null, assigneeId: string | null) => ({ id, title, type: "custom", dueAt, assigneeId, createdAt: "2026-10-01T00:00:00Z" });
    const leadLoad = (role: string, id = ID, over: object = {}) => ({
      status: "ok", kind: "lead", role, now: NOW, timeZone: TZ,
      lead: { id, first_name: "Lena", last_name: "Lead", business_name: "Lead Co", mark_text: null, email: "lena@lead.example", phone: null, current_stage_id: "s1", assigned_to: "u-reb", referral_source: "Referral", last_activity_at: null, last_inbound_at: null, last_outbound_at: null, lane: null, lane_set_at: null, ai_summary: null },
      stages: leadStages, members: cardMembers,
      tags: { status: "ok", value: { on: [], catalog: [] } },
      leadStep: { status: "ok", facts: stepFacts({ tasks: { status: "ok", value: [task("t", "Follow up", "2026-11-04T00:00:00Z", "u-reb"), task("t2", "Send form", null, "u-rayn")] } }) },
      approvals: { status: "ok", queueIds: [] },
      proposal: { status: "not-set-up" },
      documents: { status: "ok", value: { files: { status: "ok", files: [], capped: false }, letters: null } },
      temperature: null, mergeAvailable: false, duplicateOf: null, ...over,
    });
    const matterLoad = (role: string) => ({
      status: "ok", kind: "matter", role, now: NOW, timeZone: TZ,
      matter: { id: MID, title: "MATTERCO", mark_text: "MATTERCO", owner_name: "Matter Co", matter_number: "TM-9", stage_id: "m1", assigned_to: "u-reb", referral_source: null },
      stages: { status: "ok", value: [{ id: "m1", label: "Filed" }, { id: "m2", label: "Published" }] }, members: cardMembers,
      tasks: { status: "ok", value: [{ id: "mt", title: "Check status", dueAt: "2026-11-20T00:00:00Z", assigneeId: "u-rayn" }] },
      activity: { status: "ok", value: { rows: [], truncated: false } },
      deadline: { status: "ok", value: null },
      documents: { status: "ok", value: { files: { status: "ok", files: [], capped: false }, letters: null } },
    });
    const lead = row({ key: "l1", kind: "lead", id: ID, client: "Lena Lead", waiting: "client", lastOutbound: "2026-10-28", nextStep: step("2026-11-04", "u-reb"), deadline: { dueDate: "2026-11-20", title: "Response" }, lastChange: { date: "2026-10-31", at: 1, actor: { kind: "person", userId: "u-rayn" } } as never });
    const stages = [{ id: "00000000-0000-4000-8000-0000000000aa", name: "Nurture 2027", category: "nurture" }];
    const cardOf = (html: string) => html.slice(html.indexOf('role="dialog"'));

    it("opens the centred record card (not a side drawer) with the review's facts: waiting on, last contact, last changed, USPTO deadline", async () => {
      cardResult = leadLoad("attorney");
      mock(ok({ rows: [lead], closeStages: stages }));
      const html = await render({ open: `lead:${ID}` });
      const card = cardOf(html);
      expect(card).toContain("rc-card");
      expect(html).not.toContain("rv-panel");
      expect(html).not.toContain("lx-sidepanel");
      expect(card).toMatch(/<h2[^>]*>Lena Lead<\/h2>/);
      expect(card).toContain('data-review-card=""');
      expect(card).toContain("On the weekly review");
      expect(card).toContain("Client · followed up Oct 28");
      expect(card).toContain("Last contact");
      expect(card).toContain("Changed by Rayn · Oct 31");
      expect(card).toContain("USPTO deadline");
      expect(card).toContain("Nov 20");
      expect(cardLoader).toHaveBeenCalledWith({ kind: "lead", id: ID });
    });

    it("an editor gets the review's actions in the card: steps (snooze, done, add), stage incl. lost, owner, the note composer, Lost / Nurture, upload", async () => {
      cardResult = leadLoad("attorney");
      mock(ok({ rows: [lead], closeStages: stages }));
      const card = cardOf(await render({ open: `lead:${ID}` }));
      for (const w of ["Follow up", "Send form", "Tomorrow", "Next Monday", "In 2 weeks", "Done", "Add a next step", "Lost / Nurture", 'type="file"']) expect(card).toContain(w);
      // Each step names who it is assigned to (the drawer's "· Rayn").
      expect(card).toMatch(/rc-step-who[^>]*>Rebecca</);
      expect(card).toMatch(/rc-step-who[^>]*>Rayn</);
      // The card's own composer (Call / Email / Meeting, subject, @mentions), as on Intake: its action refreshes the review.
      expect(card).toContain('id="lx-note-body"');
      expect(card).toMatch(/name="kind" value="call_logged"/);
      expect(card).toMatch(/name="kind" value="email_sent"/);
      expect(card).not.toContain("Log what happened");
      // Stage and owner are the card's own controls (moveStageAction / assignRecordAction).
      expect(card).toMatch(/Stage for Lena Lead: Proposal/);
      expect(card).toContain("Reassign");
    });

    it("a lost stage is a Move-to destination from the review (as the drawer allowed), never a won one", async () => {
      const { buildOpenedCard } = await import("@/lib/record-card/model");
      const load = leadLoad("attorney") as never;
      const review = buildOpenedCard(load, { path: "/dashboard/review/", params: {}, lostShown: true });
      const intake = buildOpenedCard(load, { path: "/dashboard/intake/", params: {} });
      const ids = (v: ReturnType<typeof buildOpenedCard>) => (v.status === "ok" ? v.card.stage.targets.map((t) => t.id) : []);
      expect(ids(review)).toEqual(["s-lost"]);
      expect(ids(intake)).toEqual([]);
    });

    it("a matter: the same card, the docket's own USPTO deadline, the review facts without a second deadline, no Lost / Nurture", async () => {
      cardResult = matterLoad("attorney");
      const m = row({ key: "m1", kind: "matter", id: MID, client: "Matter Co", waiting: "uspto" });
      mock(ok({ rows: [m], closeStages: stages }));
      const card = cardOf(await render({ open: `matter:${MID}` }));
      expect(card).toContain("Next USPTO deadline");
      expect(card).toContain("On the weekly review");
      expect(card).toMatch(/Waiting on<\/dt><dd>USPTO</);
      expect(card).not.toContain(">USPTO deadline<");
      expect(card).not.toContain("Lost / Nurture");
      expect(card).toContain('id="lx-matter-note-body"');
      expect(card).toMatch(/rc-step-who[^>]*>Rayn</);
    });

    it("Lost / Nurture needs a role that can move a lead's stage AND the firm's lost or nurture stages", async () => {
      cardResult = leadLoad("attorney");
      mock(ok({ rows: [lead], closeStages: [] }));
      expect(await render({ open: `lead:${ID}` })).not.toContain("Lost / Nurture");
      vi.resetModules();
      cardResult = leadLoad("paralegal");
      mock(ok({ rows: [lead], closeStages: stages }), "paralegal");
      const card = cardOf(await render({ open: `lead:${ID}` }));
      expect(card).not.toContain("Lost / Nurture");
      // A paralegal still writes steps and notes.
      expect(card).toContain('id="lx-note-body"');
    });

    it("a viewer sees the facts and the steps with no form, no note box and no upload", async () => {
      cardResult = leadLoad("viewer");
      mock(ok({ rows: [lead], closeStages: stages }), "viewer");
      const card = cardOf(await render({ open: `lead:${ID}` }));
      expect(card).toContain("On the weekly review");
      expect(card).toContain("Client · followed up Oct 28");
      expect(card).toContain("Follow up");
      for (const f of ["<form", "<textarea", "<select", 'type="file"', "Lost / Nurture", 'id="lx-note-body"', ">Tomorrow<"]) expect(card).not.toContain(f);
    });

    it("a foreign or missing id reads 'couldn't be found' with a close link and no record data", async () => {
      cardResult = { status: "not-found" };
      mock(ok({ rows: [lead] }));
      const html = await render({ open: `lead:${ID}` });
      expect(html).toContain("This record couldn&#x27;t be found.");
      expect(html).toContain("data-close");
      for (const secret of ["Lena Lead", "On the weekly review", "followed up", 'name="title"']) expect(cardOf(html)).not.toContain(secret);
    });

    it("a failed read is its own sentence, never 'not found'", async () => {
      cardResult = { status: "unavailable" };
      mock(ok({ rows: [lead] }));
      const html = await render({ open: `lead:${ID}` });
      expect(html).toContain("couldn&#x27;t be loaded");
      expect(html).not.toContain("couldn&#x27;t be found");
    });

    it("optional reads that failed say so: steps, timeline, stages, documents", async () => {
      cardResult = leadLoad("attorney", ID, {
        stages: { status: "unavailable" },
        documents: { status: "unavailable" },
        leadStep: { status: "ok", facts: stepFacts({ tasks: { status: "unavailable" }, activity: { status: "unavailable" } }) },
      });
      mock(ok({ rows: [lead] }));
      const card = cardOf(await render({ open: `lead:${ID}` }));
      expect(card).toContain("Couldn&#x27;t load next steps");
      expect(card).toContain("Stages couldn&#x27;t load, so the stage can&#x27;t be changed here.");
      expect(card).not.toContain("No next steps");
    });

    it("the stage-read line is said only to a role that could change the stage", async () => {
      const failing = (role: string) => leadLoad(role, ID, { stages: { status: "unavailable" } });
      cardResult = failing("viewer");
      mock(ok({ rows: [lead] }), "viewer");
      expect(cardOf(await render({ open: `lead:${ID}` }))).not.toContain("the stage can&#x27;t be changed here");
      vi.resetModules();
      cardResult = failing("paralegal");
      mock(ok({ rows: [lead] }), "paralegal");
      expect(cardOf(await render({ open: `lead:${ID}` }))).not.toContain("the stage can&#x27;t be changed here");
      vi.resetModules();
      cardResult = failing("attorney");
      mock(ok({ rows: [lead] }));
      expect(cardOf(await render({ open: `lead:${ID}` }))).toContain("the stage can&#x27;t be changed here");
    });

    it("the note box has one heading, not two", async () => {
      cardResult = leadLoad("attorney");
      mock(ok({ rows: [lead] }));
      const card = cardOf(await render({ open: `lead:${ID}` }));
      expect(card).not.toContain("Log what happened");
      expect(card).not.toContain('id="rv-sec-note"');
    });

    it("a record that isn't on the review still opens, and says so instead of guessing facts", async () => {
      cardResult = leadLoad("attorney");
      mock(ok({ rows: [] }));
      const card = cardOf(await render({ open: `lead:${ID}` }));
      expect(card).toContain("Lena Lead");
      expect(card).toContain("This record isn&#x27;t on the weekly review right now.");
    });

    it("a merged lead opened by URL shows its keeper, with the keeper's review row", async () => {
      cardResult = leadLoad("attorney", KEEPER);
      const keeperRow = row({ key: "k", kind: "lead", id: KEEPER, client: "Lena Lead", waiting: "us" });
      mock(ok({ rows: [keeperRow] }));
      const card = cardOf(await render({ open: `lead:${ID}` }));
      expect(card).toContain("On the weekly review");
      expect(card).not.toContain("isn&#x27;t on the weekly review");
      expect(card).toContain(`name="leadId" value="${KEEPER}"`);
    });

    it("close and every card link keep the other review params (view, who, kind, q, person, since); notice is dropped", async () => {
      cardResult = leadLoad("attorney");
      mock(ok({ rows: [lead] }));
      const html = await render({ open: `lead:${ID}`, view: "sheet", who: "mine", kind: "leads", q: "lena", since: "all", notice: "denied" });
      const close = html.match(/<a[^>]*data-close[^>]*>/)?.[0] ?? "";
      // next/link drops the trailing slash in tests; the real link is /dashboard/review/?...
      expect(close).toMatch(/href="\/dashboard\/review\/?\?/);
      for (const p of ["who=mine", "kind=leads", "q=lena", "since=all", "view=sheet"]) expect(close).toContain(p);
      expect(close).not.toContain("open=");
      expect(close).not.toContain("notice=");
      const cards = await render({ open: `lead:${ID}`, view: "cards", person: "00000000-0000-4000-8000-0000000000b1", i: "2" });
      const close2 = cards.match(/<a[^>]*data-close[^>]*>/)?.[0] ?? "";
      expect(close2).toContain("view=cards");
      expect(close2).toContain("person=00000000-0000-4000-8000-0000000000b1");
    });

    it("the Cards deck's Open opens the same card and keeps the deck behind it", async () => {
      const deckRow = row({ key: "dk", kind: "matter", id: MID, client: "Deck Co", nextStep: step("2026-10-29", "u-reb") });
      cardResult = matterLoad("attorney");
      mock(ok({ rows: [deckRow] }));
      const deck = await render({ view: "cards" });
      expect(deck).toMatch(new RegExp(`href="[^"]*view=cards[^"]*open=matter%3A${MID}"`));
      const opened = await render({ view: "cards", open: `matter:${MID}` });
      expect(opened).toContain("1 of 1");
      expect(cardOf(opened)).toContain("rc-card");
      expect(cardOf(opened)).toContain("On the weekly review");
    });

    it("an old review link (?open=matter:<uuid>) still opens the card; a bad one opens nothing", async () => {
      cardResult = matterLoad("attorney");
      mock(ok({ rows: [] }));
      expect(await render({ open: `MATTER:${MID.toUpperCase()}` })).toContain("rc-card");
      cardLoader.mockClear();
      expect(await render({ open: "lead:not-a-uuid" })).not.toContain('role="dialog"');
      expect(cardLoader).not.toHaveBeenCalled();
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
      for (const w of ["Done", "Snooze: Tomorrow", "Snooze: Next Monday", "Hand to", "Add to timeline", "Open"]) expect(html).toContain(w);
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
