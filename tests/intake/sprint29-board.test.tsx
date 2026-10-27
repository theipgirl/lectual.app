import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Lead, Stage } from "@/lib/pipeline";
import {
  applyFilters,
  buildIntakeRows,
  filtersToQueryString,
  intakeHref,
  parseIntakeFilters,
  parseIntakeViewState,
  EMPTY_INTAKE_FILTERS,
  type IntakeSearchParams,
} from "@/lib/intake/rows";
import { intakeStages } from "@/lib/intake/scope";
import { chipFor, chipsByLead, currentAgentMoves, type ActivityRow } from "@/lib/stage-keeper/moves";
import {
  HIRED_DECISION_LABEL,
  IMPORTED_DECISION_LABEL,
  NEEDS_DECISION_LABEL,
  decisionOpen,
  parseDecisionFlag,
  whyLine,
  type DecisionFlag,
} from "@/lib/intake/stage-decision";
import IntakeWorkspace from "@/app/dashboard/intake/_components/IntakeWorkspace";
import BulkMoveBar from "@/app/dashboard/intake/_components/BulkMoveBar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/app/dashboard/intake/actions", () => ({
  assignLeadAction: vi.fn(),
  moveStageAction: vi.fn(),
  bulkMoveStageAction: vi.fn(),
  setLaneAction: vi.fn(),
  setSourceAction: vi.fn(),
}));
vi.mock("@/app/dashboard/leads/actions", () => ({ createLeadAction: vi.fn() }));
vi.mock("@/app/dashboard/intake/time-actions", () => ({ startTimerAction: vi.fn(), stopTimerAction: vi.fn(), logTimeAction: vi.fn() }));

/** Sprint 29 F: the board's one-line reason, the "Needs a stage decision" filter and badge, and the bulk bar. */

const NOW = new Date("2026-10-27T16:00:00.000Z");
const ZONE = "America/New_York";
const hoursBefore = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

const STAGES = [
  { id: "s1", org_id: "o", name: "Potential New Client", order_index: 1, category: "open", aging_threshold_days: 30 },
  { id: "s2", org_id: "o", name: "Consultation Scheduled", order_index: 2, category: "open", aging_threshold_days: 30 },
  { id: "s3", org_id: "o", name: "Post Consultation Email Sent", order_index: 3, category: "open", aging_threshold_days: 30 },
  { id: "s9", org_id: "o", name: "Signed LOE", order_index: 9, category: "won", aging_threshold_days: null },
] as unknown as Stage[];

function lead(id: string, first: string, stage = "s1"): Lead {
  return {
    id,
    org_id: "o",
    first_name: first,
    last_name: "Tester",
    email: `${id}@example.com`,
    current_stage_id: stage,
    stage_entered_at: hoursBefore(30),
    assigned_to: null,
    temperature: null,
    lane: null,
    lane_set_by: null,
    lane_set_at: null,
    ai_summary: null,
    last_activity_at: hoursBefore(5),
    last_outbound_at: null,
    last_inbound_at: null,
    mark_text: null,
    business_name: null,
    referral_source: null,
    referral_detail: null,
  } as unknown as Lead;
}

const flag = (over: Partial<DecisionFlag> = {}): DecisionFlag => ({ lawmaticsStage: "Discovery Call Complete", hired: false, stageId: "s1", ...over });

const LEADS = [
  lead("l-lm", "Imported"), // in the stage the importer filed it in, flag open
  lead("l-hired", "Hired"), // open flag, hired
  lead("l-decided", "Decided", "s2"), // flagged once, then somebody moved it: decided
  lead("l-agent", "Automatic", "s3"), // moved by the Stage Keeper after a held consult
  lead("l-plain", "Plain"), // no flag, no move: a blank-safe card
];
const FLAGS: Record<string, DecisionFlag> = {
  "l-lm": flag(),
  "l-hired": flag({ lawmaticsStage: "Hired Client", hired: true }),
  "l-decided": flag(),
};
const AGENT_ROWS: ActivityRow[] = [
  {
    id: "agent-1",
    lead_id: "l-agent",
    type: "stage_changed",
    actor_type: "ai",
    created_at: hoursBefore(2),
    payload: {
      actor: "agent:stage-keeper",
      to_stage_id: "s3",
      signal: "consult-held",
      evidence: { kind: "meeting", provider: "zoom", title: "Strategy session", starts_at: "2026-10-23T16:00:00.000Z" },
    },
  },
];
const chips = chipsByLead(currentAgentMoves(AGENT_ROWS, NOW), NOW, ZONE);

