import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { Lead, Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import {
  applyFilters,
  buildIntakeRows,
  filtersToQueryString,
  intakeHref,
  intakeQueryString,
  parseIntakeFilters,
  parseIntakeViewState,
  EMPTY_INTAKE_FILTERS,
  type IntakeSearchParams,
} from "@/lib/intake/rows";
import { intakeStages } from "@/lib/intake/scope";
import { chipFor, chipsByLead, currentAgentMoves, movedTodayCount, type ActivityRow } from "@/lib/stage-keeper/moves";
import IntakeWorkspace from "@/app/dashboard/intake/_components/IntakeWorkspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/app/dashboard/intake/actions", () => ({ assignLeadAction: vi.fn(), moveStageAction: vi.fn(), setLaneAction: vi.fn(), setSourceAction: vi.fn() }));
vi.mock("@/app/dashboard/leads/actions", () => ({ createLeadAction: vi.fn() }));
vi.mock("@/app/dashboard/intake/time-actions", () => ({ startTimerAction: vi.fn(), stopTimerAction: vi.fn(), logTimeAction: vi.fn() }));

/**
 * The Stage Keeper on the Intake board and table (Sprint 16): the chip, its tooltip, the "Agent moves"
 * filter and the URL it lives in, and what an unreadable move list does to all of them.
 */

const NOW = new Date("2026-10-20T16:00:00.000Z"); // noon in New York
const ZONE = "America/New_York";
const hoursBefore = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

const STAGES = [
  { id: "s1", org_id: "o", name: "New PNC", order_index: 1, category: "open", aging_threshold_days: 30 },
  { id: "s2", org_id: "o", name: "Consultation Scheduled", order_index: 2, category: "open", aging_threshold_days: 30 },
  { id: "s7", org_id: "o", name: "LOE & Invoice Sent", order_index: 7, category: "open", aging_threshold_days: 30 },
  { id: "s9", org_id: "o", name: "Signed", order_index: 9, category: "won", aging_threshold_days: null },
] as unknown as Stage[];
const MEMBERS: MemberIdentity[] = [];

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

const agentRow = (leadId: string, hoursAgo: number, over: Record<string, unknown> = {}): ActivityRow => ({
  id: `agent-${leadId}`,
  lead_id: leadId,
  type: "stage_changed",
  actor_type: "ai",
  created_at: hoursBefore(hoursAgo),
  payload: {
    actor: "agent:stage-keeper",
    to_stage_id: "s7",
    to_stage: "LOE & Invoice Sent",
    signal: "loe-invoice-sent",
    evidence: { kind: "mail", type: "loe-invoice", direction: "outbound", at: "2026-10-20T14:00:00.000Z", subject: "Engagement" },
    ...over,
  },
});
const personRow = (leadId: string, hoursAgo: number): ActivityRow => ({ id: `person-${leadId}`, lead_id: leadId, type: "stage_changed", actor_type: "user", created_at: hoursBefore(hoursAgo), payload: { to_stage: "Elsewhere" } });

const LEADS = [lead("l-today", "Today"), lead("l-old", "Older"), lead("l-none", "Nobody"), lead("l-person", "Overridden")];
const ROWS: ActivityRow[] = [
  agentRow("l-today", 2),
  // Three days ago, and a consult: the date on the chip is the day the agent placed the lead.
  agentRow("l-old", 72, { signal: "consult-scheduled", to_stage: "Consultation Scheduled", evidence: { kind: "calendar", title: "Strategy session", starts_at: "2026-10-24T18:00:00.000Z" } }),
  // The agent moved it, then a person moved it again: no longer the agent's.
  agentRow("l-person", 10),
  personRow("l-person", 4),
];

const moves = currentAgentMoves(ROWS, NOW);
const chips = chipsByLead(moves, NOW, ZONE);
const rowsWithChips = () => buildIntakeRows({ leads: LEADS, stages: STAGES, members: MEMBERS, agentMoveByLeadId: chips, now: NOW });

type Props = { agentMoves?: { status: "ok"; truncated: boolean } | { status: "unavailable" }; withChips?: boolean };
function render(params: IntakeSearchParams = {}, props: Props = {}) {
  const rows = props.withChips === false ? buildIntakeRows({ leads: LEADS, stages: STAGES, members: MEMBERS, now: NOW }) : rowsWithChips();
  return renderToStaticMarkup(
    <IntakeWorkspace
      rows={rows}
      stages={STAGES}
      intakeStages={intakeStages(STAGES)}
      members={MEMBERS}
      initialFilters={parseIntakeFilters(params)}
      initialViewState={parseIntakeViewState(params)}
      time={null}
      now={NOW.toISOString()}
      agentMoves={"agentMoves" in props ? props.agentMoves : { status: "ok", truncated: false }}
    />,
  );
}
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("<!-- -->", "");
const names = (html: string) => ["Today", "Older", "Nobody", "Overridden"].filter((n) => html.includes(`>${n} Tester<`));

