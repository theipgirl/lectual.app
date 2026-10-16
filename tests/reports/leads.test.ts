import { describe, it, expect } from "vitest";
import { isWaitingOnUs, waitingSince, leadLabel } from "@/lib/reports/leads";

describe("isWaitingOnUs", () => {
  it("is false when there's no inbound contact at all", () => {
    expect(isWaitingOnUs({ last_inbound_at: null, last_outbound_at: null })).toBe(false);
    expect(isWaitingOnUs({ last_inbound_at: null, last_outbound_at: "2026-09-01T00:00:00Z" })).toBe(false);
  });

  it("is true when we have never replied but they have written in", () => {
    expect(isWaitingOnUs({ last_inbound_at: "2026-09-01T00:00:00Z", last_outbound_at: null })).toBe(true);
  });

  it("is true when the last inbound message is newer than our last reply", () => {
    expect(
      isWaitingOnUs({ last_inbound_at: "2026-09-10T00:00:00Z", last_outbound_at: "2026-09-05T00:00:00Z" }),
    ).toBe(true);
  });

  it("is false once we've replied after their last message", () => {
    expect(
      isWaitingOnUs({ last_inbound_at: "2026-09-05T00:00:00Z", last_outbound_at: "2026-09-10T00:00:00Z" }),
    ).toBe(false);
  });
});

describe("waitingSince", () => {
  it("is the last inbound timestamp when waiting on us", () => {
    expect(waitingSince({ last_inbound_at: "2026-09-01T00:00:00Z", last_outbound_at: null })).toBe(
      "2026-09-01T00:00:00Z",
    );
  });

  it("is null when not waiting on us", () => {
    expect(
      waitingSince({ last_inbound_at: "2026-09-01T00:00:00Z", last_outbound_at: "2026-09-05T00:00:00Z" }),
    ).toBeNull();
  });
});

describe("leadLabel", () => {
  it("prefers the business name", () => {
    expect(leadLabel({ business_name: "Hartwell IP", first_name: "Avery", last_name: "Hartwell", email: "a@x.com" })).toBe(
      "Hartwell IP",
    );
  });

  it("falls back to the full name, then the email", () => {
    expect(leadLabel({ business_name: null, first_name: "Avery", last_name: "Hartwell", email: "a@x.com" })).toBe(
      "Avery Hartwell",
    );
    expect(leadLabel({ business_name: null, first_name: "", last_name: "", email: "a@x.com" })).toBe("a@x.com");
  });

  it("treats a blank business name as absent", () => {
    expect(leadLabel({ business_name: "   ", first_name: "Avery", last_name: "Hartwell", email: "a@x.com" })).toBe(
      "Avery Hartwell",
    );
  });
});
