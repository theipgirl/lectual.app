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
    // moveLeadStage's own payload keys — these used to fall through to "a new stage".
    const moved = describeActivity({ type: "stage_changed", actor_type: "user", created_at: at, payload: { from_stage: "New PNC", to_stage: "Discovery Call", to_stage_id: "s2" } });
    expect(moved.title).toBe("Moved to Discovery Call");
    expect(moved.detail).toBe("from New PNC");
    const signed = describeActivity({ type: "stage_changed", actor_type: "system", created_at: at, payload: { to_stage: "Hired Client", source: "quote_accepted" } });
    expect(signed).toMatchObject({ title: "Moved to Hired Client", detail: "Proposal signed" });
    const d = describeActivity({ type: "matter_updated", actor_type: "user", created_at: at, payload: { change: "deadline_docketed", kind: "office_action_response", due_date: "2026-12-01" } });
    expect(d.title).toBe("Deadline docketed");
    expect(d.detail).toBe("office action response · 2026-12-01");
    expect(describeActivity({ type: "matter_updated", actor_type: "user", created_at: at, payload: { change: "ip_fields", fields: ["serial_number"] } }).detail).toBe("serial number");
    expect(describeActivity({ type: "matter_opened", actor_type: "system", created_at: at, payload: { matter_number: "TM-2026-0001" } }).detail).toBe("TM-2026-0001");
  });

  it("shows the text of notes and calls saved from the app (note / summary keys)", () => {
    const at = "2026-09-26T00:00:00Z";
    expect(describeActivity({ type: "note", actor_type: "user", created_at: at, payload: { note: "Client prefers email." } }).detail).toBe("Client prefers email.");
    expect(describeActivity({ type: "note", actor_type: "user", created_at: at, payload: { body: "Older producer." } }).detail).toBe("Older producer.");
    expect(describeActivity({ type: "call_logged", actor_type: "user", created_at: at, payload: { summary: "Discussed classes", notes: "long notes" } }).detail).toBe("Discussed classes");
  });

  it("words a consult-details review by mark and basis, naming a correction", () => {
    const at = "2026-10-09T00:00:00Z";
    const r = describeActivity({
      type: "lead_updated",
      actor_type: "user",
      created_at: at,
      payload: { change: "consult_details", summary: "Reviewed consult details: 2 marks", marks: [{ mark: "SANKOFA", filing_basis: "1b", corrected: true }, { mark: "KENTE", filing_basis: "unknown", corrected: false }] },
    });
    expect(r).toMatchObject({ title: "Consult details reviewed", detail: "SANKOFA §1(b) (corrected) · KENTE basis unknown" });
    // an ordinary lead edit keeps its wording
    expect(describeActivity({ type: "lead_updated", actor_type: "user", created_at: at, payload: { fields: ["phone"] } })).toMatchObject({ title: "Details updated", detail: "phone" });
  });

  it("says what a new matter took from the reviewed consult, and why it took nothing when that matters", () => {
    const at = "2026-10-09T00:00:00Z";
    const opened = (consult_details?: unknown) => describeActivity({ type: "matter_opened", actor_type: "system", created_at: at, payload: { matter_number: "TM-2026-0004", consult_details } });
    expect(opened({ carried: ["filing_basis", "international_classes"], skipped: null }).detail).toBe("TM-2026-0004 · from the reviewed consult: filing basis, international classes");
    expect(opened({ carried: [], skipped: "not_reviewed" }).detail).toBe("TM-2026-0004 · consult details not reviewed, so not carried");
    expect(opened({ carried: [], skipped: "unavailable" }).detail).toMatch(/couldn't be read, so not carried/);
    expect(opened({ carried: [], skipped: "ambiguous_marks" }).detail).toMatch(/set the filing details by hand/);
    expect(opened({ carried: [], skipped: "mark_mismatch" }).detail).toMatch(/no reviewed mark matches/);
    expect(opened({ carried: [], skipped: "not_trademark" }).detail).toMatch(/trademark filing details, so not carried/);
    expect(opened().detail).toBe("TM-2026-0004");
  });
});

describe("timeline wording: consult outcomes", () => {
  const call = (payload: Record<string, unknown>) =>
    describeActivity({ type: "call_logged", actor_type: "user", created_at: "2026-10-20T09:00:00Z", payload });

  it("names the three outcomes and keeps the note as the detail", () => {
    expect(call({ summary: "No-show", notes: null, consult_outcome: "no_show" })).toEqual({
      title: "No-show",
      detail: null,
      tone: "note",
      link: null,
    });
    expect(call({ summary: "x", notes: "Wants next week", consult_outcome: "reschedule_requested" })).toMatchObject({
      title: "Asked to reschedule",
      detail: "Wants next week",
    });
    expect(call({ summary: "x", notes: "Thu 3pm", consult_outcome: "rebooked_after_no_show" })).toMatchObject({
      title: "Rebooked after no-show",
      detail: "Thu 3pm",
    });
  });

  it("a plain logged call still reads 'Call logged'", () => {
    expect(call({ summary: "Spoke about classes", notes: "Spoke about classes" })).toMatchObject({
      title: "Call logged",
      detail: "Spoke about classes",
    });
  });

  it("an unknown outcome value reads 'Call logged' and does not crash", () => {
    expect(call({ summary: "Hm", consult_outcome: "ghosted" })).toMatchObject({ title: "Call logged", detail: "Hm" });
    expect(call({ consult_outcome: 7 }).title).toBe("Call logged");
    expect(describeActivity({ type: "call_logged", actor_type: null, created_at: "", payload: null }).title).toBe("Call logged");
  });
});
