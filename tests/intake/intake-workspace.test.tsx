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

  it("the table subtitle is unchanged", () => {
    expect(render(THREE)).toContain("Sorted by the last thing that happened, not by when the lead arrived.");
  });
});

describe("the page header", () => {
  const html = render(THREE);
  const head = html.slice(html.indexOf('class="lx-page-head"'), html.indexOf('aria-label="Filter by stage"'));

  it("uses the same class set as Matters", () => {
    expect(html).toContain('class="lx-page-head"');
    expect(head).toContain('<div class="lx-label">Intake</div>');
    expect(head).toContain('<h1 class="lx-h1">Leads</h1>');
    expect(head).toContain('class="lx-sub"');
  });

  it("carries no intake-only serif class or inline font size on the h1", () => {
    expect(html).not.toMatch(/<h1[^>]*intake-serif/);
    expect(html).not.toMatch(/<h1[^>]*style=/);
    const source = read("src/app/dashboard/intake/_components/IntakeWorkspace.tsx");
    expect(source).not.toContain("intake-serif");
    expect(source).not.toMatch(/fontSize: 36/);
  });

  it("orders search, then the toggle, then Import and Add a lead", () => {
    const search = head.indexOf('aria-label="Search leads"');
    const toggle = head.indexOf("lx-view-toggle");
    const importLink = head.indexOf("Import");
    const add = head.indexOf("Add a lead");
    expect(search).toBeGreaterThan(0);
    expect(toggle).toBeGreaterThan(search);
    expect(importLink).toBeGreaterThan(toggle);
    expect(add).toBeGreaterThan(importLink);
  });

  it("puts the search in the header as the same lx-search-form markup Matters uses", () => {
    expect(head).toContain('class="lx-search-form" role="search"');
    expect(head).toMatch(/<input class="lx-input"[^>]*aria-label="Search leads"/);
  });

  it("renders the toggle once, in the header, and not in the control row", () => {
    expect(html.match(/lx-view-toggle/g)).toHaveLength(1);
    const controls = html.slice(html.indexOf('aria-label="Filter by stage"'));
    expect(controls).not.toContain("lx-view-toggle");
    expect(controls).not.toContain("How to arrange the list");
  });

  it("keeps the status line above the header", () => {
    expect(html.indexOf('role="status"')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf('class="lx-page-head"'));
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
    expect(board.indexOf("Group by")).toBeGreaterThan(board.indexOf('class="lx-page-head"'));
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
    expect(html.match(/aria-label="Sort by /g)).toHaveLength(7);
  });

  it("has no Lane filter and no 'Suggested, not reviewed' option anywhere", () => {
    const html = render([person, suggested, blank]);
    expect(html).not.toContain("Filter by lane");
    expect(html).not.toContain("Suggested, not reviewed");
    expect(html).not.toContain("Any lane");
    expect(html.match(/aria-label="Filter by temperature"/g)).toHaveLength(1);
  });

  it("shows a person's temperature as a solid chip with no 'Suggested' text", () => {
    const html = render([person]);
    expect(html).toMatch(/data-testid="temperature-cell"[^>]*>Hot</);
    expect(html).toContain("border:1px solid currentColor");
    expect(html).not.toContain("Suggested");
    expect(html).not.toContain("dashed currentColor");
  });

  it("shows an unrouted lead's derived temperature as a dashed chip that says Suggested", () => {
    const html = render([suggested]);
    expect(html).toMatch(/data-testid="temperature-cell"[^>]*>Suggested: Hot</);
    expect(html).toContain("border:1px dashed currentColor");
    expect(html).toContain("font-style:italic");
    // The reason is the tooltip.
    expect(html).toMatch(/<button[^>]*title="Replied 1 day ago — waiting on us"[^>]*data-testid="temperature-cell"/);
  });

  it("shows a lead with nothing recorded as a dashed neutral 'Not routed'", () => {
    const html = render([blank]);
    expect(html).toMatch(/data-testid="temperature-cell"[^>]*>Not routed</);
    expect(html).toContain("border:1px dashed var(--line)");
    expect(html).not.toMatch(/data-testid="temperature-cell"[^>]*>Suggested/);
  });

  it("puts the activity hint in the tooltip of a stale lane", () => {
    const stale = lead("l-stale", "Stale", { lane: "cold", lane_set_by: "u-1", lane_set_at: daysBefore(5), last_inbound_at: daysBefore(2) });
    const html = render([stale]);
    expect(html).toContain("Activity: hot · Replied 2 days ago — waiting on us");
    expect(html).toMatch(/data-testid="temperature-cell"[^>]*>Cold</);
  });

  it("uses the same seven grid columns in the header strip and in every row", () => {
    const html = render([person, suggested, blank]);
    const grids = Array.from(html.matchAll(/grid-template-columns:([^;"]+)/g)).map((m) => m[1].trim().split(/\s+/).length);
    // header strip + three rows
    expect(grids).toEqual([7, 7, 7, 7]);
  });

  it("keeps the Long-Term Nurture line in the lead cell, not the Temperature cell", () => {
    const source = read("src/app/dashboard/intake/_components/IntakeTable.tsx");
    expect(source).toContain("<LtnSuggestion");
    expect(source).not.toContain("LaneCell");
    expect(source).not.toContain("Sort by Lane");
  });

  it("offers the effective-temperature filter: Hot, Warm, Cold, Not routed", () => {
    const source = read("src/app/dashboard/intake/_components/IntakeControls.tsx");
    for (const label of ["Hot", "Warm", "Cold", "Not routed", "Any temperature"]) expect(source).toContain(label);
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

  it("?temp=none keeps only the Not routed row, and ?lane=none reads the same", () => {
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

  it("the top-bar counts follow the filtered rows", () => {
    expect(render(leads, { temp: "none" })).toContain("1 in intake");
  });
});

describe("the board card's one temperature line", () => {
  function card(l: Lead) {
    const [row] = buildIntakeRows({ leads: [l], stages: STAGES, members: MEMBERS, now: NOW });
    return renderToStaticMarkup(
      <IntakeCard
        row={row}
        variant="stage"
        stages={intakeStages(STAGES)}
        members={MEMBERS}
        now={NOW}
        pending={false}
        time={null}
        onMoveStage={() => {}}
        onAssign={() => {}}
        onSetSource={() => {}}
      />,
    );
  }

  it("reads the level for a person's, with the reason as its tooltip", () => {
    const html = card(lead("a", "Ana", { lane: "warm", lane_set_by: "u-1", lane_set_at: daysBefore(0), last_activity_at: daysBefore(5) }));
    expect(html).toContain('title="Set by a person">Warm<');
    expect(html).not.toContain("Suggested");
  });

  it("reads 'Suggested: <level>' for a derived one", () => {
    const html = card(lead("a", "Ana", { last_inbound_at: daysBefore(1) }));
    expect(html).toContain(">Suggested: Hot<");
  });

  it("reads 'Not routed' for neither", () => {
    expect(card(lead("a", "Ana"))).toContain(">Not routed<");
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
      expect(html).toMatch(/^<div[^>]*><div style="display:flex;align-items:center;gap:7px"><a [^>]*>[^<]*<\/a><\/div>/);
      expect(html).not.toMatch(/width:7px;height:7px/);
      const lines = html.match(/>(Hot|Warm|Cold|Suggested: (Hot|Warm|Cold)|Not routed)</g) ?? [];
      expect(lines).toHaveLength(1);
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
