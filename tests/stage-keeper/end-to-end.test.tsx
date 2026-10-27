import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Lead, Stage } from "@/lib/pipeline";
import { buildIntakeRows, applyFilters, EMPTY_INTAKE_FILTERS, parseIntakeFilters, parseIntakeViewState } from "@/lib/intake/rows";
import { intakeStages } from "@/lib/intake/scope";
import { chipsByLead, currentAgentMoves, movedTodayCount } from "@/lib/stage-keeper/moves";
import { Timeline } from "@/components/timeline/Timeline";
import IntakeWorkspace from "@/app/dashboard/intake/_components/IntakeWorkspace";
import { runStageKeeper } from "../../src/lib/agents/stage-keeper/run";
import { agentRows, event, keeperWorld, lead, mail } from "./db";
import { form, loadKeeperActions } from "./actions-harness";
import { FIRM, L, S, daysAgo } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/app/dashboard/intake/actions", () => ({ assignLeadAction: vi.fn(), moveStageAction: vi.fn(), setLaneAction: vi.fn(), setSourceAction: vi.fn() }));
vi.mock("@/app/dashboard/leads/actions", () => ({ createLeadAction: vi.fn() }));
vi.mock("@/app/dashboard/intake/time-actions", () => ({ startTimerAction: vi.fn(), stopTimerAction: vi.fn(), logTimeAction: vi.fn() }));

/** D1 and D2: the agent's real output, drawn by the real components. */

const NOW = new Date("2026-09-25T12:00:00Z");
const ZONE = "America/New_York";
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("<!-- -->", "");

const STAGES = FIRM.map((s) => ({ id: s.id, org_id: "o", name: s.name, order_index: s.orderIndex, category: s.category, aging_threshold_days: null })) as unknown as Stage[];

function renderBoard(leadRows: Record<string, unknown>[], activity: Record<string, unknown>[], view: Record<string, string> = {}) {
  const chips = chipsByLead(currentAgentMoves(activity as never, NOW), NOW, ZONE);
  const leads = leadRows.map((l) => ({ ...l, first_name: "Amara", last_name: "Nwosu", email: "amara@example.com", assigned_to: null, last_outbound_at: null, last_inbound_at: null, mark_text: null, business_name: null, referral_source: null, referral_detail: null, temperature: null, ai_summary: null, lane_set_by: null, lane_set_at: null })) as unknown as Lead[];
  const rows = buildIntakeRows({ leads, stages: STAGES, members: [], agentMoveByLeadId: chips, now: NOW });
  const html = text(
    renderToStaticMarkup(
      <IntakeWorkspace
        rows={rows}
        stages={STAGES}
        intakeStages={intakeStages(STAGES)}
        members={[]}
        initialFilters={parseIntakeFilters(view)}
        initialViewState={parseIntakeViewState(view)}
        time={null}
        now={NOW.toISOString()}
        agentMoves={{ status: "ok", truncated: false }}
      />,
    ),
  );
  return { html, rows, chips };
}

