import { describe, expect, it, vi } from "vitest";
import {
  MANUAL_EMAIL_QUEUED,
  MANUAL_EMAIL_REFUSALS as R,
  buildManualEmail,
  manualMarker,
  manualReasoning,
  runManualEmail,
  usableRecipient,
  type ManualEmailDeps,
} from "@/lib/consult-proposal/manual-email";
import { REASONING_PRINCIPLE, SECOND_MARK_SENTENCE } from "@/lib/consult-proposal/email";
import { CONSULT_PROPOSAL_SOURCE } from "@/lib/consult-proposal/shared";
import type { ProposalRow } from "@/lib/proposals/types";

const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";
const ORG = "org-1";

function content(opts: { logo?: boolean; discount?: number } = {}) {
  const marks = [{ id: "m1", kind: "word" }, ...(opts.logo === false ? [] : [{ id: "m2", kind: "logo" }])];
  return {
    client: { first_name: "Sevetri", full_name: "Sevetri Wilson" },
    names: [{ id: "n1", name: "Prosperall", marks }],
    pricing: { second_mark_discount_pct: opts.discount ?? 50 },
  } as unknown as ProposalRow["content"];
}

function proposal(over: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: PROPOSAL_ID,
    org_id: ORG,
    status: "draft",
    public_token: "tok_abcdefghijklmnopqrstuvwxyz0123456789",
    client_name: "Sevetri Wilson",
    client_email: "sevetri@example.com",
    lead_id: "lead-1",
    matter_id: null,
    content: content(),
    ...over,
  } as ProposalRow;
}

function deps(over: Partial<ManualEmailDeps> = {}) {
  const d: ManualEmailDeps = {
    gate: vi.fn(async () => null),
    loadProposal: vi.fn(async () => proposal()),
    context: vi.fn(async () => ({ orgId: ORG, userId: "user-1", firmName: "RPB Law (dev)", firmSlug: "rpb-law" })),
    queueOrgKey: vi.fn(async () => "rpb-law"),
    links: vi.fn(async (_o, token, id) => ({
      clientUrl: `https://proposals.example.com/p/${token}/`,
      staffUrl: `https://app.example.com/dashboard/proposals/${id}/`,
    })),
    pendingFor: vi.fn(async () => ({ status: "none" as const })),
    createDraft: vi.fn(async () => ({ id: "q-1" })),
    writeMarker: vi.fn(async () => true),
    revalidate: vi.fn(),
    testPrefix: "",
    ...over,
  };
  return d;
}

const nothingQueued = (d: ManualEmailDeps) => {
  expect(d.createDraft).not.toHaveBeenCalled();
  expect(d.writeMarker).not.toHaveBeenCalled();
};

describe("reasoning block", () => {
  it("is Rebecca's principle paragraph when a word and a logo mark are both offered", () => {
    expect(manualReasoning(content())).toBe(REASONING_PRINCIPLE);
  });
  it("is empty for a word mark alone, and never carries the risk or fallback paragraphs", () => {
    expect(manualReasoning(content({ logo: false }))).toBeNull();
    const body = buildManualEmail({ content: content(), firmName: "RPB Law", proposalUrl: "https://x.example.com/p/t/", signOff: "The RPB Law Team" }).body;
    expect(body).not.toMatch(/preliminary search|may present some challenges|stronger path/);
  });
});

describe("buildManualEmail", () => {
  const base = { firmName: "RPB Law", proposalUrl: "https://proposals.example.com/p/tok/", signOff: "The RPB Law Team" };
  it("renders Rebecca's template: title + url, principle, sign-off, subject", () => {
    const e = buildManualEmail({ ...base, content: content() });
    expect(e.subject).toBe("Your Trademark Proposal from RPB Law");
    expect(e.body).toContain("Hi Sevetri,");
    expect(e.body).toContain(REASONING_PRINCIPLE);
    expect(e.body).toContain("Sevetri Wilson Trademark Proposal\nhttps://proposals.example.com/p/tok/");
    expect(e.body.endsWith("Best,\nThe RPB Law Team")).toBe(true);
  });
  it("the second-mark sentence follows the existing rule (word+logo AND a discount)", () => {
    expect(buildManualEmail({ ...base, content: content() }).body).toContain(SECOND_MARK_SENTENCE);
    expect(buildManualEmail({ ...base, content: content({ discount: 0 }) }).body).not.toContain(SECOND_MARK_SENTENCE);
    expect(buildManualEmail({ ...base, content: content({ logo: false }) }).body).not.toContain(SECOND_MARK_SENTENCE);
  });
  it("refuses a claude.ai link", () => {
    expect(() => buildManualEmail({ ...base, content: content(), proposalUrl: "https://claude.ai/artifact/x" })).toThrow();
  });
});

