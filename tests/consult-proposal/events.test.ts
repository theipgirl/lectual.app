import { describe, it, expect } from "vitest";
import { describeProposalEvent } from "@/lib/proposal-editor/events";
import type { ProposalEventRow } from "@/lib/proposals/types";

function agentEvent(payload: Record<string, unknown>): ProposalEventRow {
  return {
    id: "e1",
    org_id: "o",
    proposal_id: "p1",
    family_id: "f",
    type: "edited",
    actor: "agent",
    actor_user_id: null,
    payload,
    created_at: "2026-10-20T18:14:00Z",
  };
}
const ctx = { names: new Map<string, string>() };

describe("the consult agent's event in the activity log", () => {
  it("says where it was drafted from, with the quotes and the notes", () => {
    const line = describeProposalEvent(
      agentEvent({
        source: "consult-proposal",
        meeting_id: "m1",
        meeting_title: "Strategy call with Sevetri",
        notes: "Rebecca recommended word and logo marks for both brands.",
        evidence: [
          { path: "names[p].marks", quote: "I'd file the word and the logo for both", verified: true },
          { path: "pricing", quote: "we could do it for four thousand", verified: false },
        ],
      }),
      ctx,
    );
    expect(line.who).toBe("The consult agent");
    expect(line.what).toBe("drafted this proposal from the meeting “Strategy call with Sevetri”");
    expect(line.details[0]).toContain("Rebecca recommended word and logo marks");
    expect(line.details).toContain("From the call: “I'd file the word and the logo for both”");
    expect(line.details.some((d) => d.startsWith("Not found word for word in the call") && d.includes("four thousand"))).toBe(true);
  });

  it("a pasted transcript has no meeting", () => {
    const line = describeProposalEvent(agentEvent({ source: "consult-proposal", notes: "n", evidence: [] }), ctx);
    expect(line.what).toBe("drafted this proposal from a pasted transcript");
  });

  it("caps a long evidence list and survives a malformed payload", () => {
    const evidence = Array.from({ length: 20 }, (_, i) => ({ path: "x", quote: `quote ${i}`, verified: true }));
    const line = describeProposalEvent(agentEvent({ source: "consult-proposal", evidence }), ctx);
    expect(line.details).toHaveLength(13);
    expect(line.details[12]).toBe("And 8 more quotes from the call.");
    expect(() => describeProposalEvent(agentEvent({ source: "consult-proposal", evidence: "nope", notes: 5 }), ctx)).not.toThrow();
  });

  it("an ordinary agent edit without the consult source is unchanged", () => {
    expect(describeProposalEvent(agentEvent({}), ctx).what).toBe("edited the proposal");
  });
});
