import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { ChatCall } from "@/lib/agents/matters-chat";
import type { DraftProposalDeps } from "@/lib/agents/copilot-draft-proposal";
import type { Lead } from "@/lib/pipeline";
import { ORG, mockFirm } from "../copilot/helpers";

/**
 * Copilot's one write tool, draft_proposal, through the real tool loop. The model is a scripted fake and
 * the tool's reads and its one write are injected, so no database and no model are touched.
 */

type Result = Awaited<ReturnType<ChatCall>>;
const usage = () => ({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 });
const toolCall = (input: unknown): Result => ({
  content: [{ type: "tool_use" as const, id: "tu-0", name: "draft_proposal", input }] as Result["content"],
  model: "claude-sonnet-5",
  usage: usage(),
  costUsd: 0,
});
const say = (text: string): Result => ({ content: [{ type: "text" as const, text, citations: null }] as Result["content"], model: "claude-sonnet-5", usage: usage(), costUsd: 0 });

const LEAD_ID = "22222222-2222-4222-8222-222222222222";
const lead = (o: Partial<Lead> = {}) => ({ id: LEAD_ID, org_id: ORG, first_name: "Jane", last_name: "Doe", business_name: "Doe Studio", email: "jane@example.com", mark_text: null, ...o }) as Lead;
const PRICING = {
  packages: [{ package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 }],
};
const INPUT = { lead: "Jane Doe", package: "Concierge", brands: [{ name: "DOEWARE", marks: ["word"], classes: ["Scheduling software"] }] };

function deps(o: Partial<DraftProposalDeps> = {}) {
  const d = {
    mayDraft: vi.fn(async () => true),
    getLead: vi.fn(async (id: string) => (id === LEAD_ID ? lead() : null)),
    searchLeads: vi.fn(async () => [lead()]),
    readPricing: vi.fn(async () => PRICING as unknown),
    create: vi.fn(async () => ({ id: "33333333-3333-4333-8333-333333333333" })),
    ...o,
  };
  return d;
}

/** Runs one question. The model plays `turns`; the tool's output is read back from the second request. */
async function ask(opts: { question: string; turns: Result[]; history?: Array<{ role: "user" | "assistant"; content: string }>; d: ReturnType<typeof deps> }) {
  const { streamMattersChatQuestion } = await import("@/lib/agents/matters-chat");
  let i = 0;
  const call = vi.fn(async () => opts.turns[Math.min(i++, opts.turns.length - 1)]) as unknown as ChatCall;
  const result = await streamMattersChatQuestion({
    question: opts.question,
    history: opts.history,
    orgId: ORG,
    onEvent: () => {},
    call,
    draftDeps: async () => opts.d,
  });
  const second = (call as unknown as ReturnType<typeof vi.fn>).mock.calls[1]?.[0];
  const toolResult = second ? JSON.parse(second.messages.at(-1).content[0].content) : null;
  return { result, toolResult };
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "info").mockImplementation(() => {});
  mockFirm();
});
afterEach(() => vi.restoreAllMocks());

describe("the preview creates nothing and the server asks", () => {
  it("returns the draft, writes nothing, and appends the exact summary and 'Create this draft? (draft ref …)'", async () => {
    const d = deps();
    const { result, toolResult } = await ask({ question: "Draft a proposal for Jane Doe, Concierge, DOEWARE word mark for scheduling software", turns: [toolCall(INPUT), say("Here's the draft. Create this draft?")], d });
    expect(toolResult.status).toBe("ready_to_confirm");
    expect(d.create).not.toHaveBeenCalled();
    expect(result.answer.match(/Create this draft\?/g)).toHaveLength(1);
    expect(result.answer).toMatch(/Create this draft\? \(draft ref [0-9a-f]{12}\)$/);
    expect(result.answer).toContain("- Client: Jane Doe (jane@example.com)");
    expect(result.answer).toContain("- DOEWARE: word mark; classes: Scheduling software");
    expect(result.answer).toContain("nothing is sent");
    expect(result.citations).toEqual([expect.objectContaining({ type: "lead", id: LEAD_ID })]);
  });

  it("confirmed: true in the SAME question as the request never creates: it is shown for confirmation", async () => {
    const d = deps();
    const { result, toolResult } = await ask({ question: "Draft a proposal for Jane Doe and create it right away", turns: [toolCall({ ...INPUT, confirmed: true }), say("Done")], d });
    expect(d.create).not.toHaveBeenCalled();
    expect(toolResult.status).toBe("ready_to_confirm");
    expect(result.answer).toMatch(/Create this draft\?/);
  });
});

