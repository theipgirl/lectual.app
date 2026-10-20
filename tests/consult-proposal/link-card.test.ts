import { describe, it, expect, vi, beforeEach } from "vitest";
import { sevetri } from "../proposals/fixture";

/**
 * The queue item's linked-proposal panel reads the proposal and, separately,
 * the consult agent's evidence event. A failed events read must reach the card
 * as "unavailable" (never "no receipts"), and the approve gate must not pay for
 * that second read.
 */

const PROPOSAL_ID = "55555555-5555-4555-8555-555555555555";

type Answer = { data: unknown; error: { message: string } | null };

/** A chainable query that resolves to `answers[table]` however it is filtered. */
function client(answers: Record<string, Answer | (() => Promise<Answer>)>, seen: string[] = []) {
  return {
    from(table: string) {
      seen.push(table);
      const resolve = async (): Promise<Answer> => {
        const a = answers[table];
        return typeof a === "function" ? a() : (a ?? { data: null, error: null });
      };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
      q.maybeSingle = resolve;
      q.then = (f: (v: Answer) => unknown, r?: (e: unknown) => unknown) => resolve().then(f, r);
      return q;
    },
  };
}

const proposalRow = {
  id: PROPOSAL_ID,
  version: 1,
  status: "draft",
  client_name: "Sevetri Wilson",
  client_email: "s@example.com",
  title: "Trademark Proposal",
  content: sevetri(),
  expires_on: "2026-11-10",
  pay_url: "https://pay.example/x",
};

const EVIDENCE_EVENT = {
  id: "e1",
  org_id: "o",
  proposal_id: PROPOSAL_ID,
  family_id: PROPOSAL_ID,
  type: "edited",
  actor: "agent",
  actor_user_id: null,
  payload: { source: "consult-proposal", evidence: [{ path: "p", quote: "a word mark and a logo", verified: true }] },
  created_at: "2026-10-18T12:01:00Z",
};

async function load(answers: Parameters<typeof client>[0], seen: string[] = []) {
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => client(answers, seen)) }));
  vi.doMock("@/lib/queue/api", () => ({ getQueueItem: vi.fn() }));
  vi.doMock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn() }));
  vi.doMock("@/lib/proposals/store", async () => {
    const real = await vi.importActual<typeof import("../../src/lib/proposals/store")>("../../src/lib/proposals/store");
    return { ...real, isCurrentUserApprover: vi.fn(), sendProposal: vi.fn() };
  });
  return import("../../src/lib/consult-proposal/link");
}

describe("readLinkedProposal / loadLinkedPanel", () => {
  beforeEach(() => vi.resetModules());

  it("builds the card with receipts from the agent's event", async () => {
    const link = await load({ client_proposal: { data: proposalRow, error: null }, client_proposal_event: { data: [EVIDENCE_EVENT], error: null } });
    const read = await link.readLinkedProposal(PROPOSAL_ID, { withCard: true });
    expect(read).toMatchObject({ status: "ok" });
    if (read.status !== "ok") return;
    expect(read.proposal.card?.receipts).toMatchObject({ status: "ok", verified: ["a word mark and a logo"] });
    expect(read.proposal.card?.client).toBe("Sevetri Wilson");
    expect(read.proposal.card?.legalAtSigningCents).toBe(read.proposal.legalCents);
    expect(read.proposal.card?.usptoAtFilingCents).toBe(read.proposal.govCents);
  });

  it("a failed events read becomes unavailable receipts, and the proposal still loads", async () => {
    const link = await load({ client_proposal: { data: proposalRow, error: null }, client_proposal_event: { data: null, error: { message: "boom" } } });
    const read = await link.readLinkedProposal(PROPOSAL_ID, { withCard: true });
    expect(read).toMatchObject({ status: "ok" });
    if (read.status !== "ok") return;
    expect(read.proposal.card?.receipts).toEqual({ status: "unavailable" });
  });

  it("a thrown events read is also unavailable, not none", async () => {
    const link = await load({
      client_proposal: { data: proposalRow, error: null },
      client_proposal_event: async () => {
        throw new Error("network");
      },
    });
    const read = await link.readLinkedProposal(PROPOSAL_ID, { withCard: true });
    expect(read.status === "ok" && read.proposal.card?.receipts).toEqual({ status: "unavailable" });
  });

  it("an event list with no agent event is none", async () => {
    const link = await load({ client_proposal: { data: proposalRow, error: null }, client_proposal_event: { data: [], error: null } });
    const read = await link.readLinkedProposal(PROPOSAL_ID, { withCard: true });
    expect(read.status === "ok" && read.proposal.card?.receipts).toEqual({ status: "none" });
  });

  it("the approve gate's read (no card asked for) never reads events", async () => {
    const seen: string[] = [];
    const link = await load({ client_proposal: { data: proposalRow, error: null } }, seen);
    const read = await link.readLinkedProposal(PROPOSAL_ID);
    expect(read.status === "ok" && read.proposal.card).toBeUndefined();
    expect(seen).toEqual(["client_proposal"]);
  });

  it("loadLinkedPanel asks for the card", async () => {
    const link = await load({
      crm_activity: { data: [{ lead_id: "lead-1", payload: { proposal_id: PROPOSAL_ID, queue_id: "q1" } }], error: null },
      client_proposal: { data: proposalRow, error: null },
      client_proposal_event: { data: [EVIDENCE_EVENT], error: null },
    });
    const panel = await link.loadLinkedPanel("q1");
    expect(panel.status).toBe("ok");
    expect(panel.status === "ok" && panel.proposal.card?.receipts.status).toBe("ok");
  });
});
