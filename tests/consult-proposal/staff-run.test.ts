import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * draftProposalForStaff: the guard around everything that can throw before
 * runConsultProposal. A throw is logged with its stage and read back as a
 * specific sentence, not the old generic one.
 */

class EnvVarError extends Error {
  name = "EnvVarError";
  constructor(readonly key: string, readonly reason: "missing" | "invalid" = "missing") {
    super(`Environment variable ${key} is not set.`);
  }
}

const mocks = vi.hoisted(() => ({
  getAdminClient: vi.fn(),
  getSiteOrigin: vi.fn(),
  activeQueueOrgKey: vi.fn(),
  runConsultProposal: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/claude", () => ({ aiConfigured: () => true, callClaude: vi.fn() }));
vi.mock("@/lib/db/admin", () => ({ getAdminClient: mocks.getAdminClient }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({}) }));
vi.mock("@/lib/queue/api", () => ({ createDraft: vi.fn() }));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: mocks.activeQueueOrgKey }));
vi.mock("@/lib/site-origin", () => ({ getSiteOrigin: mocks.getSiteOrigin }));
vi.mock("@/lib/consult-proposal/run", () => ({ runConsultProposal: mocks.runConsultProposal }));

import { draftProposalForStaff } from "@/lib/consult-proposal/staff-run";

const args = {
  orgId: "org-1",
  userId: "user-1",
  source: { kind: "pasted" as const, text: "SECRET TRANSCRIPT sevetri@example.com" },
  lead: { id: "lead-1", firstName: "S", lastName: "W", email: "sevetri@example.com", businessName: null },
  matterId: null,
};

describe("draftProposalForStaff", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.activeQueueOrgKey.mockResolvedValue("firm-key");
    mocks.getAdminClient.mockReturnValue({});
    mocks.getSiteOrigin.mockResolvedValue("https://lectual.app");
    mocks.runConsultProposal.mockResolvedValue({ ok: true, proposalId: "p1", queueId: "q1", clientName: "S W", errorCount: 0, warningCount: 0, costUsd: null });
  });
  afterEach(() => {
    spy.mockRestore();
    vi.clearAllMocks();
  });

  it("a missing service-role key is named, logged once with its stage, and leaks nothing", async () => {
    mocks.getAdminClient.mockImplementation(() => {
      throw new EnvVarError("SUPABASE_SERVICE_ROLE_KEY");
    });
    const r = await draftProposalForStaff(args);
    expect(r).toEqual({
      ok: false,
      error: "The proposal couldn't be drafted because the server key (SUPABASE_SERVICE_ROLE_KEY) isn't set on this deployment. Nothing was sent.",
    });
    expect(mocks.runConsultProposal).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
    const text = String(spy.mock.calls[0][0]);
    expect(JSON.parse(text)).toMatchObject({ event: "consult_proposal_failed", stage: "env", name: "EnvVarError" });
    expect(text).not.toContain("SECRET TRANSCRIPT");
    expect(text).not.toContain("sevetri@example.com");
  });

  it("any other throw before the run is logged and refused with the stage, keeping 'Nothing was sent'", async () => {
    mocks.getSiteOrigin.mockRejectedValue(new Error("headers() outside a request"));
    const r = await draftProposalForStaff(args);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/step: env.*Nothing was sent\./);
    expect(JSON.parse(String(spy.mock.calls[0][0]))).toMatchObject({ stage: "env", message: "headers() outside a request" });
  });

  it("passes the resolved origin and returns the run's refusal message", async () => {
    mocks.runConsultProposal.mockResolvedValue({ ok: false, reason: "unavailable", message: "Specific reason.", costUsd: null });
    const r = await draftProposalForStaff(args);
    expect(r).toEqual({ ok: false, error: "Specific reason." });
    expect(mocks.runConsultProposal.mock.calls[0][0]).toMatchObject({ origin: "https://lectual.app", queueOrgKey: "firm-key" });
  });

  it("success returns the href and notice", async () => {
    const r = await draftProposalForStaff(args);
    expect(r).toMatchObject({ ok: true, href: "/dashboard/proposals/p1/" });
  });
});
