import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * "Draft from a transcript" from the proposals page (B5.6) and the lead page.
 * Both go through the same `draftProposalForStaff` as a pasted source; the
 * session, the lead-writing role, the module and the staff roles are re-checked
 * in the action, and the lead is read through the caller's scoped client.
 */

const LEAD = "11111111-1111-4111-8111-111111111111";
const TRANSCRIPT = "Rebecca: Thanks for joining. We recommend a word mark and a logo mark for Zephyr in the clothing class. ".repeat(4);
const VTT = `WEBVTT\n\n1\n00:00:01.000 --> 00:00:09.000\n${TRANSCRIPT}\n`;

type Opts = { role?: string; session?: "ok" | "none"; gate?: { error: string } | null; lead?: unknown };

async function setup(opts: Opts = {}) {
  const draft = vi.fn<(args: unknown) => Promise<{ ok: true; notice: string; href: string }>>(async () => ({ ok: true, notice: "Drafted.", href: "/dashboard/proposals/p1/" }));
  const gate = vi.fn(async () => (opts.gate === undefined ? null : opts.gate));
  const maybeSingle = vi.fn(async () => ({
    data: opts.lead === undefined ? { id: LEAD, first_name: "Ana", last_name: "Ruiz", email: "ana@example.com", business_name: "Zephyr" } : opts.lead,
    error: null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () =>
      opts.session === "none" ? { kind: "none" } : { kind: "ok", role: opts.role ?? "intake", org: { id: "org-1", name: "Firm", slug: "firm" }, user: { id: "user-1" } },
    ),
  }));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({ from })) }));
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ gateStaffAction: gate }));
  vi.doMock("@/lib/consult-proposal/staff-run", () => ({ draftProposalForStaff: draft }));
  return { draft, gate, from, eq, maybeSingle };
}

const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const proposalsAction = async () => (await import("../../src/app/dashboard/proposals/transcript-actions")).draftProposalFromUploadAction;
const leadAction = async () => (await import("../../src/app/dashboard/leads/[id]/proposal-actions")).draftProposalFromTranscriptAction;

