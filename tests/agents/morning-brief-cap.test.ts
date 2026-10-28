import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { FOLLOW_UP_CAP } from "@/lib/agents/morning-brief/rules";

// Sprint 35: the morning brief keeps drafting at most 5 stalled-lead follow-ups; the pile is cleared by dismissing, not by a bigger cap.
describe("morning brief follow-up cap", () => {
  it("is 5", () => expect(FOLLOW_UP_CAP).toBe(5));

  it("the planner stops choosing at the cap and the run reports it", () => {
    const plan = readFileSync("src/lib/agents/morning-brief/follow-ups.ts", "utf8");
    expect(plan.match(/chosen\.length >= FOLLOW_UP_CAP/g)).toHaveLength(2);
    expect(readFileSync("src/lib/agents/morning-brief/run.ts", "utf8")).toContain("cap: FOLLOW_UP_CAP");
  });
});

describe("routing exists in one place", () => {
  it("no other source file holds the kind rules or the attorney-only list", () => {
    const hits = execSync(`grep -rlE "Follow-up for a stalled lead|stalled_followup|post_consult_email" src --include=*.ts --include=*.tsx || true`, { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort();
    // routing.ts owns the rules; the producer names its own headline; the others only import them.
    expect(hits).toEqual(["src/lib/agents/morning-brief/follow-ups.ts", "src/lib/queue/dismiss.ts", "src/lib/queue/routing.ts"].sort());
  });
});
