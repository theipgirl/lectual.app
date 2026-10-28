import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DRAFT_EMAIL_SENTENCES, buildProposalEmail, runDraftClientEmail, type DraftEmailDeps, type DraftEmailProposal } from "@/lib/proposal-editor/draft-email";

const URL_ = "https://proposals.example.com/p/tok123/";
const proposal = (o: Partial<DraftEmailProposal> = {}): DraftEmailProposal => ({
  id: "p1",
  status: "sent",
  clientName: "Sevetri Wilson",
  firstName: "Sevetri",
  clientEmail: "sevetri@example.com",
  orgId: "org-1",
  publicToken: "tok123",
  matterId: null,
  leadId: "lead-9",
  ...o,
});

function deps(over: Partial<DraftEmailDeps> = {}, p: DraftEmailProposal | null = proposal()) {
  const createDraft = vi.fn(async (_input: unknown) => ({ id: "q-1" }));
  const d: DraftEmailDeps = {
    gate: async () => null,
    loadProposal: async () => p,
    firm: async () => ({ name: "Hartwell IP", signOff: "Best,\nHartwell IP" }),
    orgKey: async () => "org-key",
    pending: async () => ({ status: "ok", items: [] }),
    linkUrl: async () => URL_,
    createDraft,
    revalidate: vi.fn(),
    ...over,
  };
  return { d, createDraft };
}

describe("Draft email to client (F9)", () => {
  it("queues exactly one CLIENT_EMAIL draft containing the link", async () => {
    const { d, createDraft } = deps();
    const res = await runDraftClientEmail(d, "p1");
    expect(res).toEqual({ saved: true, notice: DRAFT_EMAIL_SENTENCES.queued });
    expect(createDraft).toHaveBeenCalledTimes(1);
    const input = createDraft.mock.calls[0][0] as unknown as { type: string; draftBody: string; recipient: string; leadId: string };
    expect(input.type).toBe("CLIENT_EMAIL");
    expect(input.draftBody).toContain(URL_);
    expect(input.recipient).toBe("sevetri@example.com");
    expect(input.leadId).toBe("lead-9");
  });

  it("works for an accepted version too, and refuses a draft or saved one", async () => {
    expect((await runDraftClientEmail(deps({}, proposal({ status: "accepted" })).d, "p1")).saved).toBe(true);
    for (const status of ["draft", "approved", "withdrawn"]) {
      const { d, createDraft } = deps({}, proposal({ status }));
      expect(await runDraftClientEmail(d, "p1")).toEqual({ error: DRAFT_EMAIL_SENTENCES.notLive });
      expect(createDraft).not.toHaveBeenCalled();
    }
  });

  it("a second click does not queue a duplicate when one is already pending", async () => {
    const pending: DraftEmailDeps["pending"] = async () => ({ status: "ok", items: [{ id: "q-1", type: "CLIENT_EMAIL", draftBody: `Hi\n\n${URL_}\n\nBest` }] });
    const { d, createDraft } = deps({ pending });
    const res = await runDraftClientEmail(d, "p1");
    expect(res).toEqual({ saved: true, notice: DRAFT_EMAIL_SENTENCES.alreadyQueued });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("an unconfigured or unreachable queue returns a fixed sentence and creates nothing", async () => {
    for (const [override, sentence] of [
      [{ orgKey: async () => null }, DRAFT_EMAIL_SENTENCES.noQueue],
      [{ pending: async () => ({ status: "unconfigured" as const }) }, DRAFT_EMAIL_SENTENCES.noQueue],
      [{ pending: async () => ({ status: "unavailable" as const }) }, DRAFT_EMAIL_SENTENCES.queueDown],
      [{ orgKey: async () => { throw new Error("boom secret"); } }, DRAFT_EMAIL_SENTENCES.queueDown],
    ] as const) {
      const { d, createDraft } = deps(override);
      const res = await runDraftClientEmail(d, "p1");
      expect(res).toEqual({ error: sentence });
      expect(createDraft).not.toHaveBeenCalled();
    }
  });

  it("a failing queue write says so without the raw error and does not claim it was queued", async () => {
    const { d } = deps({ createDraft: async () => { throw new Error("secret-token-123"); } });
    const res = await runDraftClientEmail(d, "p1");
    expect(res).toEqual({ error: DRAFT_EMAIL_SENTENCES.failed });
    expect(JSON.stringify(res)).not.toContain("secret");
  });

  it("returns the gate's refusal untouched", async () => {
    const { d, createDraft } = deps({ gate: async () => ({ error: "Your role can view proposals but not change them." }) });
    expect(await runDraftClientEmail(d, "p1")).toEqual({ error: "Your role can view proposals but not change them." });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("the email is facts and the link only", () => {
    const e = buildProposalEmail({ firstName: "Sevetri", firmName: "Hartwell IP", url: URL_ });
    expect(e.body).toContain("Hi Sevetri,");
    expect(e.body).toContain(URL_);
    expect(e.body).not.toMatch(/\$\d|guarantee|legal advice|we recommend/i);
    expect(buildProposalEmail({ firstName: null, firmName: "X", url: URL_ }).body).toMatch(/^Hello,/);
  });

  it("the module has no send call (grep)", () => {
    const src = readFileSync("src/lib/proposal-editor/draft-email.ts", "utf8");
    expect(src).not.toMatch(/sendMail|send_mail|sendEmail|\/send|resend|nodemailer|fetch\(/i);
    const action = readFileSync("src/app/dashboard/proposals/[id]/actions.ts", "utf8");
    expect(action).not.toMatch(/sendMail|sendEmail|nodemailer|Resend/);
  });
});
