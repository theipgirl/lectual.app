import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { Stage } from "@/lib/pipeline";
import { TemperatureCard } from "@/components/leads/TemperatureCard";
import { effectiveTemperature, type EffectiveTemperatureLead } from "@/lib/intake/effective-temperature";
import { laneView, nextStepForLane, type NextStep } from "@/lib/leads/lane";

// The card posts to server actions; a static render only needs their names.
vi.mock("@/app/dashboard/leads/[id]/sequence-actions", () => ({
  setLeadLaneAction: vi.fn(),
  addToNurtureAction: vi.fn(),
}));

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const NOW = new Date("2026-10-20T12:00:00.000Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const STAGES = [{ id: "s1", category: "open" }] as Stage[];

type LeadOverrides = Partial<EffectiveTemperatureLead> & { ai_red_flags?: string[] };

function card(over: LeadOverrides = {}, props: { canWrite?: boolean; nextStep?: NextStep | null; facts?: Parameters<typeof effectiveTemperature>[3] } = {}) {
  const lead: EffectiveTemperatureLead = {
    temperature: null,
    lane: null,
    lane_set_at: null,
    ai_summary: null,
    current_stage_id: "s1",
    last_activity_at: null,
    last_outbound_at: null,
    last_inbound_at: null,
    ...over,
  };
  return renderToStaticMarkup(
    <TemperatureCard
      leadId="L1"
      temperature={effectiveTemperature(lead, STAGES, NOW, props.facts)}
      view={laneView(lead)}
      setByName={lead.lane ? "Rebecca Beliard" : null}
      setOn={lead.lane ? "Oct 19" : null}
      redFlags={over.ai_red_flags ?? []}
      nextStep={props.nextStep ?? null}
      nextStepIsSuggested={false}
      nurtureStatus={null}
      linksFailed={false}
      canWrite={props.canWrite ?? true}
    />,
  );
}

describe("the merged lead-page card", () => {
  it("has one heading, Temperature, and no Lane heading or standalone 'Temperature:' line", () => {
    const html = card({ lane: "hot", lane_set_at: daysBefore(1), last_activity_at: daysBefore(2) });
    expect(html.match(/<h2[^>]*>[^<]*<\/h2>/g)).toEqual([expect.stringContaining(">Temperature</h2>")]);
    expect(html).not.toMatch(/<h2[^>]*>Lane</);
    expect(html).not.toContain("Temperature:");
    expect(html).not.toContain("Lane</h2>");
  });

  it("shows a set lane as a solid chip with who set it and when", () => {
    const html = card({ lane: "hot", lane_set_at: daysBefore(1), last_activity_at: daysBefore(2) });
    expect(html).toMatch(/<span class="lx-pill lx-pill-risk">Hot<\/span>/);
    expect(html).toContain("set by Rebecca Beliard · Oct 19");
    expect(html).toContain("Set by a person");
    expect(html).not.toContain("dashed currentColor");
  });

  it("shows a derived temperature as a dashed chip that says Suggested, with its reason", () => {
    const html = card({ last_inbound_at: daysBefore(1) });
    expect(html).toContain("Suggested: Hot");
    expect(html).toContain("dashed currentColor");
    expect(html).toContain("Replied 1 day ago — waiting on us");
    expect(html).not.toContain("set by");
  });

  it("shows Not rated when nothing is known", () => {
    const html = card();
    expect(html).toContain("Not rated");
    expect(html).toContain("Never touched");
  });

  it("shows the activity hint when a lane has gone stale", () => {
    const html = card({ lane: "cold", lane_set_at: daysBefore(5), last_inbound_at: daysBefore(2) });
    expect(html).toContain("Activity: hot · Replied 2 days ago — waiting on us");
    const agreed = card({ lane: "hot", lane_set_at: daysBefore(5), last_inbound_at: daysBefore(2) });
    expect(agreed).not.toContain("Activity:");
  });

  it("labels the triage suggestion as a suggestion, with its red flags", () => {
    const html = card({ ai_summary: "HOT — ready to file", ai_red_flags: ["Mark already in use"], last_activity_at: daysBefore(6) });
    expect(html).toContain("Triage suggestion — not a decision");
    expect(html).toContain("Suggested: Hot — ready to file");
    expect(html).toContain("Mark already in use");
    expect(card()).toContain("No triage suggestion for this lead.");
  });

  it("says when a person's temperature overrides the suggestion", () => {
    const html = card({ lane: "cold", lane_set_at: daysBefore(0), ai_summary: "HOT — ready to file", last_activity_at: daysBefore(3) });
    expect(html).toContain("Overridden: the temperature above was set by a person and wins.");
  });

  it("gives staff the control to set or clear it, and a read-only role none", () => {
    const staff = card({ lane: "warm", lane_set_at: daysBefore(0) }, { canWrite: true });
    expect(staff).toContain('<select class="lx-input" name="lane"');
    expect(staff).toContain("Save temperature");
    expect(staff).toContain("Clear (not set)");
    for (const level of ["Hot", "Warm", "Cold"]) expect(staff).toContain(`>${level}`);

    const readOnly = card({ lane: "warm", lane_set_at: daysBefore(0) }, { canWrite: false });
    expect(readOnly).not.toContain("<select");
    expect(readOnly).not.toContain("<form");
    expect(readOnly).not.toContain("Save temperature");
  });

  it("shows the next step the lane points at", () => {
    const nextStep = nextStepForLane("hot", {
      strategySessionUrl: "https://book.example.com/strategy",
      discoveryCallUrl: null,
      nurtureSequenceId: null,
    });
    const html = card({ lane: "hot", lane_set_at: daysBefore(0), last_activity_at: daysBefore(1) }, { nextStep });
    expect(html).toContain("Next step");
    expect(html).toContain("Book a strategy session");
    expect(html).toContain('href="https://book.example.com/strategy"');
  });

  it("shows the Long-Term Nurture suggestion once, with a link to the Sequences card", () => {
    const html = card({ last_outbound_at: daysBefore(2) }, { facts: { firstTouchAt: daysBefore(11) } });
    expect(html.match(/Long-Term Nurture suggested/g)).toHaveLength(1);
    expect(html).toContain('href="#sequences-heading"');
    // And with a person's lane over it.
    const withLane = card({ lane: "hot", lane_set_at: daysBefore(0), last_outbound_at: daysBefore(2) }, { facts: { firstTouchAt: daysBefore(11) } });
    expect(withLane.match(/Long-Term Nurture suggested/g)).toHaveLength(1);
  });
});

describe("the lead page", () => {
  const page = read("src/app/dashboard/leads/[id]/page.tsx");

  it("renders the merged card once and imports neither old component", () => {
    expect(page.match(/<TemperatureCard/g)).toHaveLength(1);
    expect(page).not.toMatch(/LeadTemperature|LaneCard/);
    expect(page).toContain("effectiveTemperature(");
    expect(page).not.toContain("deriveTemperature");
  });

  it("deleted the two old components", () => {
    expect(() => read("src/components/leads/LeadTemperature.tsx")).toThrow();
    expect(() => read("src/components/leads/LaneCard.tsx")).toThrow();
    expect(() => read("src/app/dashboard/intake/_components/LaneCell.tsx")).toThrow();
  });
});

/** Every .ts/.tsx file under a directory, as [relative path, source]. */
function sourceFiles(dir: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push([rel, read(rel)]);
  }
  return out;
}

describe("nothing writes crm_lead.temperature", () => {
  const files = sourceFiles("src").filter(([rel]) => rel !== path.join("src", "lib", "db", "types.ts"));

  it("has no hand-set temperature action or data-layer function in src/", () => {
    const hits = files.filter(([, source]) => /setTemperature/i.test(source)).map(([rel]) => rel);
    expect(hits).toEqual([]);
  });

  it("has no insert or update payload for crm_lead with a temperature key", () => {
    const offenders: string[] = [];
    for (const [rel, source] of files) {
      if (!source.includes("crm_lead")) continue;
      for (const match of source.matchAll(/from\("crm_lead"\)\s*\.(?:update|insert|upsert)\(\s*\{([^}]*)\}/g)) {
        if (/\btemperature(?:_set_at|_set_by)?\s*:/.test(match[1])) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leaves the column in the generated types", () => {
    const types = read("src/lib/db/types.ts");
    expect(types).toMatch(/temperature: Database\["public"\]\["Enums"\]\["crm_lead_temperature"\] \| null/);
  });
});
