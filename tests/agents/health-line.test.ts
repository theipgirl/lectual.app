import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HEALTH_ALL_OK, HEALTH_NONE_ON, HEALTH_PAUSED, HEALTH_UNREADABLE, assistantHealth, autonomyChangeQuestion, type HealthInput } from "@/lib/agents/health-line";
import { AGENT_IDS, type AgentId } from "@/lib/agents/types";

const NOW = Date.parse("2026-10-27T15:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const [A, B, C] = AGENT_IDS as unknown as AgentId[];

const base = (over: Partial<HealthInput> = {}, runs: Partial<Record<AgentId, { status: string; started_at: string }>> = {}): HealthInput => ({
  settingsKnown: true,
  runsKnown: true,
  paused: false,
  enabled: [A, B],
  blocked: new Set(),
  lastRun: (a) => runs[a],
  now: NOW,
  ...over,
});

describe("F16: the health line", () => {
  it("says everything ran normally only when every switched-on assistant ran today", () => {
    expect(assistantHealth(base({}, { [A]: { status: "ok", started_at: hoursAgo(2) }, [B]: { status: "skipped", started_at: hoursAgo(5) } }))).toEqual({ tone: "ok", text: HEALTH_ALL_OK });
    expect(HEALTH_ALL_OK).toBe("All assistants ran normally today");
  });

  it("counts failures, runs that didn't finish and blocked assistants as needing attention", () => {
    const text = (h: ReturnType<typeof assistantHealth>) => h.text;
    expect(text(assistantHealth(base({}, { [A]: { status: "error", started_at: hoursAgo(1) }, [B]: { status: "ok", started_at: hoursAgo(1) } })))).toBe("1 needs attention");
    expect(text(assistantHealth(base({}, { [A]: { status: "error", started_at: hoursAgo(1) }, [B]: { status: "running", started_at: hoursAgo(2) } })))).toBe("2 need attention");
    // A run still "running" 15 minutes later is "Didn't finish", the same rule as the run log.
    expect(text(assistantHealth(base({ enabled: [A] }, { [A]: { status: "running", started_at: hoursAgo(2) } })))).toBe("1 needs attention");
    expect(text(assistantHealth(base({ blocked: new Set([A]) }, { [A]: { status: "ok", started_at: hoursAgo(1) }, [B]: { status: "ok", started_at: hoursAgo(1) } })))).toBe("1 needs attention");
  });

  it("an unreadable settings list or run log is never 'all fine'", () => {
    for (const over of [{ settingsKnown: false }, { runsKnown: false }]) {
      const h = assistantHealth(base(over, { [A]: { status: "ok", started_at: hoursAgo(1) }, [B]: { status: "ok", started_at: hoursAgo(1) } }));
      expect(h.text).toBe(HEALTH_UNREADABLE);
      expect(h.text).not.toContain("ran normally");
    }
  });

  it("is honest about an assistant that hasn't run, nothing switched on, and a pause", () => {
    expect(assistantHealth(base({}, { [A]: { status: "ok", started_at: hoursAgo(1) } })).text).toBe("No problems. 1 hasn't run today.");
    expect(assistantHealth(base({ enabled: [A, B, C] })).text).toBe("No problems. 3 haven't run today.");
    expect(assistantHealth(base({ enabled: [] })).text).toBe(HEALTH_NONE_ON);
    expect(assistantHealth(base({ paused: true })).text).toBe(HEALTH_PAUSED);
  });

  it("is the first block under the page head", () => {
    const page = readFileSync("src/app/dashboard/agents/page.tsx", "utf8");
    expect(page).toContain("assistantHealth({");
    expect(page.indexOf("data-health")).toBeLessThan(page.indexOf("Assistants on or off") === -1 ? page.indexOf("ASSISTANTS_NAME} on or off") : page.indexOf("Assistants on or off"));
    expect(page.indexOf("data-health")).toBeGreaterThan(page.indexOf('data-tour="agents-head"'));
  });
});

describe("F16/P2: autonomy confirm, text status labels, Run now visibility", () => {
  const controls = readFileSync("src/components/agents/AgentControls.tsx", "utf8");
  const page = readFileSync("src/app/dashboard/agents/page.tsx", "utf8");

  it("changing autonomy asks first; only Confirm submits, and Cancel changes nothing", () => {
    expect(autonomyChangeQuestion("Intake triage", "draft", "act")).toBe("Change Intake triage from Draft to Act?");
    const levels = controls.slice(controls.indexOf('<form action={save} className="lx-lv">'), controls.indexOf("</form>", controls.indexOf('className="lx-lv"')));
    expect(levels).toContain("setAsking(l.k)");
    expect(levels).not.toMatch(/key=\{l\.k\}\s+type="submit"/);
    expect(levels).toMatch(/type="submit" name="autonomy" value=\{asking\}/);
    expect(levels).toMatch(/onClick=\{\(\) => setAsking\(null\)\}>\s*Cancel/);
  });

  it("each status dot in the run log has a visible text label", () => {
    expect(page).toContain('<span className="lx-note">{RUN_STATUS_LABEL[status] ?? status}</span>');
    expect(page).not.toMatch(/<span className="lx-dot"[^>]*title=/);
  });

  it("Run now is drawn only for a role that can run it (decideRunNow's own role block)", () => {
    expect(controls).toContain('decision.block !== "role"');
    expect(controls).toMatch(/\{showRun && \(\s*<div className="lx-agent-slot-run">/);
  });
});
