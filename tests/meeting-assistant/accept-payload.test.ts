import { describe, expect, it } from "vitest";
import { buildAcceptPayload, validateProposals } from "@/lib/meeting-assistant";
import { goodRaw, input } from "./fixtures";

describe("buildAcceptPayload", () => {
  const [p] = validateProposals(goodRaw, input).proposals;
  it("builds a matter task and a note", () => {
    expect(buildAcceptPayload(p, { date: "2026-11-16" })).toEqual({
      task: { title: "Send the office action response", type: "custom", dueAt: "2026-11-20", assigneeId: "u1", matterId: "r1" },
      noteText: "From the 2026-11-16 review call: Send the office action response\nDana takes it.",
    });
  });
  it("uses leadId for a lead and omits unset fields", () => {
    const out = buildAcceptPayload({ ...p, record: { kind: "lead", id: "r2" }, dueDate: null, ownerId: null, note: "" }, { date: "2026-11-16" })!;
    expect(out.task).toEqual({ title: p.nextStep, type: "custom", leadId: "r2" });
    expect(out.noteText).not.toContain("\n");
  });
  it("writes nothing for an unmatched record", () => {
    expect(buildAcceptPayload({ ...p, record: "unmatched" }, { date: "2026-11-16" })).toBeNull();
  });
});