describe("which moves are still the agent's", () => {
  it("keeps an agent move only while it is the lead's latest stage change, within 7 days", () => {
    expect([...moves.keys()].sort()).toEqual(["l-old", "l-today"]);
    expect(currentAgentMoves([agentRow("x", 24 * 8)], NOW).size).toBe(0);
  });

  it("an Undo (a person's row) removes it too", () => {
    const undo: ActivityRow = { id: "u", lead_id: "l-today", type: "stage_changed", actor_type: "user", created_at: hoursBefore(1), payload: { undoes_activity_id: "agent-l-today" } };
    expect(currentAgentMoves([...ROWS, undo], NOW).has("l-today")).toBe(false);
  });
});

describe("the chip", () => {
  it("reads 'Moved by agent · LOE sent Oct 20' with the evidence as its tooltip", () => {
    expect(chips["l-today"].text).toBe("Moved by agent · LOE sent Oct 20");
    expect(chips["l-today"].tooltip).toBe("Evidence: LOE and invoice email sent Oct 20.");
  });

  it("has a natural label for all four signals", () => {
    const label = (signal: string, evidence: Record<string, unknown>) => chipFor({ ...currentAgentMoves([agentRow("a", 1, { signal, evidence })], NOW).get("a")! }, NOW, ZONE).text;
    expect(label("loe-invoice-sent", { kind: "mail", type: "loe-invoice", direction: "outbound", at: "2026-10-20T14:00:00Z", subject: null })).toBe("Moved by agent · LOE sent Oct 20");
    expect(label("questionnaire-sent", { kind: "mail", type: "questionnaire", direction: "outbound", at: "2026-10-18T14:00:00Z", subject: null })).toBe("Moved by agent · Questionnaire sent Oct 18");
    expect(label("post-consult-sent", { kind: "mail", type: "post-consult", direction: "outbound", at: "2026-10-19T14:00:00Z", subject: null })).toBe("Moved by agent · Post-consult sent Oct 19");
    expect(label("consult-scheduled", { kind: "calendar", title: "Strategy session", starts_at: "2026-10-24T18:00:00Z" })).toBe("Moved by agent · Consult booked Oct 20");
  });

  it("a consult's tooltip carries the event title and time, in the firm's zone", () => {
    expect(chips["l-old"].tooltip).toBe('Evidence: calendar event "Strategy session" on Oct 24 at 2:00 PM.');
  });

  it("the board card and the table row both draw it, with a drawn icon hidden from screen readers", () => {
    for (const params of [{}, { view: "board" }, { view: "board", group: "owner" }] as IntakeSearchParams[]) {
      const html = text(render(params));
      expect(html, JSON.stringify(params)).toContain("Moved by agent · LOE sent Oct 20");
      expect(html).toContain("Moved by agent · Consult booked Oct 17");
      expect(html).toContain('title="Evidence: LOE and invoice email sent Oct 20."');
      expect(html).toMatch(/class="intake-agent-chip"[^>]*><svg[^>]*aria-hidden="true"/);
      // The lead a person moved afterwards, and the one never moved, carry no chip.
      expect(html.match(/intake-agent-chip/g)).toHaveLength(2);
    }
  });

  it("no emoji character is drawn", () => {
    expect(render({ view: "board" })).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    for (const file of ["AgentMoveChip.tsx", "icons.tsx", "IntakeControls.tsx", "IntakeCard.tsx"]) {
      expect(readFileSync(`src/app/dashboard/intake/_components/${file}`, "utf8"), file).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });
});

describe("the Agent moves filter", () => {
  it("round-trips through the URL helpers, and an unknown value is dropped", () => {
    expect(parseIntakeFilters({ agent: "today" }).agent).toBe("today");
    expect(parseIntakeFilters({ agent: "7d" }).agent).toBe("7d");
    expect(parseIntakeFilters({ agent: "yesterday" }).agent).toBeUndefined();
    expect(parseIntakeFilters({}).agent).toBeUndefined();
    expect(parseIntakeFilters({ agent: ["7d", "today"] }).agent).toBe("7d");
    for (const agent of ["today", "7d"] as const) {
      const filters = { ...EMPTY_INTAKE_FILTERS, agent };
      expect(filtersToQueryString(filters)).toBe(`agent=${agent}`);
      expect(parseIntakeFilters(Object.fromEntries(new URLSearchParams(intakeQueryString(filters, parseIntakeViewState({})))))).toMatchObject({ agent });
    }
    expect(intakeHref({ ...EMPTY_INTAKE_FILTERS, agent: "today" }, parseIntakeViewState({ view: "board" }))).toBe("/dashboard/intake/?agent=today&view=board");
    expect(filtersToQueryString({ ...EMPTY_INTAKE_FILTERS, agent: null })).toBe("");
    expect(filtersToQueryString(EMPTY_INTAKE_FILTERS)).toBe("");
  });

  it("applyFilters: today keeps the moved-today set, 7d keeps every chip, neither drops anyone", () => {
    const rows = rowsWithChips();
    const ids = (agent?: "today" | "7d") => applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, ...(agent ? { agent } : {}) }).map((r) => r.lead.id).sort();
    expect(ids("today")).toEqual(["l-today"]);
    expect(ids("7d")).toEqual(["l-old", "l-today"]);
    expect(ids()).toEqual(["l-none", "l-old", "l-person", "l-today"]);
  });

  it("works on the table and on both boards, and narrows the list to the moved leads", () => {
    for (const view of [{}, { view: "board" }, { view: "board", group: "owner" }] as IntakeSearchParams[]) {
      expect(names(render({ ...view, agent: "today" })), JSON.stringify(view)).toEqual(["Today"]);
      expect(names(render({ ...view, agent: "7d" })), JSON.stringify(view)).toEqual(["Today", "Older"]);
      expect(names(render(view)), JSON.stringify(view)).toEqual(["Today", "Older", "Nobody", "Overridden"]);
    }
  });

  it("is offered as a control with the counts, and shows which window is on", () => {
    const html = text(render());
    expect(html).toContain('aria-label="Filter by agent moves"');
    expect(html).toContain("Agent moves");
    expect(text(render({ agent: "today" }))).toContain("Agent moves · Today");
    expect(text(render({ agent: "7d" }))).toContain("Agent moves · 7 days");
  });

  it("D5: the rows the Today filter keeps, the chips drawn for today and the Agents-page count are one set", () => {
    const rows = rowsWithChips();
    const kept = applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, agent: "today" });
    expect(kept.map((r) => r.lead.id)).toEqual(["l-today"]);
    expect(kept.length).toBe(movedTodayCount(chips));
    expect(Object.entries(chips).filter(([, c]) => c.today).map(([id]) => id)).toEqual(["l-today"]);
    // A lead moved by the agent and then by a person is in none of them.
    expect(chips["l-person"]).toBeUndefined();
    expect(kept.some((r) => r.lead.id === "l-person")).toBe(false);
  });

  it("'today' is the firm's civil day, not UTC's", () => {
    // 02:00Z on the 21st is still the evening of the 20th in New York, and "now" is noon on the 20th there.
    const late = { ...agentRow("l-late", 0), created_at: "2026-10-21T02:00:00.000Z" };
    expect(chipFor(currentAgentMoves([late], new Date("2026-10-21T03:00:00Z")).get("l-late")!, new Date("2026-10-21T03:00:00Z"), ZONE).today).toBe(true);
    expect(chipFor(currentAgentMoves([late], new Date("2026-10-21T03:00:00Z")).get("l-late")!, new Date("2026-10-21T03:00:00Z"), "Pacific/Auckland").today).toBe(true);
    const earlier = { ...agentRow("l-early", 0), created_at: "2026-10-20T03:30:00.000Z" }; // 11:30pm on the 19th in New York
    expect(chipFor(currentAgentMoves([earlier], NOW).get("l-early")!, NOW, ZONE).today).toBe(false);
    expect(chipFor(currentAgentMoves([earlier], NOW).get("l-early")!, NOW, "UTC").today).toBe(true);
  });
});

