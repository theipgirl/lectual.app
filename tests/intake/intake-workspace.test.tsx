import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { Lead, Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import {
  DEFAULT_VIEW_STATE,
  EMPTY_INTAKE_FILTERS,
  buildIntakeRows,
  parseIntakeFilters,
  parseIntakeViewState,
  type IntakeSearchParams,
} from "@/lib/intake/rows";
import { intakeStages } from "@/lib/intake/scope";
import { leadsMoreItems } from "@/lib/intake/more-items";
import IntakeWorkspace from "@/app/dashboard/intake/_components/IntakeWorkspace";
import IntakeCard from "@/app/dashboard/intake/_components/IntakeCard";

// A static render has no router, and the row actions are server actions that
// would drag the data layer in; only their names matter here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/app/dashboard/intake/actions", () => ({
  assignLeadAction: vi.fn(),
  moveStageAction: vi.fn(),
  setLaneAction: vi.fn(),
  setSourceAction: vi.fn(),
}));
vi.mock("@/app/dashboard/leads/actions", () => ({ createLeadAction: vi.fn() }));
vi.mock("@/app/dashboard/intake/time-actions", () => ({
  startTimerAction: vi.fn(),
  stopTimerAction: vi.fn(),
  logTimeAction: vi.fn(),
}));

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const NOW = new Date("2026-10-20T12:00:00.000Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const STAGES = [
  { id: "s1", org_id: "o", name: "New enquiry", order_index: 1, category: "open", aging_threshold_days: 30 },
  { id: "s2", org_id: "o", name: "Contacted", order_index: 2, category: "open", aging_threshold_days: 30 },
  { id: "s9", org_id: "o", name: "Signed", order_index: 9, category: "won", aging_threshold_days: null },
] as unknown as Stage[];

const MEMBERS: MemberIdentity[] = [
  { userId: "u-1", email: "rebecca@example.com", displayName: "Rebecca Beliard", role: "owner", identified: true },
];

function lead(id: string, first: string, overrides: Record<string, unknown> = {}): Lead {
  return {
    id,
    org_id: "o",
    first_name: first,
    last_name: "Tester",
    email: `${id}@example.com`,
    current_stage_id: "s1",
    stage_entered_at: daysBefore(2),
    assigned_to: null,
    temperature: null,
    lane: null,
    lane_set_by: null,
    lane_set_at: null,
    ai_summary: null,
    last_activity_at: null,
    last_outbound_at: null,
    last_inbound_at: null,
    mark_text: null,
    business_name: null,
    referral_source: null,
    referral_detail: null,
    ...overrides,
  } as unknown as Lead;
}

/** Touched yesterday, touched today, never touched: listed out of order on purpose. */
const THREE = [
  lead("l-yesterday", "Yesterday", { last_activity_at: daysBefore(1) }),
  lead("l-never", "Never"),
  lead("l-today", "Today", { last_activity_at: daysBefore(0) }),
];

function render(leads: Lead[], params: IntakeSearchParams = {}, extra: { viewState?: ReturnType<typeof parseIntakeViewState> } = {}) {
  const rows = buildIntakeRows({ leads, stages: STAGES, members: MEMBERS, now: NOW });
  return renderToStaticMarkup(
    <IntakeWorkspace
      rows={rows}
      stages={STAGES}
      intakeStages={intakeStages(STAGES)}
      members={MEMBERS}
      initialFilters={parseIntakeFilters(params)}
      initialViewState={extra.viewState ?? parseIntakeViewState(params)}
      time={null}
      now={NOW.toISOString()}
    />,
  );
}

