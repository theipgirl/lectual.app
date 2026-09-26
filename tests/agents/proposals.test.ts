import { describe, it, expect } from "vitest";
import { acceptedUpdate, pendingProposals } from "@/lib/agents/proposals";

const intel = (id: string, messageId: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "ai_insight",
  created_at: "2026-09-24T09:00:00Z",
  payload: {
    source: "email-intel",
    message_id: messageId,
    summary: "Client shared company details.",
    proposed: [
      { field: "business_name", value: "Sankofa Brewing LLC", evidence: "Our company is Sankofa Brewing LLC" },
      { field: "phone", value: "555-0100", evidence: "call me on 555-0100" },
    ],
    applied: [],
    legal_question: null,
    ...extra,
  },
});

describe("email-intel proposals awaiting review", () => {
  it("lists unreviewed proposals and drops ones a person has decided", () => {
    const rows = [
      intel("a1", "gmail:m1"),
      intel("a2", "gmail:m2"),
      { id: "r1", type: "ai_insight", created_at: "2026-09-24T10:00:00Z", payload: { source: "email-intel-review", message_id: "gmail:m2", decision: "dismiss" } },
    ];
    expect(pendingProposals(rows).map((p) => p.messageId)).toEqual(["gmail:m1"]);
  });

  it("hides fields the agent already applied in act mode", () => {
    const [p] = pendingProposals([intel("a1", "gmail:m1", { applied: ["business_name"] })]);
    expect(p.proposed.map((c) => c.field)).toEqual(["phone"]);
  });

  it("ignores unknown fields a tampered payload might carry", () => {
    const [p] = pendingProposals([intel("a1", "gmail:m1", { proposed: [{ field: "email", value: "attacker@example.com", evidence: "" }, { field: "phone", value: "555", evidence: "" }] })]);
    expect(p.proposed.map((c) => c.field)).toEqual(["phone"]);
  });

  it("keeps a proposal that only carries a legal question", () => {
    expect(pendingProposals([intel("a1", "gmail:m1", { proposed: [], legal_question: "Can I file in Canada?" })])).toHaveLength(1);
  });

  it("accepting writes the STORED value for the ticked fields only", () => {
    const [p] = pendingProposals([intel("a1", "gmail:m1")]);
    expect(acceptedUpdate(p, ["phone"])).toEqual({ phone: "555-0100" });
    expect(acceptedUpdate(p, ["email", "first_name"])).toEqual({});
  });
});
