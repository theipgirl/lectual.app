import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const page = readFileSync("src/app/dashboard/page.tsx", "utf8");

describe("Today: the Needs-you deadlines skip needs-review dates (N5)", () => {
  it("imports the predicate from the pure rules module", () => {
    expect(page).toMatch(/import \{[^}]*deadlineNeedsReview[^}]*\} from "@\/lib\/matters\/deadline-rules"/);
  });

  it("applies it to the deadlines handed to buildNeedsYou", () => {
    const call = page.slice(page.indexOf("buildNeedsYou({"), page.indexOf("tasks:", page.indexOf("buildNeedsYou({")));
    expect(call).toContain("deadlines?.filter((d) => !deadlineNeedsReview(d, civilDate(now))).map(");
  });

  it("leaves the overdue count and the 14-day list on buildCalendarRows, which already skips them", () => {
    expect(page).toContain("const rows = buildCalendarRows(deadlines ?? [], tasks ?? [], now);");
    expect(page).toContain("const overdue = rows.filter((r) => r.overdueDays > 0).length;");
  });

  it("changes at most 4 lines of the page this sprint", () => {
    let numstat = "";
    try {
      numstat = execSync("git diff 484f123 --numstat -- src/app/dashboard/page.tsx", { encoding: "utf8" }).trim();
    } catch {
      return; // Sprint base not available (shallow clone): the gate run checks it.
    }
    if (!numstat) return;
    const [added, removed] = numstat.split(/\s+/).map(Number);
    expect(added + removed).toBeLessThanOrEqual(4);
  });
});
