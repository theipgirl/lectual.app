import { describe, expect, it } from "vitest";
import { validateProposals, LIMITS } from "@/lib/meeting-assistant";
import { goodRaw, input, TRANSCRIPT } from "./fixtures";

const one = (over: Record<string, unknown>) => ({ proposals: [{ ...goodRaw.proposals[0], ...over }] });

describe("validateProposals", () => {
  it("keeps a good proposal", () => {
    const r = validateProposals(goodRaw, input);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ record: { kind: "matter", id: "r1" }, dueDate: "2026-11-20", ownerId: "u1", flags: [] });
  });

  it("drops a quote that is not in the transcript, and matches ignoring case and spacing", () => {
    expect(validateProposals(one({ evidence: "we agreed to file everything tomorrow morning" }), input).dropped.no_evidence).toBe(1);
    const ok = validateProposals(one({ evidence: "SEND the  office action\nresponse by November 20" }), input);
    expect(ok.proposals).toHaveLength(1);
    expect(TRANSCRIPT).toBeTruthy();
  });

  it("makes an unknown id unmatched, flagged", () => {
    const r = validateProposals(one({ record: { kind: "matter", id: "nope" } }), input);
    expect(r.proposals[0].record).toBe("unmatched");
    expect(r.proposals[0].flags.length).toBeGreaterThan(0);
  });

  it("nulls an unknown owner", () => {
    const r = validateProposals(one({ ownerId: "ghost" }), input);
    expect(r.proposals[0].ownerId).toBeNull();
    expect(r.proposals[0].flags.join()).toMatch(/owner/);
  });

  it("nulls an invented, impossible or unstated date", () => {
    for (const dueDate of ["2026-12-25", "2026-02-30", "soon"]) {
      const r = validateProposals(one({ dueDate }), input);
      expect(r.proposals[0].dueDate).toBeNull();
      expect(r.proposals[0].flags.join()).toMatch(/due date/);
    }
  });

  it("falls back to an exact name only when there is no id", () => {
    const r = validateProposals(one({ record: { kind: "unmatched", id: null }, recordName: "maya chen" }), input);
    expect(r.proposals[0].record).toEqual({ kind: "matter", id: "r1" });
    const u = validateProposals(one({ record: { kind: "unmatched", id: null }, recordName: "Maya" }), input);
    expect(u.proposals[0].record).toBe("unmatched");
  });

  it("truncates lengths, dedupes per record and caps the total", () => {
    const long = validateProposals(one({ nextStep: "x".repeat(500), note: "y".repeat(900) }), input);
    expect(long.proposals[0].nextStep.length).toBeLessThanOrEqual(LIMITS.nextStep);
    expect(long.proposals[0].note.length).toBeLessThanOrEqual(LIMITS.note);

    const dup = validateProposals({ proposals: [{ ...goodRaw.proposals[0], confidence: "low" }, { ...goodRaw.proposals[0], confidence: "high" }] }, input);
    expect(dup.proposals).toHaveLength(1);
    expect(dup.proposals[0].confidence).toBe("high");
    expect(dup.dropped.duplicate).toBe(1);

    const many = Array.from({ length: 80 }, (_, i) => ({ ...goodRaw.proposals[0], record: { kind: "unmatched", id: null }, nextStep: `step ${i}` }));
    const capped = validateProposals({ proposals: many }, input);
    expect(capped.proposals).toHaveLength(50);
    expect(capped.dropped.over_cap).toBe(30);
  });

  it("treats a non-list answer as malformed", () => {
    expect(validateProposals({}, input).dropped.malformed).toBe(1);
  });

  const T2 = "Okay let's move on to the next one. Maya Chen's Fold trademark, Dana will file the response on November 20 for sure.";
  const base = { ...goodRaw.proposals[0] };
  const withT = (transcript: string, over: Record<string, unknown>, meetingDate = "2026-11-16") =>
    validateProposals({ proposals: [{ ...base, ...over }] }, { ...input, transcript, meetingDate });

  it("a generic quote with a valid id does not keep the record", () => {
    const r = withT("Okay let's move on to the next one. Nothing else was said here.", { evidence: "okay let's move on to the next one", dueDate: null, ownerId: null });
    expect(r.proposals[0].record).toBe("unmatched");
    expect(r.proposals[0].flags.join()).toMatch(/doesn't name this record/);
  });

  it("keeps the record when the client is named in the window, and the owner only when named there", () => {
    expect(withT(T2, { evidence: "okay let's move on to the next one", dueDate: null }).proposals[0].record).toEqual({ kind: "matter", id: "r1" });
    const ok = withT(T2, { evidence: "okay let's move on to the next one", dueDate: null });
    expect(ok.proposals[0].ownerId).toBe("u1"); // Dana is within 300 chars
    const far = "Dana is here. " + "filler words ".repeat(60) + "okay let's move on to the next one " + "filler words ".repeat(60) + "Maya Chen";
    const r = withT(far, { evidence: "okay let's move on to the next one", dueDate: null });
    expect(r.proposals[0].ownerId).toBeNull();
    expect(r.proposals[0].record).toBe("unmatched");
  });

  it("runs the date check on the transcript span, not the model's string", () => {
    const r = withT("Maya Chen has class 11, 20 items to file", { evidence: "class 11/20 items", dueDate: "2026-11-20", ownerId: null });
    expect(r.proposals[0].dueDate).toBeNull();
  });

  it("refuses short quotes", () => {
    expect(withT(T2, { evidence: "Dana will file" }).dropped.no_evidence).toBe(1);
    expect(withT(T2, { evidence: "Dana will file the response" }).proposals).toHaveLength(1); // 5 words
  });

  it("drops a quote over 300 characters instead of truncating", () => {
    const long = "word ".repeat(70).trim();
    const r = withT("Maya Chen " + long, { evidence: long });
    expect(r.dropped.evidence_too_long).toBe(1);
    expect(r.proposals).toHaveLength(0);
  });

  it("refuses a negated date", () => {
    for (const phrase of ["we do not need it by November 20", "it isn't due on November 20", "it is no longer due November 20", "they won't file by November 20"]) {
      const r = withT(`Maya Chen: ${phrase} at all`, { evidence: `${phrase} at all`, ownerId: null });
      expect(r.proposals[0].dueDate, phrase).toBeNull();
    }
    const far = withT("Maya Chen: not now, but we send it ok then by November 20", { evidence: "not now, but we send it ok then by November 20", ownerId: null });
    expect(far.proposals[0].dueDate).toBe("2026-11-20");
  });

  it("treats lowercase 'may' as a word, and capitalised May with a day as a month", () => {
    const w = withT("Maya Chen: it may 20 more items later", { evidence: "it may 20 more items later", dueDate: "2027-05-20", ownerId: null }, "2026-11-16");
    expect(w.proposals[0].dueDate).toBeNull();
    const m = withT("Maya Chen: file it by May 20, please", { evidence: "file it by May 20, please", dueDate: "2027-05-20", ownerId: null });
    expect(m.proposals[0].dueDate).toBe("2027-05-20");
    const cap = withT("Maya Chen: May 20 more items today", { evidence: "May 20 more items today", dueDate: "2027-05-20", ownerId: null });
    expect(cap.proposals[0].dueDate).toBeNull();
  });

  it("with no year, the date is the next occurrence; past and wrong-year dates are refused", () => {
    const e = "Maya Chen: file by November 20 please";
    expect(withT(e, { evidence: "file by November 20 please", ownerId: null }).proposals[0].dueDate).toBe("2026-11-20");
    expect(withT(e, { evidence: "file by November 20 please", dueDate: "2027-11-20", ownerId: null }).proposals[0].dueDate).toBeNull();
    // already past this year, so the next is 2027
    const past = "Maya Chen: file by March 3rd please";
    expect(withT(past, { evidence: "file by March 3rd please", dueDate: "2026-03-03", ownerId: null }).proposals[0].dueDate).toBeNull();
    expect(withT(past, { evidence: "file by March 3rd please", dueDate: "2027-03-03", ownerId: null }).proposals[0].dueDate).toBe("2027-03-03");
    // stated year in the past
    const y = "Maya Chen: file by March 3, 2026 please";
    expect(withT(y, { evidence: "file by March 3, 2026 please", dueDate: "2026-03-03", ownerId: null }).proposals[0].dueDate).toBeNull();
  });

  it("an invalid meeting date means no dates at all", () => {
    const r = validateProposals(goodRaw, { ...input, meetingDate: "garbage" });
    expect(r.proposals[0].dueDate).toBeNull();
  });

  it("dedupes unmatched proposals by name plus step", () => {
    const mk = (name: string) => ({ ...base, record: { kind: "unmatched", id: null }, recordName: name });
    const r = validateProposals({ proposals: [mk("A"), mk("B")] }, input);
    expect(r.proposals).toHaveLength(2);
  });
});
