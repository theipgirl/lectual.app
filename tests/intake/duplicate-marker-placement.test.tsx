import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Lead, Stage } from "@/lib/pipeline";
import { buildIntakeRows, parseIntakeFilters, parseIntakeViewState, type IntakeSearchParams } from "@/lib/intake/rows";
import { intakeStages } from "@/lib/intake/scope";
import IntakeWorkspace from "@/app/dashboard/intake/_components/IntakeWorkspace";
import type { DecisionFlag } from "@/lib/intake/stage-decision";

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

/** The "Possible duplicate" marker lives in the Stage cell (list), so the business name has the whole Lead column. */

const NOW = new Date("2026-10-27T16:00:00.000Z");
const STAGES = [{ id: "s1", org_id: "o", name: "Potential New Client", order_index: 1, category: "open", aging_threshold_days: 30 }] as unknown as Stage[];
const lead = (id: string, first: string): Lead =>
  ({
    id,
    org_id: "o",
    first_name: first,
    last_name: "Tester",
    email: `${id}@example.com`,
    current_stage_id: "s1",
    stage_entered_at: NOW.toISOString(),
    assigned_to: null,
    temperature: null,
    lane: null,
    lane_set_by: null,
    lane_set_at: null,
    ai_summary: null,
    last_activity_at: NOW.toISOString(),
    last_outbound_at: null,
    last_inbound_at: null,
    mark_text: null,
    business_name: "Maple Home Services",
    referral_source: null,
    referral_detail: null,
  }) as unknown as Lead;

const DUPS = { a: { leadId: "b", name: "Other Tester", stageName: "Potential New Client" } };
const FLAG: DecisionFlag = { lawmaticsStage: "Discovery Call Complete", hired: false, stageId: "s1" };

function render(params: IntakeSearchParams) {
  const rows = buildIntakeRows({ leads: [lead("a", "Alpha")], stages: STAGES, members: [], decisionByLeadId: { a: FLAG }, now: NOW });
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
      duplicates={DUPS}
      agentMoves={{ status: "ok", truncated: false }}
      stageDecisions={{ status: "ok", truncated: false }}
    />,
  );
}
const cell = (html: string, col: string) => {
  const start = html.indexOf(`data-col="${col}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('data-col="', start + 10));
};

describe("Possible duplicate marker in the list", () => {
  const html = render({ view: "table" } as IntakeSearchParams);
  it("sits in the Stage cell beside 'Needs a stage', not in the lead cell", () => {
    expect(cell(html, "stage")).toContain("data-duplicate");
    expect(cell(html, "stage")).toContain("data-needs-decision");
    expect(cell(html, "lead")).not.toContain("data-duplicate");
    expect(cell(html, "lead")).toContain("Maple Home Services");
  });
  it("still links to the other lead with its tooltip", () => {
    expect(cell(html, "stage")).toContain('href="/dashboard/leads/b/"');
    expect(cell(html, "stage")).toContain("title=");
  });
  it("board cards keep the marker where it was", () => {
    expect(render({ view: "board" } as IntakeSearchParams)).toContain("data-duplicate");
  });
});
