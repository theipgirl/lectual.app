import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Lead, Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import {
  buildIntakeRows,
  parseIntakeFilters,
  parseIntakeViewState,
  type IntakeSearchParams,
} from "@/lib/intake/rows";
import { intakeStages } from "@/lib/intake/scope";
import { LEADS_VIEW_HINT, leadsSubline } from "@/lib/intake/views";
import { DETAIL_NAMES, detailsNote } from "@/lib/intake/details-note";
import { COPIED_MS, copyViewLabel, viewUrl } from "@/lib/intake/copy-view";
import { leadsMoreItems } from "@/lib/intake/more-items";
import { COPIED, COPY_VIEW_LINK, NO_LEADS_YET, NO_LEAD_MATCHES, TEMPERATURE_TOOLTIP } from "@/lib/ui/words";
import IntakeWorkspace from "@/app/dashboard/intake/_components/IntakeWorkspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/app/dashboard/intake/actions", () => ({
  assignLeadAction: vi.fn(),
  moveStageAction: vi.fn(),
  setLaneAction: vi.fn(),
  setSourceAction: vi.fn(),
  bulkMoveStageAction: vi.fn(),
}));
vi.mock("@/app/dashboard/leads/actions", () => ({ createLeadAction: vi.fn() }));
vi.mock("@/app/dashboard/intake/time-actions", () => ({ startTimerAction: vi.fn(), stopTimerAction: vi.fn(), logTimeAction: vi.fn() }));

const NOW = new Date("2026-10-20T12:00:00.000Z");
const STAGES = [
  { id: "s1", org_id: "o", name: "New enquiry", order_index: 1, category: "open", aging_threshold_days: 30 },
  { id: "s9", org_id: "o", name: "Signed", order_index: 9, category: "won", aging_threshold_days: null },
] as unknown as Stage[];
const MEMBERS: MemberIdentity[] = [];

function lead(id: string, first: string): Lead {
  return {
    id, org_id: "o", first_name: first, last_name: "Tester", email: `${id}@example.com`, current_stage_id: "s1",
    stage_entered_at: NOW.toISOString(), assigned_to: null, temperature: null, lane: null, lane_set_by: null, lane_set_at: null,
    ai_summary: null, last_activity_at: null, last_outbound_at: null, last_inbound_at: null, mark_text: null, business_name: null,
    referral_source: null, referral_detail: null,
  } as unknown as Lead;
}

type Reads = { pendingApprovals?: { status: "unavailable" }; agentMoves?: unknown; stageDecisions?: unknown; showReconcile?: boolean };

function render(leads: Lead[], params: IntakeSearchParams = {}, reads: Reads = {}) {
  const rows = buildIntakeRows({ leads, stages: STAGES, members: MEMBERS, now: NOW });
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
      {...(reads as object)}
    />,
  );
}

describe("the Leads sub-line", () => {
  const counts = { inIntake: 25, needFirstReply: 6, unassigned: 3 };

  it("folds the former status strip into one short sentence per view", () => {
    expect(leadsSubline(counts, { board: false, group: "stage" })).toBe("25 leads · 6 need a first reply · 3 unassigned. Newest activity first.");
    expect(leadsSubline(counts, { board: true, group: "stage" })).toContain(LEADS_VIEW_HINT.stage);
    expect(LEADS_VIEW_HINT.stage).toBe("Drag a card to move it, or use the stage menu on the card.");
    expect(leadsSubline(counts, { board: true, group: "owner" })).toContain("Leads with no owner are in the first column.");
    expect(leadsSubline({ inIntake: 1, needFirstReply: 0, unassigned: 0 }, { board: false, group: "stage" })).toMatch(/^1 lead · /);
  });
});

describe("one note for the side reads that did not land", () => {
  const bad = { status: "unavailable" as const };
  const ok = { status: "ok" as const, truncated: false };

  it("is null when everything loaded", () => {
    expect(detailsNote({ approvals: { status: "ok" }, agentMoves: ok, stageDecisions: ok })).toBeNull();
    expect(detailsNote({})).toBeNull();
  });

  it.each([
    [{ approvals: bad }, ["approvals"]],
    [{ agentMoves: bad }, ["automatic moves"]],
    [{ stageDecisions: bad }, ["stage decisions"]],
    [{ approvals: bad, agentMoves: bad }, ["approvals", "automatic moves"]],
    [{ approvals: bad, agentMoves: bad, stageDecisions: bad }, ["approvals", "automatic moves", "stage decisions"]],
    [{ agentMoves: { status: "ok" as const, truncated: true } }, ["automatic moves"]],
  ])("names only the failed ones: %j", (reads, names) => {
    const note = detailsNote(reads);
    expect(note?.names).toEqual(names);
    expect(note?.text).toBe(`Some details couldn't load (${names.join(", ")}). Refresh to try again.`);
  });

  it("is ONE note with a Refresh button, shown only when a read failed", () => {
    expect(DETAIL_NAMES.approvals).toBe("approvals");
    const html = render([lead("a", "Ana")], {}, { pendingApprovals: bad, agentMoves: bad });
    expect(html.match(/data-details-note/g)).toHaveLength(1);
    expect(html).toContain("Some details couldn&#x27;t load (approvals, automatic moves). Refresh to try again.");
    expect(html).toContain(">Refresh</button>");
    expect(render([lead("a", "Ana")])).not.toContain("data-details-note");
  });

  it("leaves the chips that depend on a failed read off, exactly as before", () => {
    const html = render([lead("a", "Ana")], {}, { pendingApprovals: bad, agentMoves: bad, stageDecisions: bad });
    expect(html).not.toContain("Needs attorney");
    expect(html).not.toContain('aria-label="Filter by automatic moves"');
    expect(html).not.toContain("Needs a stage decision");
  });
});