/** Where each name first appears, in markup order. */
function order(html: string, names: string[]): string[] {
  return names
    .map((name) => ({ name, at: html.indexOf(`>${name} Tester<`) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.name);
}

describe("default last-touch sort, rendered", () => {
  const names = ["Today", "Yesterday", "Never"];

  it("table: today, yesterday, never", () => {
    expect(order(render(THREE), names)).toEqual(["Today", "Yesterday", "Never"]);
  });

  it("board by stage: today, yesterday, never", () => {
    expect(order(render(THREE, { view: "board" }), names)).toEqual(["Today", "Yesterday", "Never"]);
  });

  it("board by owner: today, yesterday, never", () => {
    expect(order(render(THREE, { view: "board", group: "owner" }), names)).toEqual(["Today", "Yesterday", "Never"]);
  });

  it("?sort=lead&dir=asc reads A to Z and marks the Lead header ascending", () => {
    const leads = [lead("l-c", "Cora"), lead("l-a", "Abel"), lead("l-b", "Bram")];
    const html = render(leads, { sort: "lead", dir: "asc" });
    expect(order(html, ["Cora", "Abel", "Bram"])).toEqual(["Abel", "Bram", "Cora"]);
    expect(html).toMatch(/aria-label="Sort by Lead"[^>]*>Lead ↑</);
    // Only that header is marked.
    expect(html.match(/ ↑</g)).toHaveLength(1);
    expect(html.match(/ ↓</g)).toBeNull();
  });

  it("marks Last touch descending on first load", () => {
    expect(render(THREE)).toMatch(/aria-label="Sort by Last touch"[^>]*>Last touch ↓</);
  });

  it("the sub-line is one short sentence: the count, who needs a first reply, and ONE note about owners", () => {
    // Without set data every lead is shown as All open. Nobody is assigned, so there is no "3 unassigned": one sentence says so.
    expect(render(THREE)).toContain("3 open leads · 0 need a first reply · Nobody is assigned yet");
    const assigned = [lead("l-a", "Ann", { assigned_to: "u-1" }), lead("l-b", "Bo")];
    expect(render(assigned)).toContain("2 open leads · 0 need a first reply · 1 unassigned");
  });

  it("the board has no drag caption and no sub-line hint (changed on purpose: Sprint 31 pinned them)", () => {
    for (const html of [render(THREE, { view: "board" }), render(THREE, { view: "board", group: "owner" })]) {
      expect(html).not.toContain("Drag a card to move it");
      expect(html).not.toContain("Leads with no owner are in the first column.");
      expect(html).not.toContain("Newest activity first");
    }
  });
});

describe("the page header and toolbar (shared list-page components)", () => {
  const html = render(THREE);
  const head = html.slice(html.indexOf('class="lp-header"'), html.indexOf('aria-label="Filter by stage"'));

  it("uses the shared header: one h1, one sub-line, no eyebrow label", () => {
    expect(html).toContain('class="lp-header"');
    expect(head).toContain('<h1 class="lx-h1">Leads</h1>');
    expect(head).toContain('class="lx-sub lp-sub"');
    expect(head).not.toContain("lx-label");
    expect(head.match(/<h1/g)).toHaveLength(1);
  });

  it("carries no intake-only serif class or inline font size on the h1", () => {
    expect(html).not.toMatch(/<h1[^>]*intake-serif/);
    expect(html).not.toMatch(/<h1[^>]*style=/);
    const source = read("src/app/dashboard/intake/_components/IntakeWorkspace.tsx");
    expect(source).not.toContain("intake-serif");
    expect(source).not.toMatch(/fontSize: 36/);
  });

  it("orders search (with its submit button), then the toggle, then More, then Add a lead", () => {
    const search = head.indexOf('aria-label="Search leads"');
    const submit = head.indexOf(">Search</button>");
    const toggle = head.indexOf("lx-view-toggle");
    const more = head.indexOf("More");
    const add = head.indexOf("Add a lead");
    expect(search).toBeGreaterThan(0);
    expect(submit).toBeGreaterThan(search);
    expect(toggle).toBeGreaterThan(submit);
    expect(more).toBeGreaterThan(toggle);
    expect(add).toBeGreaterThan(more);
  });

  it("keeps Import and Reconcile stages out of the toolbar row and in the More menu", () => {
    expect(head).not.toContain("Import");
    expect(head).not.toContain("Reconcile stages");
    expect(leadsMoreItems({ showReconcile: true }).map((i) => i.label)).toEqual(["Reconcile stages", "Import"]);
    expect(leadsMoreItems({ showReconcile: false }).map((i) => i.label)).toEqual(["Import"]);
    expect(read("src/app/dashboard/intake/_components/IntakeWorkspace.tsx")).toContain("leadsMoreItems({ showReconcile })");
  });

  it("puts the search in the toolbar as the shared lp-search form", () => {
    expect(head).toContain('class="lp-search" role="search"');
    expect(head).toMatch(/<input class="lx-input"[^>]*aria-label="Search leads"/);
  });

  it("shows Clear only when a search term is set", () => {
    expect(head).not.toContain(">Clear<");
    const withTerm = render(THREE, { q: "today" });
    expect(withTerm).toContain(">Clear</button>");
  });

  it("renders the toggle once, in the toolbar, and not in the control row", () => {
    expect(html.match(/lx-view-toggle/g)).toHaveLength(1);
    const controls = html.slice(html.indexOf('aria-label="Filter by stage"'));
    expect(controls).not.toContain("lx-view-toggle");
    expect(controls).not.toContain("How to arrange the list");
  });

  it("has no separate status strip above the header", () => {
    expect(html).not.toContain("intake-statusline");
    expect(html.startsWith('<div class="lp-root"><header class="lp-header">')).toBe(true);
  });

  it("marks the current view on the controlled toggle", () => {
    expect(head).toMatch(/<button type="button" aria-pressed="true" class="on">Table<\/button>/);
    expect(head).toMatch(/<button type="button" aria-pressed="false">Board<\/button>/);
    const board = render(THREE, { view: "board" });
    expect(board).toMatch(/<button type="button" aria-pressed="true" class="on">Board<\/button>/);
  });

  it("shows Group by in the control row only on the board", () => {
    expect(render(THREE)).not.toContain("Group by");
    const board = render(THREE, { view: "board" });
    expect(board).toContain("Group by");
    expect(board.indexOf("Group by")).toBeGreaterThan(board.indexOf('class="lp-header"'));
    expect(board.indexOf("Group by")).toBeGreaterThan(board.indexOf("Add a lead"));
  });
});

describe("the Temperature column, rendered", () => {
  const person = lead("l-person", "Person", { lane: "hot", lane_set_by: "u-1", lane_set_at: daysBefore(1), last_activity_at: daysBefore(3) });
  const suggested = lead("l-suggested", "Suggested", { last_inbound_at: daysBefore(1) });
  const blank = lead("l-blank", "Blank");

  it("has exactly one sortable Temperature header and no Temp or Lane header", () => {
    const html = render([person, suggested, blank]);
    expect(html.match(/aria-label="Sort by Temperature"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-label="Sort by Temp"');
    expect(html).not.toContain("Sort by Lane");
    // No Owner column while nobody in view has an owner.
    expect(html.match(/aria-label="Sort by /g)).toHaveLength(6);
    expect(render([lead("l-o", "Owned", { assigned_to: "u-1" })]).match(/aria-label="Sort by /g)).toHaveLength(7);
  });

  it("has no Lane filter and no 'Suggested, not reviewed' option anywhere", () => {
    const html = render([person, suggested, blank]);
    expect(html).not.toContain("Filter by lane");
    expect(html).not.toContain("Suggested, not reviewed");
    expect(html).not.toContain("Any lane");
    expect(html.match(/aria-label="Filter by temperature"/g)).toHaveLength(1);
  });

  it("shows a person's temperature as the filled pill, sentence case, with no 'suggested' marking", () => {
    const html = render([person]);
    expect(html).toMatch(/data-testid="temperature-cell"[^>]*>Hot</);
    expect(html).toContain('data-tone="hot"');
    expect(html).not.toContain("data-suggested");
    expect(html).not.toContain("Suggested");
  });

  it("shows a suggested temperature as the SAME pill, lighter, with 'suggested' in its title and accessible name", () => {
    const html = render([suggested]);
    expect(html).toMatch(/data-testid="temperature-cell"[^>]*>Hot</);
    expect(html).toContain('data-tone="hot"');
    expect(html).toContain('data-suggested=""');
    // The reason is in the tooltip, after "Suggested: Hot".
    expect(html).toMatch(/<button[^>]*title="Suggested: Hot\nReplied 1 day ago — waiting on us"[^>]*data-testid="temperature-cell"/);
    expect(html).toContain("Hot, suggested");
    expect(html).not.toContain(">Suggested: Hot<");
  });

  it("shows a lead with nothing recorded as no pill at all (the button stays, named 'Not rated', for setting one)", () => {
    const html = render([blank]);
    expect(html).toContain("ix-temp-empty");
    expect(html).not.toMatch(/data-tone="/);
    expect(html).toContain("Not rated");
  });

  it("puts the activity hint in the tooltip of a stale lane", () => {
    const stale = lead("l-stale", "Stale", { lane: "cold", lane_set_by: "u-1", lane_set_at: daysBefore(5), last_inbound_at: daysBefore(2) });
    const html = render([stale]);
    expect(html).toContain("Activity: hot · Replied 2 days ago — waiting on us");
    expect(html).toMatch(/data-testid="temperature-cell"[^>]*>Cold</);
  });

  it("draws the same cells in every row (lead, stage, temperature, source, last touch, next step, menu) and no LTN line", () => {
    const html = render([person, suggested, blank]);
    expect(html.match(/data-col="/g)).toHaveLength(7 * 3);
    expect(html).not.toContain("Long-Term Nurture suggested");
    const source = read("src/app/dashboard/intake/_components/IntakeTable.tsx");
    // The suggestion is the "Suggestions" chip now (it stays on the lead page), not a line in the lead cell.
    expect(source).not.toContain("<LtnSuggestion");
    expect(read("src/app/dashboard/intake/_components/IntakeControls.tsx")).toContain("LEADS_SUGGESTIONS");
    expect(source).not.toContain("Sort by Lane");
  });

  it("offers the effective-temperature filter: Hot, Warm, Cold, Not rated", () => {
    const source = read("src/app/dashboard/intake/_components/IntakeControls.tsx");
    for (const label of ["Hot", "Warm", "Cold", "NOT_RATED", "Any temperature"]) expect(source).toContain(label);
    expect(source).not.toMatch(/LaneFilter|LANE_OPTIONS|Any lane/);
  });
});

describe("the temperature filter, rendered", () => {
  const leads = [
    lead("l-person", "Person", { lane: "cold", lane_set_by: "u-1", lane_set_at: daysBefore(0), last_inbound_at: daysBefore(1) }),
    lead("l-hot", "Replied", { last_inbound_at: daysBefore(1) }),
    lead("l-blank", "Blank"),
  ];
  const names = ["Person", "Replied", "Blank"];

  it("?temp=hot keeps the suggested-hot row and not a lead whose lane is cold", () => {
    expect(order(render(leads, { temp: "hot" }), names)).toEqual(["Replied"]);
  });

  it("?temp=none keeps only the Not rated row, and ?lane=none reads the same", () => {
    expect(order(render(leads, { temp: "none" }), names)).toEqual(["Blank"]);
    expect(order(render(leads, { lane: "none" }), names)).toEqual(["Blank"]);
  });

  it("?lane=cold behaves as ?temp=cold", () => {
    expect(order(render(leads, { lane: "cold" }), names)).toEqual(["Person"]);
  });

  it("?lane=suggested and ?temp=lukewarm are dropped, showing the unfiltered list", () => {
    expect(order(render(leads, { lane: "suggested" }), names)).toHaveLength(3);
    expect(order(render(leads, { temp: "lukewarm" }), names)).toHaveLength(3);
  });

  it("the sub-line counts follow the filtered rows", () => {
    expect(render(leads, { temp: "none" })).toContain("1 open lead · ");
  });
});

describe("the board card's one temperature line", () => {
  function card(l: Lead) {
    const [row] = buildIntakeRows({ leads: [l], stages: STAGES, members: MEMBERS, now: NOW });
    return renderToStaticMarkup(
      <IntakeCard
        row={row}
        stages={intakeStages(STAGES)}
        members={MEMBERS}
        now={NOW}
        pending={false}
        time={null}
        onMoveStage={() => {}}
        onAssign={() => {}}
      />,
    );
  }

  it("reads the level for a person's, with the reason as its tooltip", () => {
    const html = card(lead("a", "Ana", { lane: "warm", lane_set_by: "u-1", lane_set_at: daysBefore(0), last_activity_at: daysBefore(5) }));
    expect(html).toContain('title="Set by a person"');
    expect(html).toContain('data-tone="warm"');
    expect(html).toContain(">Warm<");
    expect(html).not.toContain("data-suggested");
  });

  it("reads 'Suggested: <level>' for a derived one", () => {
    const html = card(lead("a", "Ana", { last_inbound_at: daysBefore(1) }));
    expect(html).toContain('data-suggested=""');
    expect(html).toContain(">Hot<");
    expect(html).toContain("Hot, suggested");
  });

  it("reads 'Not rated' for neither", () => {
    // No pill at all (changed on purpose: "Not rated" used to be drawn on every unrated card).
    expect(card(lead("a", "Ana"))).not.toMatch(/data-tone=/);
  });

  it("has no 'Lane:' text, no dot beside the name, and exactly one temperature line", () => {
    for (const l of [
      lead("a", "Ana", { lane: "hot", lane_set_by: "u-1", lane_set_at: daysBefore(0) }),
      lead("b", "Bea", { last_inbound_at: daysBefore(1) }),
      lead("c", "Cy"),
    ]) {
      const html = card(l);
      expect(html).not.toContain("Lane:");
      // The name row is the link and nothing else: no dot beside the name.
      expect(html).toMatch(/^<div[^>]*><div class="ix-card-top"><a [^>]*>[^<]*<\/a><\/div>/);
      expect(html).not.toMatch(/width:7px;height:7px/);
      const lines = html.match(/>(Hot|Warm|Cold)</g) ?? [];
      expect(lines).toHaveLength(l.id === "c" ? 0 : 1);
    }
  });
});

describe("the Intake source", () => {
  const workspace = read("src/app/dashboard/intake/_components/IntakeWorkspace.tsx");

  it("makes the lane action its only temperature write", () => {
    expect(workspace).toMatch(/import \{[^}]*setLaneAction[^}]*\} from "\.\.\/actions"/);
    expect(workspace).toMatch(/setLaneAction\(leadId, lane\)/);
    expect(workspace).not.toMatch(/setTemperature/i);
    expect(workspace).not.toContain("deriveTemperature");
  });

  it("no longer exports the hand-set temperature action", () => {
    const actions = read("src/app/dashboard/intake/actions.ts");
    expect(actions).not.toMatch(/setTemperature/i);
    expect(actions).toContain("export async function setLaneAction");
  });

  it("uses the default filters and view state when nothing is in the URL", () => {
    expect(parseIntakeFilters({})).toEqual(EMPTY_INTAKE_FILTERS);
    expect(parseIntakeViewState({})).toEqual(DEFAULT_VIEW_STATE);
  });
});