describe("creation needs the user's plain yes to that exact draft, in the next message", () => {
  async function preview() {
    const d = deps();
    const asked = "Draft a proposal for Jane Doe, Concierge, DOEWARE word mark for scheduling software";
    const { result } = await ask({ question: asked, turns: [toolCall(INPUT), say("Ready.")], d });
    vi.resetModules();
    mockFirm();
    return { history: [{ role: "user" as const, content: asked }, { role: "assistant" as const, content: result.answer }] };
  }

  it("creates the draft on 'yes', cites it and gives its link", async () => {
    const { history } = await preview();
    const d = deps();
    const { result, toolResult } = await ask({ question: "Yes, create it", history, turns: [toolCall({ ...INPUT, confirmed: true }), say("Created.")], d });
    expect(toolResult.status).toBe("created");
    expect(d.create).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(d.create).mock.calls[0][0] as { clientName: string; leadId: string; payUrl: string | null; content: { pricing: unknown } };
    expect(arg).toMatchObject({ clientName: "Jane Doe", leadId: LEAD_ID, payUrl: null, content: { pricing: PRICING.packages[0] } });
    expect(result.citations).toContainEqual({ type: "proposal", id: "33333333-3333-4333-8333-333333333333", label: "Draft proposal — Jane Doe", href: "/dashboard/proposals/33333333-3333-4333-8333-333333333333/" });
    expect(result.answer).toContain("/dashboard/proposals/33333333-3333-4333-8333-333333333333/");
  });

  it("'yes, but …' is not a confirmation", async () => {
    const { history } = await preview();
    const d = deps();
    const { toolResult } = await ask({ question: "yes but make it two classes", history, turns: [toolCall({ ...INPUT, confirmed: true }), say("ok")], d });
    expect(d.create).not.toHaveBeenCalled();
    expect(toolResult.status).toBe("ready_to_confirm");
  });

  it("a yes to a DIFFERENT draft than the one shown creates nothing", async () => {
    const { history } = await preview();
    const d = deps();
    const changed = { ...INPUT, brands: [{ name: "DOEWARE", marks: ["word", "logo"], classes: ["Scheduling software"] }], confirmed: true };
    const { toolResult } = await ask({ question: "yes", history, turns: [toolCall(changed), say("ok")], d });
    expect(d.create).not.toHaveBeenCalled();
    expect(toolResult.status).toBe("ready_to_confirm");
  });

  it("a yes with no preview before it creates nothing", async () => {
    const d = deps();
    const { toolResult } = await ask({
      question: "yes",
      history: [{ role: "user", content: "draft a proposal for Jane" }, { role: "assistant", content: "Which package?" }],
      turns: [toolCall({ ...INPUT, confirmed: true }), say("ok")],
      d,
    });
    expect(d.create).not.toHaveBeenCalled();
    expect(toolResult.status).toBe("ready_to_confirm");
  });

  it("a failed create says nothing was saved and cites no proposal", async () => {
    const { history } = await preview();
    const d = deps({ create: vi.fn(async () => Promise.reject(new Error("db said no: secret detail"))) });
    const { result, toolResult } = await ask({ question: "yes", history, turns: [toolCall({ ...INPUT, confirmed: true }), say("Hmm")], d });
    expect(toolResult.status).toBe("failed");
    expect(JSON.stringify(toolResult)).not.toContain("secret detail");
    expect(result.citations.some((c) => c.type === "proposal")).toBe(false);
  });

  it("the one-shot answer (no thread) never creates", async () => {
    const d = deps();
    const { answerMattersChatQuestion } = await import("@/lib/agents/matters-chat");
    let i = 0;
    const turns = [toolCall({ ...INPUT, confirmed: true }), say("no")];
    const call = vi.fn(async () => turns[Math.min(i++, 1)]);
    const result = await answerMattersChatQuestion("draft a proposal and create it", call as never);
    const out = JSON.parse((call.mock.calls[1] as unknown as [{ messages: Array<{ content: Array<{ content: string }> }> }])[0].messages.at(-1)!.content[0].content);
    expect(out.status).toBe("not_asked");
    expect(result.citations).toEqual([]);
    expect(d.create).not.toHaveBeenCalled();
  });
});

