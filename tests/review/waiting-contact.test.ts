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

describe("stageIsWithUspto: live RPB stages", () => {
  const withOwn: Array<[string, string, string, boolean]> = [
    ["15", "Send Invoice for Remaining Balance", "client", false],
    ["17", "Application Filed", "uspto", true],
    ["18", "Awaiting Trademark Registration", "uspto", true],
    ["19D", "Invoice for OA Response Sent", "client", false],
    ["19F", "OA Response Sent", "uspto", true],
    ["19H", "Invoice for OA Response Extension Request", "client", false],
    ["20D", "SOU Preparation", "firm", false],
    ["21E", "NOA Accepted", "firm", false],
    ["22", "Publication for Opposition", "uspto", true],
  ];
  for (const [code, name, waiting_on, expected] of withOwn) {
    for (const label of [name, `${code} · ${name}`, `${code}. ${name}`]) {
      it(`${label} (${waiting_on})`, () => expect(stageIsWithUspto({ label, waiting_on })).toBe(expected));
    }
  }
  it("a stage's own waiting_on beats a matching name", () => {
    expect(stageIsWithUspto({ label: "Invoice for OA Response Sent", waiting_on: "uspto" })).toBe(true);
    expect(stageIsWithUspto({ label: "OA Response Sent", waiting_on: "client" })).toBe(false);
  });
  // No waiting_on for 19A to 19C exists in the repo (no seed script or fixture), so these go through the name table only.
  it.each([
    ["19A OA Issued", false],
    ["19B Notified Client of OA", false],
    ["19C OA Response Preparation", false],
    ["Invoice for OA Response Sent", false],
    ["19D · Invoice for OA Response Sent", false],
    ["Send Invoice for Remaining Balance", false],
    ["Payment for OA Response Filed", false],
    ["19F · OA Response Sent", true],
    ["OA Response Filed", true],
    ["17 · Application Filed", true],
  ])("keyword path, no waiting_on: %s", (label, expected) => {
    expect(stageIsWithUspto({ label, waiting_on: null })).toBe(expected);
    expect(stageIsWithUspto({ label })).toBe(expected);
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
    expect(summarizeContact([{ type: "email_sent", created_at: "2027-01-01T00:00:00Z" }], now)).toEqual({ last: null, direction: null, lastOutbound: null });
    expect(summarizeContact([], now).last).toBeNull();
  });
  it("lastOutbound is the newest email we sent or call we made, not a reply or a note", () => {
    const r = summarizeContact(
      [
        { type: "email_sent", created_at: "2026-10-20T10:00:00Z" },
        { type: "call_logged", created_at: "2026-10-25T10:00:00Z" },
        { type: "email_received", created_at: "2026-10-28T10:00:00Z" },
        { type: "note", created_at: "2026-10-30T10:00:00Z" },
      ],
      now,
    );
    expect(r.lastOutbound).toEqual({ at: "2026-10-25T10:00:00Z", type: "call_logged" });
    expect(summarizeContact([{ type: "email_received", created_at: "2026-10-28T10:00:00Z" }], now).lastOutbound).toBeNull();
  });
  it("words", () => expect(contactWords("email_received")).toBe("they replied"));
});