type Props = { decisions?: { status: "ok"; truncated: boolean } | { status: "unavailable" }; withFlags?: boolean };
function render(params: IntakeSearchParams = {}, props: Props = {}) {
  const rows = buildIntakeRows({
    leads: LEADS,
    stages: STAGES,
    members: [],
    agentMoveByLeadId: chips,
    ...(props.withFlags === false ? {} : { decisionByLeadId: FLAGS }),
    now: NOW,
  });
  return renderToStaticMarkup(
    <IntakeWorkspace
      rows={rows}
      stages={STAGES}
      intakeStages={intakeStages(STAGES)}
      members={[]}
      initialFilters={parseIntakeFilters(params)}
      initialViewState={parseIntakeViewState(params)}
      time={null}
      now={NOW.toISOString()}
      agentMoves={{ status: "ok", truncated: false }}
      stageDecisions={"decisions" in props ? props.decisions : { status: "ok", truncated: false }}
    />,
  );
}
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("<!-- -->", "").replaceAll("&quot;", '"');
const names = (html: string) => ["Imported", "Hired", "Decided", "Automatic", "Plain"].filter((n) => html.includes(`>${n} Tester<`));
const BOARD = { view: "board" } as IntakeSearchParams;

describe("the flag a Lawmatics import records", () => {
  it("parses only an importer's lead_created payload", () => {
    expect(parseDecisionFlag({ source: "lawmatics_import", lawmatics_stage_unmapped: "Proposal Sent", hired_in_lawmatics: false, stage_id: "s1" })).toEqual({
      lawmaticsStage: "Proposal Sent",
      hired: false,
      stageId: "s1",
    });
    expect(parseDecisionFlag({ source: "lawmatics_import", lawmatics_stage_unmapped: null, hired_in_lawmatics: true, stage_id: "s1" })).toMatchObject({ lawmaticsStage: null, hired: true });
    expect(parseDecisionFlag({ source: "dashboard", summary: "Jane" })).toBeNull();
    expect(parseDecisionFlag({ source: "lawmatics_import" })).toBeNull();
    expect(parseDecisionFlag(null)).toBeNull();
  });

  it("is open only while the lead is still in the stage the importer filed it in", () => {
    expect(decisionOpen(flag(), "s1")).toBe(true);
    expect(decisionOpen(flag(), "s2")).toBe(false);
    expect(decisionOpen(flag({ stageId: null }), "s1")).toBe(false); // too old to say: never "open"
    expect(decisionOpen(undefined, "s1")).toBe(false);
  });
});

describe("the one-line reason on a board card", () => {
  const html = text(render(BOARD));

  it("a Stage Keeper move reads 'Moved automatically · consult held Oct 23', with the evidence as its tooltip", () => {
    expect(html).toContain("Moved automatically · consult held Oct 23");
    expect(html).toContain('title="Evidence: Zoom meeting "Strategy session" on Oct 23."');
    expect(chipFor(currentAgentMoves(AGENT_ROWS, NOW).get("l-agent")!, NOW, ZONE).why).toBe("Moved automatically · consult held Oct 23");
  });

  it("an imported lead still waiting says 'Lawmatics: <stage>' and carries the decision pill", () => {
    expect(html).toContain("Lawmatics: Discovery Call Complete");
    expect(html).toContain(IMPORTED_DECISION_LABEL);
    expect(IMPORTED_DECISION_LABEL).toBe("Imported — stage needs a decision");
  });

  it("a hired one says so in the pill", () => {
    expect(html).toContain("Lawmatics: Hired Client");
    expect(html).toContain(HIRED_DECISION_LABEL);
  });

  it("a decided lead and a plain lead get no reason line and no pill (blank-safe, no empty element)", () => {
    expect(html.match(/data-why="/g)).toHaveLength(3); // the agent move and the two open flags
    expect(html.match(/data-needs-decision/g)).toHaveLength(2);
    const decidedCard = html.slice(html.indexOf('data-lead-id="l-decided"'), html.indexOf('data-lead-id="l-agent"'));
    expect(decidedCard).not.toContain("intake-why");
    expect(decidedCard).not.toContain("data-needs-decision");
  });

  it("whyLine is null for nothing at all, and the agent wins over a flag", () => {
    expect(whyLine({ currentStageId: "s1" })).toBeNull();
    const move = currentAgentMoves(AGENT_ROWS, NOW).get("l-agent")!;
    expect(whyLine({ agentMove: chipFor(move, NOW, ZONE), decision: flag(), currentStageId: "s1" })).toMatchObject({ kind: "agent" });
    expect(whyLine({ decision: flag({ lawmaticsStage: null }), currentStageId: "s1" })).toEqual({ kind: "imported", text: IMPORTED_DECISION_LABEL });
  });
});

describe("the 'Needs a stage decision' filter and the column badge", () => {
  it("is offered with the count of open flags, and the column says how many to decide", () => {
    const html = text(render(BOARD));
    expect(html).toContain(NEEDS_DECISION_LABEL);
    expect(html).toMatch(/Needs a stage decision<span[^>]*>2<\/span>/);
    expect(html).toContain('data-decision-count="2"');
    expect(html).toContain("2 to decide");
  });

  it("?decision=1 keeps only the leads whose decision is open", () => {
    expect(names(text(render({ ...BOARD, decision: "1" })))).toEqual(["Imported", "Hired"]);
    expect(names(text(render({ decision: "1" })))).toEqual(["Imported", "Hired"]);
    expect(names(text(render(BOARD)))).toHaveLength(5);
  });

  it("round-trips through the URL helpers", () => {
    expect(parseIntakeFilters({ decision: "1" }).decision).toBe(true);
    expect(parseIntakeFilters({ decision: "yes" }).decision).toBeUndefined();
    expect(filtersToQueryString({ ...EMPTY_INTAKE_FILTERS, decision: true })).toBe("decision=1");
    expect(intakeHref({ ...EMPTY_INTAKE_FILTERS, decision: true }, parseIntakeViewState({}))).toBe("/dashboard/intake/?decision=1");
  });

  it("an unreadable flag list is said out loud: no filter, no badge, no reason line, and a bookmarked filter shows everyone", () => {
    const html = text(render({ ...BOARD, decision: "1" }, { decisions: { status: "unavailable" }, withFlags: false }));
    expect(html).toMatch(/Stage decisions couldn.t be loaded/);
    expect(html).not.toContain(NEEDS_DECISION_LABEL + "<");
    expect(html).not.toContain("data-decision-count");
    expect(html).not.toContain("Lawmatics: ");
    expect(names(html)).toHaveLength(5);
  });

  it("applyFilters never filters to nobody on a list with no flags", () => {
    const rows = buildIntakeRows({ leads: LEADS, stages: STAGES, members: [], now: NOW });
    expect(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, decision: true })).toEqual([]); // the workspace turns the filter off when unreadable
  });
});