describe("D1 an agent move, end to end", () => {
  it("a lead in New PNC with a synced LOE email and a booked consult is placed once, at the furthest stage, and everyone can see why", async () => {
    const w = keeperWorld({
      leads: [lead(L.amara, S.newPnc)],
      activity: [mail(L.amara, "loe-invoice", { at: "2026-09-23T10:00:00.000Z", subject: "Your engagement letter" })],
      events: [event(L.amara)],
    });
    const first = await runStageKeeper(w.ctx("act").ctx);
    const second = await runStageKeeper(w.ctx("act").ctx);

    // Once, at the furthest-forward stage (LOE, not the consult).
    expect(first.itemsIn).toBe(1);
    expect(second.itemsIn).toBe(0);
    expect(agentRows(w.rows("crm_activity"))).toHaveLength(1);
    expect(w.rows("crm_lead")[0]).toMatchObject({ current_stage_id: S.loe, stage_entered_at: "2026-09-23T10:00:00.000Z" });

    // The timeline row carries the evidence.
    const [row] = agentRows(w.rows("crm_activity"));
    expect(row.payload).toMatchObject({ from_stage: "New PNC", to_stage: "LOE & Invoice Sent", evidence: { kind: "mail", type: "loe-invoice", at: "2026-09-23T10:00:00.000Z", subject: "Your engagement letter" } });

    // The Intake rows built from the result show the chip on the table and the one-line reason on the board card.
    for (const [view, wording] of [
      [{}, "Moved by agent · LOE sent Sep 23"],
      [{ view: "board" }, "Moved automatically · LOE sent Sep 23"],
    ] as Array<[Record<string, string>, string]>) {
      const { html } = renderBoard(w.rows("crm_lead"), w.rows("crm_activity"), view);
      expect(html).toContain(wording);
      expect(html).toContain('title="Evidence: LOE and invoice email sent Sep 23."');
    }

    // The lead-page timeline shows the sentence, with Undo while it is still the lead's stage.
    const timeline = text(renderToStaticMarkup(<Timeline rows={w.rows("crm_activity") as never} timeZone={ZONE} undo={{ leadId: L.amara, canMove: true, currentStageId: S.loe }} />));
    expect(timeline).toContain("Stage Keeper moved this lead from New PNC to LOE & Invoice Sent because an LOE and invoice email was sent on Sep 23");
    expect(timeline).toContain("Your engagement letter");
    expect(timeline).toMatch(/>Undo<\/button>/);
  });
});

describe("D2 the Undo round trip", () => {
  it("puts the lead back with its earlier date; the chip, the Undo button and the filter listing are gone; a second run leaves it alone", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], activity: [mail(L.amara, "loe-invoice", { at: "2026-09-23T10:00:00.000Z" })] });
    await runStageKeeper(w.ctx("act").ctx);
    const move = agentRows(w.rows("crm_activity"))[0];
    expect(renderBoard(w.rows("crm_lead"), w.rows("crm_activity")).html).toContain("Moved by agent");
    expect(renderBoard(w.rows("crm_lead"), w.rows("crm_activity"), { view: "board" }).html).toContain("Moved automatically");

    const { actions, db } = await loadKeeperActions({ leads: w.rows("crm_lead"), activity: w.rows("crm_activity") });
    expect(await actions.undoAgentMoveAction({}, form({ leadId: L.amara, activityId: move.id }))).toEqual({ ok: true });
    expect(db.rows("crm_lead")[0]).toMatchObject({ current_stage_id: S.newPnc, stage_entered_at: daysAgo(10) });

    // The undo row is stamped by the real clock, so "now" for the read-back is the real now.
    const real = new Date();
    const chips = chipsByLead(currentAgentMoves(db.rows("crm_activity") as never, real), real, ZONE);
    expect(chips[L.amara]).toBeUndefined();
    expect(movedTodayCount(chips)).toBe(0);
    const rows = buildIntakeRows({ leads: db.rows("crm_lead") as never, stages: STAGES, members: [], agentMoveByLeadId: chips, now: real });
    expect(applyFilters(rows, { ...EMPTY_INTAKE_FILTERS, agent: "7d" })).toEqual([]);
    expect(rows[0].agentMove).toBeUndefined();

    const timeline = text(renderToStaticMarkup(<Timeline rows={db.rows("crm_activity") as never} timeZone={ZONE} undo={{ leadId: L.amara, canMove: true, currentStageId: S.newPnc }} />));
    expect(timeline).not.toMatch(/>Undo<\/button>/);
    expect(timeline).toContain("Undone");
    expect(timeline).toContain("Moved back to New PNC");

    const again = keeperWorld({ leads: db.rows("crm_lead"), activity: db.rows("crm_activity") });
    expect((await runStageKeeper(again.ctx("act").ctx)).itemsIn).toBe(0);
    expect(again.rows("crm_lead")[0].current_stage_id).toBe(S.newPnc);
    expect(again.rows("crm_activity").filter((r) => r.payload?.source === "stage-keeper")).toEqual([]);
  });
});
