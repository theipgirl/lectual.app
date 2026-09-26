import { describe, it, expect } from "vitest";
import { describeActivity } from "@/components/leads/describe";

const row = (type: string, payload: Record<string, unknown>) => ({ type, actor_type: "system", created_at: "2026-09-24T09:00:00Z", payload });

describe("timeline wording", () => {
  it("names the sender and subject of a synced email, and links back to the mail client", () => {
    expect(describeActivity(row("email_received", { from: "amara@example.com", subject: "SANKOFA", web_link: "https://mail/x" }))).toEqual({
      title: "Email from amara@example.com",
      detail: "SANKOFA",
      tone: "mail",
      link: "https://mail/x",
    });
  });
  it("shows the triage lane and reason", () => {
    expect(describeActivity(row("ai_insight", { source: "intake-triage", lane: "hot", reason: "Ready to file." }))).toMatchObject({ title: "Triage: HOT", detail: "Ready to file.", tone: "ai" });
  });
  it("records a proposal decision", () => {
    expect(describeActivity(row("ai_insight", { source: "email-intel-review", decision: "apply", applied: ["phone"] })).title).toBe("Proposal applied");
    expect(describeActivity(row("ai_insight", { source: "email-intel-review", decision: "dismiss", applied: [] })).title).toBe("Proposal dismissed");
  });
  it("survives a payload that is missing or malformed", () => {
    expect(describeActivity({ type: "email_received", actor_type: null, created_at: "", payload: null }).title).toBe("Email from the client");
    expect(describeActivity(row("something_new", {})).title).toBe("Something new");
  });
});
