import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FlowResult } from "@/lib/proposals/paid-flow";

/**
 * Mark paid, Undo and Retry as server actions. Each is its own POST entry point, so each calls its
 * gate (the proposals module, then owner / admin / senior_admin / intake) before it reads or writes
 * anything. The flow behind them re-reads the proposal through the scoped client; that part is
 * tested in paid-flow.test.ts, so here it is a spy.
 */

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
const state = vi.hoisted(() => ({ modules: true, role: "owner" as string | null }));

const markProposalPaid = vi.fn<(id: string) => Promise<FlowResult>>();
const undoProposalPaid = vi.fn<(id: string) => Promise<FlowResult>>();
const retryProposalStep = vi.fn<(id: string, step: string) => Promise<FlowResult>>();
const orgHasModule = vi.fn(async () => state.modules);
const currentRole = vi.fn(async () => state.role);
const revalidatePath = vi.fn();

vi.mock("@/lib/org/modules", () => ({ orgHasModule }));
vi.mock("@/lib/auth/current-role", () => ({ currentRole }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
}));
vi.mock("@/lib/proposals/paid-flow", () => ({ markProposalPaid, undoProposalPaid, retryProposalStep }));

const { markPaidAction, undoPaidAction, retryUploadAction } = await import("../../src/app/dashboard/proposals/[id]/paid-actions");

const ID = "44444444-4444-4444-8444-444444444444";
const form = (extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("proposalId", ID);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
};
const ok = (over: Partial<Extract<FlowResult, { ok: true }>> = {}): FlowResult => ({ ok: true, reports: [], notes: [], ...over });

beforeEach(() => {
  vi.clearAllMocks();
  state.modules = true;
  state.role = "owner";
  markProposalPaid.mockResolvedValue(ok());
  undoProposalPaid.mockResolvedValue(ok({ notes: ["The engagement letter draft, if one was queued, stays in the approval queue."] }));
  retryProposalStep.mockResolvedValue(ok());
});

const ACTIONS = [
  ["markPaidAction", () => markPaidAction({}, form()), markProposalPaid],
  ["undoPaidAction", () => undoPaidAction({}, form()), undoProposalPaid],
  ["retryUploadAction", () => retryUploadAction({}, form({ step: "loe_draft" })), retryProposalStep],
] as const;

describe.each(ACTIONS)("%s: the gate comes first", (_name, run, flow) => {
  it.each(["owner", "admin", "senior_admin", "intake"])("lets a %s through", async (role) => {
    state.role = role;
    const r = await run();
    expect(r.error).toBeUndefined();
    expect(flow).toHaveBeenCalledTimes(1);
  });

  it.each(["paralegal", "attorney", "law_clerk", "clerk", "viewer", "social_media", "not-a-role"])(
    "refuses a %s with a visible sentence and writes nothing",
    async (role) => {
      state.role = role;
      const r = await run();
      expect(r).toEqual({ error: "Only owners, admins, senior admins and intake staff can mark a proposal paid or undo it." });
      expect(flow).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("refuses a signed-out caller (no resolvable role)", async () => {
    state.role = null;
    expect((await run()).error).toContain("Only owners");
    expect(flow).not.toHaveBeenCalled();
  });

  it("answers notFound() when the proposals module is off, before looking at the role", async () => {
    state.modules = false;
    await expect(run()).rejects.toBe(NOT_FOUND);
    expect(currentRole).not.toHaveBeenCalled();
    expect(flow).not.toHaveBeenCalled();
  });

  it("checks the module, then the role, then runs the flow", async () => {
    await run();
    expect(orgHasModule.mock.invocationCallOrder[0]).toBeLessThan(currentRole.mock.invocationCallOrder[0]);
    expect(currentRole.mock.invocationCallOrder[0]).toBeLessThan((flow as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
  });

  it("shows the flow's refusal as it is, and revalidates nothing for a refusal it was not given", async () => {
    (flow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: "Proposal not found." });
    expect(await run()).toEqual({ error: "Proposal not found." });
  });

  it("turns a thrown flow into a fixed sentence, never the error's text", async () => {
    (flow as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("relation client_proposal_event does not exist for sevetri@example.com"));
    const r = await run();
    expect(r.error).toBeTruthy();
    expect(r.error).not.toContain("sevetri@example.com");
    expect(r.error).not.toContain("relation");
  });
});

describe("markPaidAction", () => {
  it("passes the id from the form, revalidates the page and the list, and leads with 'Marked paid.'", async () => {
    markProposalPaid.mockResolvedValue(
      ok({
        reports: [
          { step: "loe_draft", outcome: "queued", reason: null, recorded: true },
          { step: "accepted_file_upload", outcome: "failed", reason: "HTTP 422", recorded: true },
        ],
      }),
    );
    const r = await markPaidAction({}, form());
    expect(markProposalPaid).toHaveBeenCalledWith(ID);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/proposals/${ID}/`);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/proposals/");
    expect(r.saved).toBe(true);
    expect(r.notice).toBe(
      "Marked paid. Engagement letter draft queued for approval. Not uploaded to Lawmatics: HTTP 422. The shape of this request hasn't been checked against a live account.",
    );
  });

  it("an already-paid click says so and does not claim a fresh mark", async () => {
    markProposalPaid.mockResolvedValue(ok({ alreadyPaid: true, notes: ["This proposal is already marked paid."] }));
    const r = await markPaidAction({}, form());
    expect(r.notice).toBe("This proposal is already marked paid.");
  });

  it("says when a step ran but its timeline line did not land", async () => {
    markProposalPaid.mockResolvedValue(ok({ reports: [{ step: "loe_draft", outcome: "queued", reason: null, recorded: false }] }));
    expect((await markPaidAction({}, form())).notice).toContain("couldn't be saved");
  });

  it("another firm's id, and every status that is not accepted, come back as the flow's sentence", async () => {
    markProposalPaid.mockResolvedValueOnce({ ok: false, error: "Proposal not found." });
    expect(await markPaidAction({}, form())).toEqual({ error: "Proposal not found." });
    markProposalPaid.mockResolvedValueOnce({ ok: false, error: "Only an accepted proposal can be marked paid." });
    expect(await markPaidAction({}, form())).toEqual({ error: "Only an accepted proposal can be marked paid." });
  });
});

describe("undoPaidAction", () => {
  it("confirms and says the queued engagement letter stays queued", async () => {
    const r = await undoPaidAction({}, form());
    expect(r).toEqual({ saved: true, notice: "Paid mark undone. The engagement letter draft, if one was queued, stays in the approval queue." });
    expect(undoProposalPaid).toHaveBeenCalledWith(ID);
  });

  it("is refused when the version isn't paid", async () => {
    undoProposalPaid.mockResolvedValueOnce({ ok: false, error: "This proposal isn't marked paid." });
    expect(await undoPaidAction({}, form())).toEqual({ error: "This proposal isn't marked paid." });
  });
});

describe("retryUploadAction", () => {
  it.each(["loe_draft", "accepted_file_upload", "custom_fields", "lawmatics_note", "loe_file_upload"])("runs %s again", async (step) => {
    await retryUploadAction({}, form({ step }));
    expect(retryProposalStep).toHaveBeenCalledWith(ID, step);
  });

  it.each(["paid_marked", "accept_notice", "", "rm -rf", "loe_draft;"])("refuses the unknown step %j without calling the flow", async (step) => {
    const r = await retryUploadAction({}, form({ step }));
    expect(r.error).toBe("That step can't be run again.");
    expect(retryProposalStep).not.toHaveBeenCalled();
  });
});
