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
    // The pay link is given, so nothing blocks on it and all three checks are listed.
    const issues = validateContent(content, { forApproval: true, title: "T", expires_on: "2099-01-01", pay_url: "https://pay.example/x", client_email: "a@b.co" });
    const list = buildChecklist(issues, content);
    const levels = list.map((i) => i.level);
    expect(levels.slice(-3)).toEqual(["check", "check", "check"]);
    expect(levels.indexOf("check")).toBeGreaterThan(levels.lastIndexOf("error"));
    expect(list.filter((i) => i.level === "check").map((i) => i.href)).toEqual(CHECKS.map((c) => `#${targetForPath(c.path)}`));
  });

  it("review item 9: a check about a field that already has a blocking Fix is left out (one item, the Fix)", () => {
    const content = withChecks(CHECKS);
    const issues = validateContent(content, { forApproval: true, title: "T", expires_on: "2099-01-01", pay_url: null, client_email: "a@b.co" });
    const list = buildChecklist(issues, content);
    const payLink = list.filter((i) => i.href === `#${targetForPath("pay_url")}`);
    expect(payLink).toHaveLength(1);
    expect(payLink[0].level).toBe("error");
    expect(payLink[0].text).toBe("Add the pay link before creating the link.");
    // The other two checks are still there, still last.
    expect(list.filter((i) => i.level === "check").map((i) => i.href)).toEqual([`#${targetForPath("names[0].discount_pct")}`, `#${targetForPath("adjustments[0]")}`]);
    expect(list.map((i) => i.level).slice(-2)).toEqual(["check", "check"]);
    // A WARNING on the same field does not hide a check: only a Fix does.
    const warned = buildChecklist([{ level: "warning", path: "pay_url", message: "Looks unusual." }], content);
    expect(warned.filter((i) => i.href === `#${targetForPath("pay_url")}`).map((i) => i.level)).toEqual(["warning", "check"]);
  });

  it("the 'engagement letter couldn't be attached' check links to the Engagement letter section, and goes away once a letter is on", () => {
    expect(targetForPath("loe")).toBe("pe-sec-letter");
    expect(targetForPath("loe.body")).toBe("pe-sec-letter");
    const check = { text: "Couldn't read your engagement letter when this draft was made, so it isn't attached.", source: "assistant", path: "loe" };
    const without = buildChecklist([], withChecks([check]));
    expect(without).toEqual([{ level: "check", text: check.text, where: "engagement letter", href: "#pe-sec-letter" }]);
    const attached: ProposalContent = { ...withChecks([check]), loe: { kind: "trademark", template_id: "t", template_version: 1, title: "Engagement letter", body: "Dear {{client_name}}," } };
    expect(buildChecklist([], attached)).toEqual([]);
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
