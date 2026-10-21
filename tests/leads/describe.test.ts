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

describe("Sprint 8: meetings and matter edits on the timeline", () => {
  const at = "2026-10-21T00:00:00Z";
  const entry = (type: string, payload: Record<string, unknown>) => ({ type, actor_type: "user", created_at: at, payload });
  const change = (payload: Record<string, unknown>) => describeActivity(entry("matter_updated", payload));

  it("reads a note tagged entry: meeting as 'Meeting', with its text", () => {
    expect(describeActivity(entry("note", { note: "Walked through the filing", entry: "meeting" }))).toEqual({
      title: "Meeting",
      detail: "Walked through the filing",
      tone: "note",
      link: null,
    });
  });

  it("leaves plain notes, calls and logged emails reading as before", () => {
    expect(describeActivity(entry("note", { note: "Client prefers email." }))).toMatchObject({ title: "Note", detail: "Client prefers email." });
    expect(describeActivity(entry("note", { note: "x", entry: "something-else" })).title).toBe("Note");
    expect(describeActivity(entry("call_logged", { summary: "Discussed classes", notes: "long" }))).toMatchObject({ title: "Call logged", detail: "Discussed classes" });
    expect(describeActivity(entry("email_sent", { subject: "Your LOE", body: "b", logged_manually: true }))).toMatchObject({ title: "Email sent", detail: "Your LOE" });
  });

  it("gives every new matter-change its label", () => {
    const labels: Array<[string, string]> = [
      ["header", "Matter details updated"],
      ["contact_linked", "Contact linked"],
      ["contact_added", "Contact added"],
      ["contact_edited", "Contact edited"],
      ["deadline_edited", "Deadline edited"],
      ["deadline_reopened", "Deadline reopened"],
      ["deadline_deleted", "Deadline deleted"],
      ["task_edited", "Task edited"],
      ["task_assigned", "Task assigned"],
      ["task_deleted", "Task deleted"],
    ];
    for (const [key, label] of labels) expect(change({ change: key }).title).toBe(label);
  });

  it("keeps the existing labels, including 'Notes updated'", () => {
    expect(change({ change: "notes" }).title).toBe("Notes updated");
    expect(change({ change: "ip_fields", fields: ["serial_number"] })).toMatchObject({ title: "Filing details updated", detail: "serial number" });
    expect(change({ change: "something_unknown" }).title).toBe("Matter updated");
  });

  it("words the detail of the new rows", () => {
    expect(change({ change: "header", fields: ["title", "referral_source"] }).detail).toBe("title, came from");
    expect(change({ change: "contact_edited", contact_id: "c", fields: ["email", "phone"] }).detail).toBe("email, phone");
    expect(change({ change: "task_edited", fields: ["title", "due_at"] }).detail).toBe("title, due date");
    expect(change({ change: "deadline_deleted", kind: "office_action_response", title: null, due_date: "2026-11-03" }).detail).toBe("office action response · 2026-11-03");
    expect(change({ change: "task_deleted", task_id: "t", title: "Call the client" }).detail).toBe("Call the client");
    expect(change({ change: "task_assigned", title: "Call the client", assignee_id: "user-2" }).detail).toBe("Call the client");
    expect(change({ change: "task_assigned", title: "Call the client", assignee_id: null }).detail).toBe("Call the client · unassigned");
  });
});

describe("booth scorecard rows (Sprint 9, F7)", () => {
  it("reads 'Booth scorecard' with the payload's summary as the detail", () => {
    expect(describeActivity(row("booth_scorecard", { summary: "Booth scorecard — 72/100, WARM", score: 72, temperature: "warm" }))).toEqual({
      title: "Booth scorecard",
      detail: "Booth scorecard — 72/100, WARM",
      tone: "system",
      link: null,
    });
  });

  it("adds the score as 72/100 when the summary doesn't already have it", () => {
    expect(describeActivity(row("booth_scorecard", { summary: "Finished at the booth", score: 72 })).detail).toBe("Finished at the booth · 72/100");
    expect(describeActivity(row("booth_scorecard", { score: 72 })).detail).toBe("72/100");
    // A zero is a real score.
    expect(describeActivity(row("booth_scorecard", { summary: "Finished", score: 0 })).detail).toBe("Finished · 0/100");
  });

  it("shows a contact-only row's summary and no score", () => {
    expect(describeActivity(row("booth_scorecard", { summary: "Booth — contact captured, assessment not yet completed" }))).toMatchObject({
      title: "Booth scorecard",
      detail: "Booth — contact captured, assessment not yet completed",
    });
  });

  it("gives the title alone for an empty, odd or null payload, and never throws", () => {
    for (const payload of [{}, null, undefined, { summary: 5, score: "72" }, { summary: "   ", score: Number.NaN }]) {
      const d = describeActivity({ type: "booth_scorecard", actor_type: "system", created_at: "2026-10-17T15:00:00Z", payload });
      expect(d.title).toBe("Booth scorecard");
      expect(d.detail).toBeNull();
    }
  });

  it("leaves every other row's wording as it was", () => {
    expect(describeActivity(row("quote_payment", { summary: "Paid" })).title).toBe("Quote payment");
    expect(describeActivity(row("something_new", {})).title).toBe("Something new");
  });
});
