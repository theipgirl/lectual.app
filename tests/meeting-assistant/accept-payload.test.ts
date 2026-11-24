import { describe, expect, it } from "vitest";
import { buildAcceptPayload, validateProposals } from "@/lib/meeting-assistant";
import { goodRaw, input } from "./fixtures";

describe("buildAcceptPayload", () => {
  const ctx = { rows: input.rows, members: input.members };
  const [p] = validateProposals(goodRaw, input).proposals;
  it("builds a matter task and a note", () => {
    expect(buildAcceptPayload(p, { date: "2026-11-16" }, ctx)).toEqual({
      task: { title: "Send the office action response", type: "custom", dueAt: "2026-11-20", assigneeId: "u1", matterId: "r1" },
      noteText: "From the 2026-11-16 review call: Send the office action response\nDana takes it.",
    });
  });
  it("uses leadId for a lead and omits unset fields", () => {
    const out = buildAcceptPayload({ ...p, record: { kind: "lead", id: "r2" }, dueDate: null, ownerId: null, note: "" }, { date: "2026-11-16" }, ctx)!;
    expect(out.task).toEqual({ title: p.nextStep, type: "custom", leadId: "r2" });
    expect(out.noteText).not.toContain("\n");
  });
  it("writes nothing for an unmatched record", () => {
    expect(buildAcceptPayload({ ...p, record: "unmatched" }, { date: "2026-11-16" }, ctx)).toBeNull();
  });

  it("returns null on any forged or mismatched input", () => {
    const m = { date: "2026-11-16" };
    const bad = [
      { ...p, record: { kind: "lead" as const, id: "r1" } }, // wrong kind
      { ...p, record: { kind: "matter" as const, id: "zzz" } }, // not in rows
      { ...p, ownerId: "ghost" },
      { ...p, dueDate: "2026-02-30" },
      { ...p, dueDate: "tomorrow" },
      { ...p, nextStep: "x".repeat(201) },
      { ...p, nextStep: "   " },
      { ...p, note: "y".repeat(401) },
    ];
    for (const b of bad) expect(buildAcceptPayload(b, m, ctx)).toBeNull();
    expect(buildAcceptPayload(p, { date: "nope" }, ctx)).toBeNull();
    expect(buildAcceptPayload(p, m, { rows: [], members: input.members })).toBeNull();
  });
});