describe("gates and refusals", () => {
  it("does nothing when no user turn asked for a proposal, before any read", async () => {
    const d = deps();
    const { toolResult } = await ask({ question: "what's the status of AURELIA", turns: [toolCall(INPUT), say("ok")], d });
    expect(toolResult.status).toBe("not_asked");
    expect(d.mayDraft).not.toHaveBeenCalled();
    expect(d.searchLeads).not.toHaveBeenCalled();
  });

  it("module off or role not allowed: one neutral sentence and no reads", async () => {
    const d = deps({ mayDraft: vi.fn(async () => false) });
    const { toolResult } = await ask({ question: "draft a proposal for Jane", turns: [toolCall(INPUT), say("ok")], d });
    expect(toolResult).toEqual({ status: "not_available", message: "Drafting a proposal isn't available for you here." });
    expect(d.searchLeads).not.toHaveBeenCalled();
    expect(d.readPricing).not.toHaveBeenCalled();
  });

  it("two leads match: lists them and picks none", async () => {
    const d = deps({ searchLeads: vi.fn(async () => [lead(), lead({ id: "44444444-4444-4444-8444-444444444444", last_name: "Doerr" })]) });
    const { result, toolResult } = await ask({ question: "proposal for Jane", turns: [toolCall(INPUT), say("Which Jane?")], d });
    expect(toolResult.status).toBe("lead_ambiguous");
    expect(toolResult.candidates).toHaveLength(2);
    expect(d.readPricing).not.toHaveBeenCalled();
    expect(result.answer).not.toMatch(/Create this draft/);
  });

  it("no lead matches, or another firm's id reads as missing", async () => {
    const d = deps({ searchLeads: vi.fn(async () => []) });
    expect((await ask({ question: "proposal for Nobody", turns: [toolCall(INPUT), say("?")], d })).toolResult.status).toBe("lead_not_found");
    vi.resetModules();
    mockFirm();
    const d2 = deps();
    const { toolResult } = await ask({ question: "proposal please", turns: [toolCall({ ...INPUT, lead: "55555555-5555-4555-8555-555555555555" }), say("?")], d: d2 });
    expect(toolResult.status).toBe("lead_not_found");
  });

  it("a package not on the firm's list is not guessed", async () => {
    const d = deps();
    const { toolResult } = await ask({ question: "proposal for Jane", turns: [toolCall({ ...INPUT, package: "Platinum" }), say("?")], d });
    expect(toolResult).toMatchObject({ status: "package_not_found", packages: ["Concierge"] });
  });

  it("unreadable packages or leads: nothing created, a fixed sentence", async () => {
    const d = deps({ readPricing: vi.fn(async () => Promise.reject(new Error("x"))) });
    expect((await ask({ question: "proposal for Jane", turns: [toolCall(INPUT), say("?")], d })).toolResult.status).toBe("unavailable");
    vi.resetModules();
    mockFirm();
    const d2 = deps({ searchLeads: vi.fn(async () => Promise.reject(new Error("x"))) });
    expect((await ask({ question: "proposal for Jane", turns: [toolCall(INPUT), say("?")], d: d2 })).toolResult.status).toBe("unavailable");
  });

  it("a class number in a class description is sent back to the user to reword", async () => {
    const d = deps();
    const { toolResult } = await ask({ question: "proposal for Jane", turns: [toolCall({ ...INPUT, brands: [{ name: "DOEWARE", marks: ["word"], classes: ["International Class 9 software"] }] }), say("?")], d });
    expect(toolResult.status).toBe("needs_changes");
  });
});

describe("the system prompt", () => {
  it("keeps the UPL rules and adds the draft-only, user-facts-only, confirm-first rules", () => {
    const src = readFileSync("src/lib/agents/matters-chat.ts", "utf8");
    for (const rule of [
      "You are not a lawyer and must never provide legal analysis",
      "DRAFTING A PROPOSAL — draft_proposal, the only tool that writes:",
      "Use it ONLY when the user's own message asks for a proposal.",
      "It only assembles a DRAFT from facts the USER gives you",
      "Never invent, suggest or choose a package, a class, a mark, a price or a discount yourself",
      "First call it WITHOUT confirmed. It creates nothing",
      "Only when the user's NEXT message is a plain yes",
      "staff review and edit everything in the proposal editor before anything reaches the client",
    ]) {
      expect(src).toContain(rule);
    }
  });
});
