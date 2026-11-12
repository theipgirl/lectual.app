import { describe, expect, it } from "vitest";
import { blockingCount, buildChecklist, targetForPath } from "@/lib/proposal-editor/checklist";
import { publicContent } from "@/lib/proposals/public";
import { validateContent } from "@/lib/proposals/validate";
import type { ProposalContent } from "@/lib/proposals/types";
import { sevetri } from "../proposals/fixture";

/** Sprint 5, D4 and D5: `content.checks` (things to check, staff only) in the "Ready to send?" list. */

const withChecks = (checks: unknown): ProposalContent => ({ ...sevetri(), checks: checks as never });
const CHECKS = [
  { text: "Add the client's pay link before creating the link.", source: "copilot", path: "pay_url" },
  { text: "A 10% discount was applied. Check it.", source: "copilot", path: "names[0].discount_pct" },
  { text: "A credit was applied. Check it.", source: "consult", path: "adjustments[0]" },
];

describe("validateContent accepts checks and refuses a bad shape", () => {
  it("a good list has no errors", () => {
    expect(validateContent(withChecks(CHECKS)).filter((i) => i.level === "error")).toEqual([]);
  });
  it.each([
    ["not a list", "x"],
    ["13 entries", Array.from({ length: 13 }, () => CHECKS[0])],
    ["empty text", [{ ...CHECKS[0], text: " " }]],
    ["301 characters", [{ ...CHECKS[0], text: "a".repeat(301) }]],
    ["bad source", [{ ...CHECKS[0], source: "robot" }]],
    ["no path", [{ ...CHECKS[0], path: "" }]],
    ["not an object", [3]],
  ])("refuses %s", (_w, checks) => {
    expect(validateContent(withChecks(checks)).filter((i) => i.level === "error" && i.path.startsWith("checks")).length).toBeGreaterThan(0);
  });
});

describe("buildChecklist merges the checks after the issues and never blocks", () => {
  it("lists checks last, as level check, each linked through targetForPath", () => {
    const content = withChecks(CHECKS);
    const issues = validateContent(content, { forApproval: true, title: "T", expires_on: "2099-01-01", pay_url: null, client_email: "a@b.co" });
    const list = buildChecklist(issues, content);
    const levels = list.map((i) => i.level);
    expect(levels.slice(-3)).toEqual(["check", "check", "check"]);
    expect(levels.indexOf("check")).toBeGreaterThan(levels.lastIndexOf("error"));
    expect(list.filter((i) => i.level === "check").map((i) => i.href)).toEqual(CHECKS.map((c) => `#${targetForPath(c.path)}`));
  });

  it("only checks: nothing blocks", () => {
    const content = withChecks(CHECKS);
    const list = buildChecklist([], content);
    expect(list).toHaveLength(3);
    expect(blockingCount(list)).toBe(0);
  });

  it("a proposal with no checks is unchanged", () => {
    expect(buildChecklist([], sevetri())).toEqual([]);
  });
});

describe("checks are staff-only", () => {
  it("publicContent never returns them", () => {
    expect(publicContent(withChecks(CHECKS))).not.toHaveProperty("checks");
    expect(JSON.stringify(publicContent(withChecks(CHECKS)))).not.toContain("pay link");
  });
});
