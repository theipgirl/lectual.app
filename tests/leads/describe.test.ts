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

  it("describes matter activity: stage moves, docket changes, openings", () => {
    const at = "2026-09-26T00:00:00Z";
    expect(describeActivity({ type: "stage_changed", actor_type: "user", created_at: at, payload: { to_label: "OA Issued" } }).title).toBe("Moved to OA Issued");
    const d = describeActivity({ type: "matter_updated", actor_type: "user", created_at: at, payload: { change: "deadline_docketed", kind: "office_action_response", due_date: "2026-12-01" } });
    expect(d.title).toBe("Deadline docketed");
    expect(d.detail).toBe("office action response · 2026-12-01");
    expect(describeActivity({ type: "matter_updated", actor_type: "user", created_at: at, payload: { change: "ip_fields", fields: ["serial_number"] } }).detail).toBe("serial number");
    expect(describeActivity({ type: "matter_opened", actor_type: "system", created_at: at, payload: { matter_number: "TM-2026-0001" } }).detail).toBe("TM-2026-0001");
  });
});

