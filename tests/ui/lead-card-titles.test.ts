import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeActivity } from "@/components/leads/describe";
import { AGENT_DEFS } from "@/lib/agents/types";
import { agentLabel } from "@/components/queue/format";
import { AUTOMATIC_STAGE_MOVES, FIRST_READ, FROM_THEIR_EMAILS } from "@/lib/ui/words";

const page = readFileSync("src/app/dashboard/leads/[id]/page.tsx", "utf8");

describe("lead-page card titles are for people", () => {
  it("the three cards use the plain names from the glossary", () => {
    expect(FROM_THEIR_EMAILS).toBe("From their emails");
    expect(AUTOMATIC_STAGE_MOVES).toBe("Automatic stage moves");
    expect(FIRST_READ).toBe("First read of this lead");
    expect(page).toContain("{FROM_THEIR_EMAILS} · waiting on you");
    expect(page).toContain("{AUTOMATIC_STAGE_MOVES} · waiting on you");
    expect(page).toContain("{FIRST_READ}");
  });

  it("the old names are gone from the page", () => {
    for (const old of ["Email intel", "Stage Keeper", "Triage agent"]) expect(page).not.toContain(old);
  });

  it("the Assistants cards and the approval-item label say the same plain things", () => {
    expect(AGENT_DEFS["email-intel"].name).toBe(FROM_THEIR_EMAILS);
    expect(AGENT_DEFS["stage-keeper"].name).toBe(AUTOMATIC_STAGE_MOVES);
    expect(agentLabel("email-intel")).toBe(FROM_THEIR_EMAILS);
  });

  it("anchors and tour hooks are untouched", () => {
    for (const hook of ['id="prep-consult"', 'data-tour="lead-prep"', 'data-tour="lead-timeline"', 'data-tour="lead-head"']) expect(page, hook).toContain(hook);
  });
});

describe("the timeline reads in plain words", () => {
  it("a first read uses no build names", () => {
    const first = describeActivity({ type: "ai_insight", actor_type: "ai", created_at: "2026-10-20T12:00:00Z", payload: { source: "intake-triage", lane: "hot", reason: "r" } }, {});
    expect(first.title).toBe("First read: HOT");
  });
});