describe("when the moves couldn't be read", () => {
  const unavailable: Props = { agentMoves: { status: "unavailable" }, withChips: false };

  it("shows a one-line note, no chip and no filter control, and the list is never filtered to nobody", () => {
    for (const view of [{}, { view: "board" }] as IntakeSearchParams[]) {
      const html = text(render({ ...view, agent: "today" }, unavailable));
      expect(html).toMatch(/Agent moves couldn.t be loaded/);
      expect(html).not.toContain("intake-agent-chip");
      expect(html).not.toContain('aria-label="Filter by agent moves"');
      expect(names(html)).toEqual(["Today", "Older", "Nobody", "Overridden"]);
      expect(html).not.toContain("No lead matches these filters");
    }
  });

  it("and the unavailable filter stays out of the saved link", () => {
    const html = text(render({ agent: "today" }, unavailable));
    expect(html).not.toContain("agent=today");
  });

  it("with the prop absent (an older caller) nothing about agent moves shows", () => {
    const html = text(render({}, { agentMoves: undefined, withChips: false }));
    expect(html).not.toContain("intake-agent-chip");
    expect(html).not.toMatch(/Agent moves/);
  });

  it("a read that hit its row cap says only the most recent moves are marked", () => {
    expect(text(render({}, { agentMoves: { status: "ok", truncated: true } }))).toContain("only the most recent are marked");
    expect(text(render())).not.toContain("only the most recent are marked");
  });
});

describe("styles", () => {
  it("the chip uses the Intake tokens in intake.css, and the global stylesheet is not touched", () => {
    const css = readFileSync("src/app/dashboard/intake/intake.css", "utf8");
    const block = css.slice(css.indexOf(".intake-agent-chip"));
    expect(block).toContain("var(--oxbg)");
    expect(block).toContain("var(--ox)");
    expect(readFileSync("src/app/globals.css", "utf8")).not.toContain("intake-agent-chip");
  });
});