describe("selecting several cards and 'Move to...'", () => {
  it("the board draws a tick box on every card and the bar; the table draws neither", () => {
    const board = text(render(BOARD));
    expect(board.match(/class="intake-select"/g)).toHaveLength(5);
    expect(board).toContain("Tick cards to move several at once.");
    expect(board).toContain("Select the 5 shown");
    const table = text(render({}));
    expect(table).not.toContain("intake-select");
    expect(table).not.toContain("data-bulk-bar");
  });

  it("works on the by-owner board too", () => {
    expect(text(render({ view: "board", group: "owner" })).match(/class="intake-select"/g)).toHaveLength(5);
  });

  it("each box is named for its lead", () => {
    expect(text(render(BOARD))).toContain('aria-label="Select Imported Tester"');
  });
});

describe("the bulk bar", () => {
  const noop = () => {};
  const bar = (over: Record<string, unknown> = {}) =>
    text(
      renderToStaticMarkup(
        <BulkMoveBar selectedCount={2} shownCount={5} stages={STAGES} pending={false} message={null} onSelectShown={noop} onClear={noop} onMove={noop} {...over} />,
      ),
    );

  it("offers every stage that does not open a matter, with its code, and never a won one", () => {
    const html = bar();
    expect(html).toContain("2 selected");
    expect(html).toContain("1 · Potential New Client");
    expect(html).toContain("3 · Post Consultation Email Sent");
    expect(html).not.toContain("Signed LOE");
    // Even a won stage handed to it is dropped.
    expect(bar({ stages: [...STAGES] })).not.toContain("9 · Signed LOE");
  });

  it("Move is disabled until a stage is chosen, and says so when too many are ticked", () => {
    expect(bar()).toMatch(/<button[^>]*disabled=""[^>]*>Move<\/button>/);
    expect(bar({ selectedCount: 201 })).toContain("Select at most 200 at a time.");
  });

  it("shows the busy state and a message", () => {
    expect(bar({ pending: true })).toContain("Moving…");
    expect(bar({ message: { tone: "error", text: "Nope." } })).toMatch(/role="alert"[^>]*>Nope\./);
    expect(bar({ message: { tone: "ok", text: "Moved 2 leads." } })).toMatch(/role="status"[^>]*>Moved 2 leads\./);
  });

  it("with nothing ticked it invites a tick and offers 'Select the N shown' (never more than 200)", () => {
    expect(bar({ selectedCount: 0 })).toContain("Tick cards to move several at once.");
    expect(bar({ selectedCount: 0, shownCount: 900 })).toContain("Select the 200 shown");
  });
});