describe("recipient", () => {
  it("rejects blank and placeholder addresses", () => {
    expect(usableRecipient(null)).toBeNull();
    expect(usableRecipient("  ")).toBeNull();
    expect(usableRecipient("x@lead.invalid")).toBeNull();
    expect(usableRecipient(" a@b.com ")).toBe("a@b.com");
  });
});

describe("marker", () => {
  it("is the queue_drafted row link.ts reads: source, proposal_id, queue_id", () => {
    const m = manualMarker({ orgId: ORG, userId: "u", leadId: "l", matterId: null, proposalId: PROPOSAL_ID, queueId: "q-1", subject: "s" });
    expect(m.type).toBe("queue_drafted");
    expect(m.payload).toMatchObject({ source: CONSULT_PROPOSAL_SOURCE, proposal_id: PROPOSAL_ID, queue_id: "q-1" });
    // No meeting_id / paste_sha256: the agent's idempotency markers are untouched.
    expect(m.payload).not.toHaveProperty("meeting_id");
    expect(m.payload).not.toHaveProperty("paste_sha256");
  });
});

describe("runManualEmail", () => {
  it("success: queues the email to the client's address, writes the marker, says queued (never sent)", async () => {
    const d = deps();
    const r = await runManualEmail(d, PROPOSAL_ID);
    expect(r).toEqual({ ok: true, notice: MANUAL_EMAIL_QUEUED, queueId: "q-1" });
    expect(MANUAL_EMAIL_QUEUED).toBe("Post-consult email queued for approval.");
    expect(MANUAL_EMAIL_QUEUED).not.toMatch(/sent/i);
    const draft = vi.mocked(d.createDraft).mock.calls[0][0];
    expect(draft).toMatchObject({
      orgKey: "rpb-law",
      agent: "post-consult",
      type: "CLIENT_EMAIL",
      recipient: "sevetri@example.com",
      leadId: "lead-1",
      teamSignOff: "The RPB Law Team",
      dedupe: false,
      subject: "Your Trademark Proposal from RPB Law",
    });
    expect(draft.summary).toContain("https://app.example.com/dashboard/proposals/");
    expect(draft.draftBody).toContain("https://proposals.example.com/p/tok_abcdefghijklmnopqrstuvwxyz0123456789/");
    const marker = vi.mocked(d.writeMarker).mock.calls[0][0];
    expect(marker.payload).toMatchObject({ source: CONSULT_PROPOSAL_SOURCE, proposal_id: PROPOSAL_ID, queue_id: "q-1" });
    expect(marker.org_id).toBe(ORG);
    expect(d.revalidate).toHaveBeenCalledWith(PROPOSAL_ID, "lead-1");
  });

  it("works for a saved and a link-live proposal", async () => {
    for (const status of ["approved", "sent"] as const) {
      const d = deps({ loadProposal: vi.fn(async () => proposal({ status })) });
      expect((await runManualEmail(d, PROPOSAL_ID)).ok).toBe(true);
    }
  });

  it("test prefix goes on the subject and headline", async () => {
    const d = deps({ testPrefix: "[TEST] " });
    await runManualEmail(d, PROPOSAL_ID);
    const draft = vi.mocked(d.createDraft).mock.calls[0][0];
    expect(draft.subject.startsWith("[TEST] ")).toBe(true);
    expect(draft.headline.startsWith("[TEST] ")).toBe(true);
  });

  it("a refused gate (signed out, role, module) reads nothing and queues nothing", async () => {
    const d = deps({ gate: vi.fn(async () => ({ error: "Your role can view proposals but not change them." })) });
    expect(await runManualEmail(d, PROPOSAL_ID)).toEqual({ ok: false, error: "Your role can view proposals but not change them." });
    expect(d.loadProposal).not.toHaveBeenCalled();
    nothingQueued(d);
  });

  it("no session context, an unknown id, or another firm's proposal: not found", async () => {
    for (const d of [
      deps({ context: vi.fn(async () => null) }),
      deps({ loadProposal: vi.fn(async () => null) }),
      deps({ loadProposal: vi.fn(async () => proposal({ org_id: "other-org" })) }),
    ]) {
      expect(await runManualEmail(d, PROPOSAL_ID)).toEqual({ ok: false, error: R.notFound });
      nothingQueued(d);
    }
  });

  it("an unreadable proposal is a fixed sentence", async () => {
    const d = deps({ loadProposal: vi.fn(async () => { throw new Error("db password"); }) });
    expect(await runManualEmail(d, PROPOSAL_ID)).toEqual({ ok: false, error: R.unexpected });
    nothingQueued(d);
  });

  it("accepted, replaced and withdrawn versions are refused", async () => {
    for (const status of ["accepted", "superseded", "withdrawn"] as const) {
      const d = deps({ loadProposal: vi.fn(async () => proposal({ status })) });
      expect(await runManualEmail(d, PROPOSAL_ID)).toEqual({ ok: false, error: R.status });
      nothingQueued(d);
    }
  });

  it("no client email (null, blank, .invalid): the fixed sentence", async () => {
    for (const client_email of [null, " ", "x@lead.invalid"]) {
      const d = deps({ loadProposal: vi.fn(async () => proposal({ client_email })) });
      expect(await runManualEmail(d, PROPOSAL_ID)).toEqual({ ok: false, error: R.noEmail });
      nothingQueued(d);
    }
  });

  it("no queue connected", async () => {
    const d = deps({ queueOrgKey: vi.fn(async () => null) });
    expect(await runManualEmail(d, PROPOSAL_ID)).toEqual({ ok: false, error: R.noQueue });
    nothingQueued(d);
  });

  it("no firm name: cannot sign", async () => {
    const d = deps({ context: vi.fn(async () => ({ orgId: ORG, userId: "u", firmName: "", firmSlug: "" })) });
    expect(await runManualEmail(d, PROPOSAL_ID)).toEqual({ ok: false, error: R.noFirmName });
    nothingQueued(d);
  });

  it("a pending email for this version refuses a second one", async () => {
    const d = deps({ pendingFor: vi.fn(async () => ({ status: "pending" as const, queueId: "q-0" })) });
    expect(await runManualEmail(d, PROPOSAL_ID)).toEqual({ ok: false, error: R.pending });
    nothingQueued(d);
  });

  it("an unreadable pending check fails closed", async () => {
    const d = deps({ pendingFor: vi.fn(async () => ({ status: "unreadable" as const })) });
    expect(await runManualEmail(d, PROPOSAL_ID)).toEqual({ ok: false, error: R.pendingUnreadable });
    nothingQueued(d);
  });

  it("an unusable client link (claude.ai) or no site address queues nothing", async () => {
    const claude = deps({ links: vi.fn(async () => ({ clientUrl: "https://claude.ai/x", staffUrl: "https://a.example.com/" })) });
    const r = await runManualEmail(claude, PROPOSAL_ID);
    expect(r.ok).toBe(false);
    nothingQueued(claude);
    const noOrigin = deps({ links: vi.fn(async () => { throw new Error("no host"); }) });
    expect(await runManualEmail(noOrigin, PROPOSAL_ID)).toEqual({ ok: false, error: R.noOrigin });
    nothingQueued(noOrigin);
  });

  it("a queue failure gives a fixed sentence (no raw error) and writes no marker", async () => {
    const d = deps({ createDraft: vi.fn(async () => { throw new Error("Queue API 500: secret"); }) });
    expect(await runManualEmail(d, PROPOSAL_ID)).toEqual({ ok: false, error: R.queueFailed });
    expect(d.writeMarker).not.toHaveBeenCalled();
  });

  it("a deduped queue answer is refused and no marker is tied to someone else's item", async () => {
    const d = deps({ createDraft: vi.fn(async () => ({ id: "q-other", deduped: true })) });
    expect(await runManualEmail(d, PROPOSAL_ID)).toEqual({ ok: false, error: R.deduped });
    expect(d.writeMarker).not.toHaveBeenCalled();
  });

  it("a marker that cannot be written: retried once, the person is told to reject the queued item", async () => {
    const d = deps({ writeMarker: vi.fn(async () => false) });
    expect(await runManualEmail(d, PROPOSAL_ID)).toEqual({ ok: false, error: R.unlinked });
    expect(R.unlinked).toMatch(/Reject it in the approval queue/);
    expect(d.writeMarker).toHaveBeenCalledTimes(2);
    expect(d.revalidate).not.toHaveBeenCalled();
    const thrown = deps({ writeMarker: vi.fn(async () => { throw new Error("x"); }) });
    expect(await runManualEmail(thrown, PROPOSAL_ID)).toEqual({ ok: false, error: R.unlinked });
  });
});
