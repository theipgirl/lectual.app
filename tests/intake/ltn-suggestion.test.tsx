import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { Lead, Stage } from "@/lib/pipeline";
import { LtnSuggestion } from "@/components/intake/LtnSuggestion";
import { TemperatureCard } from "@/components/leads/TemperatureCard";
import IntakeCard from "@/app/dashboard/intake/_components/IntakeCard";
import { buildIntakeRows } from "@/lib/intake/rows";
import { effectiveTemperature } from "@/lib/intake/effective-temperature";
import { laneView } from "@/lib/leads/lane";

// IntakeCard's time chip reads the app router; a server render has none mounted.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
// The lead page card posts to server actions; a static render only needs their names.
vi.mock("@/app/dashboard/leads/[id]/sequence-actions", () => ({
  setLeadLaneAction: vi.fn(),
  addToNurtureAction: vi.fn(),
}));

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const NOW = new Date("2026-10-20T12:00:00.000Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("LtnSuggestion", () => {
  it("shows the words and a link to the lead page", () => {
    const html = renderToStaticMarkup(<LtnSuggestion suggestion="long_term_nurture" leadId="lead-9" />);
    expect(html).toContain("Long-Term Nurture suggested");
    expect(html).toContain('href="/dashboard/leads/lead-9');
  });

  it("links to the Sequences card from the lead page itself", () => {
    const html = renderToStaticMarkup(<LtnSuggestion suggestion="long_term_nurture" leadId="lead-9" target="sequences" />);
    expect(html).toContain('href="#sequences-heading"');
  });

  it("renders nothing without a suggestion", () => {
    expect(renderToStaticMarkup(<LtnSuggestion suggestion={undefined} leadId="lead-9" />)).toBe("");
  });

  it("is text and a link, not a control that moves anything", () => {
    const html = renderToStaticMarkup(<LtnSuggestion suggestion="long_term_nurture" leadId="lead-9" />);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });
});

describe("TemperatureCard (lead page)", () => {
  const stages = [{ id: "s1", category: "open" }] as Stage[];
  const lead = {
    temperature: null,
    current_stage_id: "s1",
    last_activity_at: null,
    last_outbound_at: daysBefore(2),
    last_inbound_at: null,
    ai_summary: null,
    lane: null,
    lane_set_at: null,
  };
  const card = (facts: Parameters<typeof effectiveTemperature>[3]) =>
    renderToStaticMarkup(
      <TemperatureCard
        leadId="L1"
        temperature={effectiveTemperature(lead, stages, NOW, facts)}
        view={laneView(lead)}
        setByName={null}
        setOn={null}
        redFlags={[]}
        nextStep={null}
        nextStepIsSuggested={false}
        nurtureStatus={null}
        linksFailed={false}
        canWrite={false}
      />,
    );

  it("shows the temperature, its reason and the suggestion", () => {
    const html = card({ firstTouchAt: daysBefore(11) });
    expect(html).toContain("Suggested: Cold");
    expect(html).toContain("Unbooked by day 10");
    expect(html).toContain("Long-Term Nurture suggested");
    // Said once, not twice.
    expect(html.match(/Long-Term Nurture suggested/g)).toHaveLength(1);
  });

  it("shows the sequence reason with no suggestion", () => {
    const html = card({ sequenceEndedNoReplyAt: daysBefore(1) });
    expect(html).toContain("3-email sequence ended, no reply");
    expect(html).not.toContain("Long-Term Nurture");
  });
});

describe("where the suggestion is shown", () => {
  it("the card, the table and the lead page each use the component", () => {
    expect(read("src/app/dashboard/intake/_components/IntakeCard.tsx")).toContain("<LtnSuggestion");
    expect(read("src/app/dashboard/intake/_components/IntakeTable.tsx")).toContain("<LtnSuggestion");
    expect(read("src/components/leads/TemperatureCard.tsx")).toContain("<LtnSuggestion");
    expect(read("src/app/dashboard/leads/[id]/page.tsx")).toContain("<TemperatureCard");
  });

  it("an intake card for a day-10 lead renders the suggestion", () => {
    const stage = { id: "s1", name: "Follow-Up", category: "open", order_index: 1, aging_threshold_days: 7 } as unknown as Stage;
    const lead = {
      id: "L1",
      first_name: "Ana",
      last_name: "Ruiz",
      email: "a@x.test",
      current_stage_id: "s1",
      stage_entered_at: daysBefore(12),
      temperature: null,
      assigned_to: null,
      last_activity_at: null,
      last_outbound_at: daysBefore(2),
      last_inbound_at: null,
    } as unknown as Lead;
    const [row] = buildIntakeRows({
      leads: [lead],
      stages: [stage],
      members: [],
      factsByLeadId: { L1: { firstTouchAt: daysBefore(11), bookedAt: null } },
      now: NOW,
    });
    const html = renderToStaticMarkup(
      <IntakeCard
        row={row}
        variant="stage"
        stages={[stage]}
        members={[]}
        now={NOW}
        pending={false}
        time={null}
        onMoveStage={() => {}}
        onAssign={() => {}}
        onSetSource={() => {}}
      />,
    );
    expect(html).toContain("Long-Term Nurture suggested");
    expect(html).toContain('href="/dashboard/leads/L1');
  });
});

describe("the temperature code never writes", () => {
  const files = [
    "src/lib/intake/temperature.ts",
    "src/lib/intake/facts.ts",
    "src/components/intake/LtnSuggestion.tsx",
    "src/lib/intake/effective-temperature.ts",
    "src/lib/intake/rows.ts",
  ];
  for (const file of files) {
    it(`${file} has no write path`, () => {
      const source = read(file);
      expect(source).not.toMatch(/\.update\(|\.insert\(|\.delete\(|\.upsert\(/);
      expect(source).not.toContain('.from("crm_lead")');
      expect(source).not.toMatch(/setLane|setTemperature|moveLeadStage/);
    });
  }
});
