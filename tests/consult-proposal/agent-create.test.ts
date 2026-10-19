import { describe, it, expect } from "vitest";
import type { ProposalsDbClient } from "@/lib/proposals/store";
import { insertAgentProposal, recordConsultDraftEvent } from "@/lib/proposals/agent-create";
import { ProposalError } from "@/lib/proposals/errors";
import { ORG, assertOrgFenced, writes } from "../agents/helpers";
import { fakeAdmin, type Handler } from "../mailbox/fake-db";
import { sevetri } from "../proposals/fixture";

const input = {
  orgId: ORG,
  createdBy: null,
  clientName: "Sevetri Wilson",
  clientEmail: "s@example.com",
  title: "Trademark Proposal",
  content: sevetri(),
  leadId: "lead-1",
  matterId: null,
  expiresOn: "2026-11-01",
  payUrl: "https://pay.example.com/form",
};

const echo: Handler = (q) => (q.action === "insert" ? { data: q.values, error: null } : undefined);

describe("insertAgentProposal", () => {
  it("inserts a draft, source agent, stamped with the firm, a fresh token, no creator for the cron", async () => {
    const { client, log } = fakeAdmin(echo);
    const row = await insertAgentProposal(client as unknown as ProposalsDbClient, input);
    const [ins] = writes(log, "client_proposal", "insert");
    expect(ins.values).toMatchObject({ org_id: ORG, status: "draft", source: "agent", version: 1, created_by: null, updated_by: null, lead_id: "lead-1" });
    const v = ins.values as { id: string; family_id: string; public_token: string };
    expect(v.family_id).toBe(v.id);
    expect(v.public_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row.id).toBe(v.id);
    assertOrgFenced(log);
  });

  it("gets a different token every time", async () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const { client, log } = fakeAdmin(echo);
      await insertAgentProposal(client as unknown as ProposalsDbClient, input);
      tokens.add((writes(log, "client_proposal", "insert")[0].values as { public_token: string }).public_token);
    }
    expect(tokens.size).toBe(5);
  });

  it("refuses a column the database would, before touching it", async () => {
    const { client, log } = fakeAdmin(echo);
    await expect(insertAgentProposal(client as unknown as ProposalsDbClient, { ...input, clientName: "  " })).rejects.toBeInstanceOf(ProposalError);
    await expect(insertAgentProposal(client as unknown as ProposalsDbClient, { ...input, payUrl: "http://insecure.example.com" })).rejects.toBeInstanceOf(ProposalError);
    expect(log).toHaveLength(0);
  });

  it("surfaces a database refusal as a readable error", async () => {
    const { client } = fakeAdmin(() => ({ data: null, error: { message: "boom", code: "23503" } }));
    await expect(insertAgentProposal(client as unknown as ProposalsDbClient, input)).rejects.toBeInstanceOf(ProposalError);
  });
});

describe("recordConsultDraftEvent", () => {
  const proposal = { id: "p1", org_id: ORG, family_id: "p1" };
  it("writes ONE 'edited' event as the agent, with no user, on the proposal's own firm", async () => {
    const { client, log } = fakeAdmin(() => undefined);
    const ok = await recordConsultDraftEvent(client as unknown as ProposalsDbClient, proposal, {
      source: "consult-proposal",
      evidence: [{ path: "x", quote: "q", verified: true }],
      notes: "n",
      meeting_id: "m1",
      meeting_title: "Call",
    });
    expect(ok).toBe(true);
    expect(log).toHaveLength(1);
    expect(log[0].values).toMatchObject({ org_id: ORG, proposal_id: "p1", family_id: "p1", type: "edited", actor: "agent", actor_user_id: null });
    assertOrgFenced(log);
  });

  it("never throws: a failed write returns false", async () => {
    const { client } = fakeAdmin(() => ({ data: null, error: { message: "nope" } }));
    expect(await recordConsultDraftEvent(client as unknown as ProposalsDbClient, proposal, { source: "consult-proposal", evidence: [], notes: "" })).toBe(false);
    const throwing = { from: () => { throw new Error("x"); } };
    expect(await recordConsultDraftEvent(throwing as unknown as ProposalsDbClient, proposal, { source: "consult-proposal", evidence: [], notes: "" })).toBe(false);
  });
});
