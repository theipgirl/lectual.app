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
});
