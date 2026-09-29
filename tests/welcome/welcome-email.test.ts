import { describe, it, expect } from "vitest";
import { buildWelcomeEmailDraft } from "@/lib/welcome/welcome-email";

describe("buildWelcomeEmailDraft — deterministic, no AI", () => {
  const base = {
    clientOrEntityName: "Jane Doe",
    markText: "SUNBEAM",
    matterNumber: "TM-0042",
    clientEmail: "jane@example.com",
    sendDateIso: "2026-08-21",
  };

  it("names the firm's real template rather than rewriting it (SOP Hard Rule 2)", () => {
    const draft = buildWelcomeEmailDraft(base);
    expect(draft.draftBody).toContain("Trademark client welcome email");
    expect(draft.draftBody).toContain("never rewrite the template");
  });

  it("is sent from Rebecca, cc Trademarks, per the SOP", () => {
    const draft = buildWelcomeEmailDraft(base);
    expect(draft.draftBody).toContain("From: Rebecca P. Beliard, Esq.");
    expect(draft.draftBody).toContain("Cc: Trademarks");
  });

  it("notes the trademark questionnaire as an external Lawmatics link, never a guessed URL", () => {
    const draft = buildWelcomeEmailDraft(base);
    expect(draft.draftBody).toContain("EXTERNAL Lawmatics intake form link");
    expect(draft.draftBody).not.toMatch(/https?:\/\//);
  });

  it("carries the follow-through flag to notify Rain directly", () => {
    const draft = buildWelcomeEmailDraft(base);
    expect(draft.draftBody).toContain("notify Rain directly");
    expect(draft.summary).toContain("Rain");
  });

  it("fills only the variable fields — client name, mark, matter number, send date", () => {
    const draft = buildWelcomeEmailDraft(base);
    expect(draft.draftBody).toContain("Jane Doe");
    expect(draft.draftBody).toContain("SUNBEAM");
    expect(draft.draftBody).toContain("TM-0042");
    expect(draft.draftBody).toContain("2026-08-21");
  });

  it("uses the recipient email as the queue draft's recipient", () => {
    const draft = buildWelcomeEmailDraft(base);
    expect(draft.recipient).toBe("jane@example.com");
  });

  it("flags a missing client email rather than guessing one", () => {
    const draft = buildWelcomeEmailDraft({ ...base, clientEmail: null });
    expect(draft.recipient).toBeNull();
    expect(draft.draftBody).toContain("[confirm client email on the lead record]");
  });

  it("omits the mark from the subject/headline when the matter has none on file yet", () => {
    const draft = buildWelcomeEmailDraft({ ...base, markText: null });
    expect(draft.subject).toBe("Welcome to RPB Law");
    expect(draft.headline).toBe("Welcome email DRAFT — Jane Doe");
  });
});
