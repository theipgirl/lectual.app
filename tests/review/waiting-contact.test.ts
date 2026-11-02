import { describe, expect, it } from "vitest";
import { stageIsWithUspto, waitingOn } from "@/lib/review/waiting";
import { summarizeContact, contactWords } from "@/lib/review/contact";

describe("stageIsWithUspto", () => {
  it.each(["Application Filed", "Awaiting Trademark Registration", "Publication for Opposition", "OA Response Sent", "Notice of Allowance"])("%s", (label) => {
    expect(stageIsWithUspto({ label })).toBe(true);
  });
  it("uses waiting_on", () => expect(stageIsWithUspto({ label: "Whatever", waiting_on: "uspto" })).toBe(true));
  it("not for firm stages or no stage", () => {
    expect(stageIsWithUspto({ label: "Application Preparation", waiting_on: "firm" })).toBe(false);
    expect(stageIsWithUspto(null)).toBe(false);
  });
});

describe("waitingOn", () => {
  it("precedence: uspto, approval, then direction", () => {
    expect(waitingOn({ withUspto: true, pendingApproval: true, lastDirection: "they" })).toBe("uspto");
    expect(waitingOn({ withUspto: false, pendingApproval: true, lastDirection: "they" })).toBe("approval");
    expect(waitingOn({ withUspto: false, pendingApproval: false, lastDirection: "they" })).toBe("us");
    expect(waitingOn({ withUspto: false, pendingApproval: false, lastDirection: "we" })).toBe("client");
    expect(waitingOn({ withUspto: false, pendingApproval: false, lastDirection: null })).toBeNull();
  });
});

describe("summarizeContact", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  it("newest wins; a note counts but has no direction", () => {
    const r = summarizeContact(
      [
        { type: "email_received", created_at: "2026-10-28T10:00:00Z" },
        { type: "note", created_at: "2026-10-30T10:00:00Z" },
        { type: "stage_changed", created_at: "2026-11-01T10:00:00Z" },
      ],
      now,
    );
    expect(r.last).toEqual({ at: "2026-10-30T10:00:00Z", type: "note" });
    expect(r.direction).toBe("they");
  });
  it("ignores the future and nothing gives null", () => {
    expect(summarizeContact([{ type: "email_sent", created_at: "2027-01-01T00:00:00Z" }], now)).toEqual({ last: null, direction: null });
    expect(summarizeContact([], now).last).toBeNull();
  });
  it("words", () => expect(contactWords("email_received")).toBe("they replied"));
});
