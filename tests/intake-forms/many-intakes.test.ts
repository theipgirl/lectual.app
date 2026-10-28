import { describe, expect, it } from "vitest";
import { defaultIntakeConfig } from "@/lib/intake-forms/config";
import { copyName, leadSourceLabel, validateIntakeDetails } from "@/lib/intake-forms/details";
import { formatDuration, intakeTableRows, statsByForm, submissionStats } from "@/lib/intake-forms/performance";
import { leadFromSubmission, RESUME_TOKEN_SHAPE, validatePublicStart } from "@/lib/intake-forms/public-submit";

/**
 * Many intakes per firm (lectual 0093): an intake's own details, the numbers
 * behind each one, and the contact step of contact-first capture.
 */

describe("intake details", () => {
  it("accepts a name, a link name and an optional source tag, tidied", () => {
    const r = validateIntakeDetails({ name: "  UGW 2026   booth ", slug: "UGW-2026", sourceTag: " UGW 2026 " });
    expect(r).toEqual({ ok: true, value: { name: "UGW 2026 booth", slug: "ugw-2026", sourceTag: "UGW 2026" } });
    const noTag = validateIntakeDetails({ name: "Website", slug: "rpb-law", sourceTag: "   " });
    expect(noTag.ok && noTag.value.sourceTag).toBeNull();
  });

  it("refuses an empty name, a bad link name and an over-long tag, each with a sentence", () => {
    const r = validateIntakeDetails({ name: " ", slug: "-bad-", sourceTag: "x".repeat(81) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(3);
    expect(validateIntakeDetails({ name: "A", slug: "ab", sourceTag: null }).ok).toBe(false); // too short
    expect(validateIntakeDetails({ name: "A", slug: "has space", sourceTag: null }).ok).toBe(false);
    expect(validateIntakeDetails(null).ok).toBe(false);
  });

  it("names a duplicate, within the length limit", () => {
    expect(copyName("UGW 2026 booth")).toBe("Copy of UGW 2026 booth");
    expect(copyName("x".repeat(120))).toHaveLength(120);
  });

  it("labels a lead's source with the tag, else the intake's name", () => {
    expect(leadSourceLabel("UGW 2026 booth", "UGW 2026")).toBe("UGW 2026");
    expect(leadSourceLabel("Website intake", null)).toBe("Website intake");
    expect(leadSourceLabel("  ", "  ")).toBe("Intake");
  });
});

describe("per-intake numbers", () => {
  const t = (min: number) => new Date(Date.UTC(2026, 9, 18, 15, 0) + min * 60_000).toISOString();

  it("counts who gave details, who finished, who didn't, and the median time", () => {
    const s = submissionStats([
      { started_at: t(0), submitted_at: t(2) },
      { started_at: t(0), submitted_at: t(4) },
      { started_at: t(0), submitted_at: t(10) },
      { started_at: t(0), submitted_at: null },
    ]);
    expect(s).toEqual({
      captured: 4,
      completed: 3,
      unfinished: 1,
      completionRate: "75.0%",
      medianMs: 4 * 60_000,
      temperatures: { hot: 0, warm: 0, cold: 0 },
    });
  });

  it("counts an assessment's finished people by temperature", () => {
    const s = submissionStats([
      { started_at: t(0), submitted_at: t(1), temperature: "hot" },
      { started_at: t(0), submitted_at: t(1), temperature: "hot" },
      { started_at: t(0), submitted_at: t(1), temperature: "cold" },
      { started_at: t(0), submitted_at: null, temperature: null },
    ]);
    expect(s.temperatures).toEqual({ hot: 2, warm: 0, cold: 1 });
  });

  it("averages the two middle times for an even count, and says — when nothing finished", () => {
    expect(submissionStats([{ started_at: t(0), submitted_at: t(2) }, { started_at: t(0), submitted_at: t(4) }]).medianMs).toBe(3 * 60_000);
    const none = submissionStats([{ started_at: t(0), submitted_at: null }]);
    expect(none.medianMs).toBeNull();
    expect(none.completionRate).toBe("0.0%");
    expect(submissionStats([]).completionRate).toBe("—");
  });

  it("ignores a clock that ran backwards rather than counting a negative time", () => {
    expect(submissionStats([{ started_at: t(5), submitted_at: t(1) }]).medianMs).toBeNull();
  });

  it("splits by intake", () => {
    const m = statsByForm([
      { form_id: "a", started_at: t(0), submitted_at: t(1) },
      { form_id: "b", started_at: t(0), submitted_at: null },
      { form_id: "a", started_at: t(0), submitted_at: null },
    ]);
    expect(m.get("a")).toMatchObject({ captured: 2, completed: 1 });
    expect(m.get("b")).toMatchObject({ captured: 1, completed: 0, unfinished: 1 });
    expect(m.has("c")).toBe(false);
  });

  it("formats durations for people", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(45_000)).toBe("45 sec");
    expect(formatDuration(3 * 60_000)).toBe("3 min");
    expect(formatDuration(72 * 60_000)).toBe("1 hr 12 min");
    expect(formatDuration(120 * 60_000)).toBe("2 hr");
  });

  it("marks an intake row unfinished when there's no submitted time", () => {
    const base = { id: "1", mode: "form", contact: { name: "Ana" }, fit: "unscored", status: "new", started_at: t(0), last_active_at: t(0) };
    const [done, open] = intakeTableRows([{ ...base, submitted_at: t(3) }, { ...base, id: "2", submitted_at: null }]);
    expect(done.finished).toBe(true);
    expect(open.finished).toBe(false);
  });
});

describe("contact first", () => {
  const contact = { name: "Ana Ruiz", email: "ana@example.com", phone: "", company: "" };

  it("files a person with contact details and consent, before any question", () => {
    expect(validatePublicStart({ mode: "conversation", contact, consent: true })).toEqual({
      ok: true,
      value: { mode: "conversation", contact, utm: {} },
    });
  });

  it("refuses without consent, and without a usable email", () => {
    const noConsent = validatePublicStart({ mode: "form", contact, consent: false });
    expect(noConsent.ok).toBe(false);
    if (!noConsent.ok) expect(noConsent.fields).toContain("consent");
    const badEmail = validatePublicStart({ mode: "form", contact: { ...contact, email: "ana@" }, consent: true });
    expect(badEmail.ok).toBe(false);
    if (!badEmail.ok) expect(badEmail.fields).toContain("email");
    expect(validatePublicStart("nope").ok).toBe(false);
  });

  it("only accepts a resume token of the shape the server issues (32 random bytes, base64url)", () => {
    expect(RESUME_TOKEN_SHAPE.test("A".repeat(43))).toBe(true);
    expect(RESUME_TOKEN_SHAPE.test("A".repeat(42))).toBe(false);
    expect(RESUME_TOKEN_SHAPE.test(`${"A".repeat(42)}=`)).toBe(false);
  });

  it("puts the intake's source on the lead it creates", () => {
    const lead = leadFromSubmission({ mode: "form", contact, answers: [] }, defaultIntakeConfig([]), "golfweekend.com", "UGW 2026");
    expect(lead.referral_detail).toBe("UGW 2026 · Form on golfweekend.com");
    expect(lead.referral_source).toBe("Intake form");
    const plain = leadFromSubmission({ mode: "conversation", contact, answers: [] }, defaultIntakeConfig([]), null);
    expect(plain.referral_detail).toBe("Chat");
  });
});