describe("the arrows, the temperature words and the copy button", () => {
  it("prints the arrow legend beside the Last touch column header and no footer legend", () => {
    const html = render([lead("a", "Ana")]);
    expect(html).toMatch(/aria-label="Sort by Last touch"[^>]*>Last touch[^<]*<\/button><span class="lp-legend" data-arrow-legend="true">← waiting on us, → waiting on them<\/span>/);
    expect(html.match(/waiting on us, → waiting on them/g)).toHaveLength(1);
    expect(html).not.toContain("waiting on us · → waiting on them");
  });

  it("gives each row's arrow a title and a visually hidden label", () => {
    const html = render([lead("a", "Ana")]);
    expect(html).toMatch(/title="Waiting on (us|them)"/);
    expect(html).toMatch(/<span class="lx-sr">Waiting on (us|them): <\/span>/);
  });

  it("uses the exact temperature tooltip and calls the no-rating level Not rated", () => {
    const html = render([lead("a", "Ana")]);
    expect(html).toContain(`title="${TEMPERATURE_TOOLTIP.replace(/'/g, "&#x27;")}"`);
    expect(html).toContain(">Not rated<");
    expect(html).not.toContain("Not routed");
  });

  it("copies the same absolute URL as before and says Copied afterwards", () => {
    expect(viewUrl("/dashboard/intake/?temp=hot", "https://app.example.com")).toBe("https://app.example.com/dashboard/intake/?temp=hot");
    expect(viewUrl("/dashboard/intake/?temp=hot", null)).toBe("/dashboard/intake/?temp=hot");
    expect(copyViewLabel(false)).toBe(COPY_VIEW_LINK);
    expect(copyViewLabel(true)).toBe(COPIED);
    expect(COPIED_MS).toBe(1500);
    expect(render([lead("a", "Ana")])).toContain(">Copy link to this view<");
    expect(render([lead("a", "Ana")])).not.toContain("Save this view");
  });
});

describe("empty states", () => {
  it("no leads: the plain sentence, an Add lead button and a link to the intake form", () => {
    const html = render([]);
    expect(html).toContain(NO_LEADS_YET);
    expect(html).toMatch(/data-empty="none"[\s\S]*Add a lead[\s\S]*href="\/dashboard\/forms\/?"[^>]*>Open your intake form/);
  });

  it("filtered to nothing: the sentence and a Clear filters button", () => {
    const html = render([lead("a", "Ana")], { q: "zzzz" });
    expect(html).toContain(NO_LEAD_MATCHES);
    expect(html).toContain('data-empty="filtered"');
    expect(html).toMatch(/<button type="button" class="lp-clear">Clear filters<\/button>/);
  });
});

describe("More menu items", () => {
  it("Import for everyone, Reconcile stages only for the admin tier", () => {
    expect(leadsMoreItems({ showReconcile: false })).toEqual([{ label: "Import", href: "/dashboard/settings/integrations/lawmatics/" }]);
    expect(leadsMoreItems({ showReconcile: true })[0]).toEqual({ label: "Reconcile stages", href: "/dashboard/intake/reconcile/" });
  });
});

describe("the table starts on the first screen (768px tall)", () => {
  it("above the table there is only the header, one toolbar row and one chip row", () => {
    const html = render([lead("a", "Ana")]);
    const above = html.slice(0, html.indexOf('class="lp-panel"'));
    expect(above.match(/class="lp-header"/g)).toHaveLength(1);
    expect(above.match(/class="lp-toolbar"/g)).toHaveLength(1);
    expect(above.match(/class="lp-chips"/g)).toHaveLength(1);
    // Nothing else is stacked up there: no status strip, no warning lines while every read is fine.
    expect(above).not.toContain("intake-statusline");
    expect(above).not.toContain("data-details-note");
    expect(above).not.toContain('role="status"');
    expect(above.match(/<h1/g)).toHaveLength(1);
  });

  it("the shared stylesheet stacks no strips: the header, toolbar and chips are compact rows", () => {
    const css = readFileSync("src/components/list-page/list-page.css", "utf8");
    expect(css).toMatch(/\.lp-root \{[^}]*gap: var\(--lp-gap\)/);
    expect(css).toMatch(/\.lp-chip \{[^}]*height: 32px/);
    expect(css).toMatch(/\.lp-search \.lx-input \{[^}]*height: 36px/);
    expect(css).toContain("--lp-row-h: 46px");
  });
});