describe("proposals-page action: draftProposalFromUploadAction", () => {
  beforeEach(() => vi.resetModules());

  it("calls draftProposalForStaff once, as a pasted source, for the chosen lead", async () => {
    const { draft, from, eq } = await setup();
    const result = await (await proposalsAction())({}, form({ leadId: LEAD, transcript: TRANSCRIPT }));
    expect(result).toEqual({ ok: true, notice: "Drafted.", href: "/dashboard/proposals/p1/" });
    expect(draft).toHaveBeenCalledTimes(1);
    const arg = draft.mock.calls[0][0] as { source: { kind: string; text: string }; lead: { id: string }; orgId: string; userId: string; matterId: null };
    expect(arg.source.kind).toBe("pasted");
    expect(arg.source.text).toBe(TRANSCRIPT.trim());
    expect(arg.lead).toMatchObject({ id: LEAD, firstName: "Ana", lastName: "Ruiz", businessName: "Zephyr" });
    expect(arg).toMatchObject({ orgId: "org-1", userId: "user-1", matterId: null });
    expect(from).toHaveBeenCalledWith("crm_lead");
    expect(eq).toHaveBeenCalledWith("id", LEAD);
  });

  it("an uploaded file wins over pasted text, and its text goes through as a pasted source", async () => {
    const { draft } = await setup();
    const file = new File([VTT], "call.vtt", { type: "text/vtt" });
    await (await proposalsAction())({}, form({ leadId: LEAD, transcript: "ignored ".repeat(60), file }));
    const arg = draft.mock.calls[0][0] as { source: { kind: string; text: string } };
    expect(arg.source.kind).toBe("pasted");
    expect(arg.source.text).toContain("Rebecca: Thanks for joining.");
    expect(arg.source.text).not.toContain("-->");
    expect(arg.source.text).not.toContain("ignored");
  });

  it("an empty file input falls back to the pasted text", async () => {
    const { draft } = await setup();
    await (await proposalsAction())({}, form({ leadId: LEAD, transcript: TRANSCRIPT, file: new File([], "") }));
    expect(draft).toHaveBeenCalledTimes(1);
  });

  it("a lead from another firm (not found through the scoped client) is 'Lead not found.'", async () => {
    const { draft } = await setup({ lead: null });
    expect(await (await proposalsAction())({}, form({ leadId: LEAD, transcript: TRANSCRIPT }))).toEqual({ error: "Lead not found." });
    expect(draft).not.toHaveBeenCalled();
  });

  it("a role outside CAN_WRITE_LEAD is refused and nothing is drafted", async () => {
    const { draft, from } = await setup({ role: "viewer" });
    const result = await (await proposalsAction())({}, form({ leadId: LEAD, transcript: TRANSCRIPT }));
    expect(result.error).toBeTruthy();
    expect(draft).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("no session is refused", async () => {
    const { draft } = await setup({ session: "none" });
    expect((await (await proposalsAction())({}, form({ leadId: LEAD, transcript: TRANSCRIPT }))).error).toBeTruthy();
    expect(draft).not.toHaveBeenCalled();
  });

  it("passes a refusal from gateStaffAction through, before anything else", async () => {
    const { draft, gate, from } = await setup({ gate: { error: "Your role can view proposals but not change them." } });
    expect(await (await proposalsAction())({}, form({ leadId: LEAD, transcript: TRANSCRIPT }))).toEqual({
      error: "Your role can view proposals but not change them.",
    });
    expect(gate).toHaveBeenCalledTimes(1);
    expect(draft).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses text under the 200-character minimum with a sentence", async () => {
    const { draft } = await setup();
    const result = await (await proposalsAction())({}, form({ leadId: LEAD, transcript: "Too short." }));
    expect(result.error).toMatch(/at least a few sentences/);
    expect(draft).not.toHaveBeenCalled();
  });

  it("refuses an upload type that isn't allowed, and a file with too little text", async () => {
    const { draft } = await setup();
    const act = await proposalsAction();
    const pdf = await act({}, form({ leadId: LEAD, file: new File(["%PDF-1.4"], "call.pdf") }));
    expect(pdf.error).toContain(".txt, .vtt, .srt or .docx");
    const tiny = await act({}, form({ leadId: LEAD, file: new File(["Rebecca: hi."], "call.txt") }));
    expect(tiny.error).toMatch(/too little text/);
    expect(draft).not.toHaveBeenCalled();
  });

  it("refuses a missing or malformed lead id before reading anything", async () => {
    const { draft, from } = await setup();
    expect((await (await proposalsAction())({}, form({ leadId: "nope", transcript: TRANSCRIPT }))).error).toBeTruthy();
    expect(draft).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("returns the drafter's own refusal", async () => {
    const { draft } = await setup();
    draft.mockResolvedValueOnce({ ok: false, error: "No approval queue is connected for your firm, so nothing was drafted." } as never);
    expect(await (await proposalsAction())({}, form({ leadId: LEAD, transcript: TRANSCRIPT }))).toEqual({
      error: "No approval queue is connected for your firm, so nothing was drafted.",
    });
  });

  it("the action file has no send or approve path", () => {
    const source = readFileSync("src/app/dashboard/proposals/transcript-actions.ts", "utf8");
    expect(source).not.toMatch(/sendProposal|resolveQueueItem/);
    expect(source).toMatch(/gateStaffAction\(\)/);
  });
});

describe("lead-page action: draftProposalFromTranscriptAction", () => {
  beforeEach(() => vi.resetModules());

  it("still drafts from pasted text", async () => {
    const { draft } = await setup();
    const result = await (await leadAction())({}, form({ leadId: LEAD, transcript: TRANSCRIPT }));
    expect(result.ok).toBe(true);
    expect(draft).toHaveBeenCalledTimes(1);
    expect((draft.mock.calls[0][0] as { source: { kind: string } }).source.kind).toBe("pasted");
  });

  it("has the same upload branch: a .srt file is cleaned and used, and wins over the box", async () => {
    const { draft } = await setup();
    const srt = `1\n00:00:01,000 --> 00:00:09,000\n${TRANSCRIPT}\n`;
    await (await leadAction())({}, form({ leadId: LEAD, transcript: "x".repeat(300), file: new File([srt], "call.srt") }));
    const text = (draft.mock.calls[0][0] as { source: { text: string } }).source.text;
    expect(text).toContain("Rebecca: Thanks for joining.");
    expect(text).not.toContain("-->");
    expect(text).not.toContain("xxxx");
  });

  it("refuses a disallowed file type and a short paste, and a lead from another firm", async () => {
    const a = await setup();
    const act = await leadAction();
    expect((await act({}, form({ leadId: LEAD, file: new File(["x"], "call.exe") }))).error).toContain(".txt, .vtt, .srt or .docx");
    expect((await act({}, form({ leadId: LEAD, transcript: "short" }))).error).toMatch(/at least a few sentences/);
    expect(a.draft).not.toHaveBeenCalled();
    vi.resetModules();
    const b = await setup({ lead: null });
    expect(await (await leadAction())({}, form({ leadId: LEAD, transcript: TRANSCRIPT }))).toEqual({ error: "Lead not found." });
    expect(b.draft).not.toHaveBeenCalled();
  });

  it("refuses a role outside CAN_WRITE_LEAD", async () => {
    const { draft } = await setup({ role: "viewer" });
    expect((await (await leadAction())({}, form({ leadId: LEAD, transcript: TRANSCRIPT }))).error).toBeTruthy();
    expect(draft).not.toHaveBeenCalled();
  });

  it("the form posts a file input as well as the textarea", () => {
    const source = readFileSync("src/components/leads/TranscriptFields.tsx", "utf8");
    expect(source).toContain('name="file"');
    expect(source).toContain('name="transcript"');
    expect(readFileSync("src/components/leads/ProposalFromTranscript.tsx", "utf8")).toContain("<TranscriptFields");
  });
});
