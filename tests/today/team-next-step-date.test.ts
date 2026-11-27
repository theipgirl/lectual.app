import { describe, expect, it } from "vitest";
import { teamNextSteps } from "@/lib/today/team-rules";

// A next step's due date is saved as a bare date (stored as midnight UTC). It must read as that day in any firm
// zone: in New York, midnight UTC is still the evening before, and reading it in the zone showed "1 day overdue".
describe("Team Today next-step due dates", () => {
  const step = (due_at: string | null) => ({ id: "t1", title: "Call back", status: "open", due_at, assignee_id: "u1", matter_id: "m1", lead_id: null });
  const now = new Date("2026-11-27T15:00:00Z"); // Nov 27, 10 AM in New York

  it("a step due today (midnight UTC) is today in New York, not overdue", () => {
    const [s] = teamNextSteps([step("2026-11-27T00:00:00Z")], "u1", now, "America/New_York");
    expect(s.dueDate).toBe("2026-11-27");
    expect(s.chip?.text ?? "").not.toMatch(/overdue/i);
  });

  it("a step due yesterday is 1 day overdue", () => {
    const [s] = teamNextSteps([step("2026-11-26T00:00:00Z")], "u1", now, "America/New_York");
    expect(s.dueDate).toBe("2026-11-26");
    expect(s.chip?.text ?? "").toMatch(/overdue/i);
  });
});
