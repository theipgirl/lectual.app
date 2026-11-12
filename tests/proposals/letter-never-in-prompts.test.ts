import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { newDraftSink, runDraftProposal, type DraftProposalDeps } from "@/lib/agents/copilot-draft-proposal";
import { runConsultProposal, type ConsultProposalRunInput } from "@/lib/consult-proposal/run";
import { confirmationContext } from "@/lib/copilot/draft-proposal";
import type { ApprovedRead } from "@/lib/loe/templates-store";
import type { Lead } from "@/lib/pipeline";
import { LETTER_CHECK_PATH, LETTER_NOT_ATTACHED_CHECK, attachFirmLetter, withoutLetterCheck } from "@/lib/proposals/attach-letter";
import { buildChecklist } from "@/lib/proposal-editor/checklist";
import { publicContent } from "@/lib/proposals/public";
import type { ProposalContent } from "@/lib/proposals/types";
import { validateContent } from "@/lib/proposals/validate";
import { NOW, ORG, assertOrgFenced, fakeLlm, writes } from "../agents/helpers";
import { fakeAdmin, filterValue, type Handler, type Recorded } from "../mailbox/fake-db";
import { sevetri } from "./fixture";
import { faithe } from "./general-fixture";

/**
 * Review item 1. Every way of starting a proposal attaches the firm's approved engagement letter by default. The two that
 * involve a model (the consult assistant, Copilot) attach it AFTER the model's work, in the run / executor layer, so the
 * letter's text never enters a prompt, a tool result, the queued email or a log. A letter read that fails still makes the
 * draft, and the draft says so in the editor's checklist.
 */

/** A string that appears nowhere else: if it shows up in anything a model was given, the letter leaked. */
const MARKER = "LETTER-BODY-MARKER-7f3a91";
const LETTER = { id: "11111111-1111-4111-8111-111111111111", kind: "trademark" as const, version: 3, title: `Engagement letter ${MARKER}-TITLE`, body: `Dear {{client_name}},\n\n${MARKER} This letter confirms our engagement.\n\nSigned {{signed_date}}.` };
const GENERAL_LETTER = { ...LETTER, id: "22222222-2222-4222-8222-222222222222", kind: "general" as const };
const ok = (letter: typeof LETTER | typeof GENERAL_LETTER | null): ApprovedRead => ({ status: "ok", letter });

/* ─────────────────────────── the helper ─────────────────────────── */

describe("attachFirmLetter", () => {
  it("attaches the firm's approved letter of the proposal's kind, exactly as the from-scratch door's builder does", () => {
    const r = attachFirmLetter(sevetri(), ok(LETTER), "assistant");
    expect(r.letter).toBe("attached");
    expect(r.content.loe).toEqual({ kind: "trademark", template_id: LETTER.id, template_version: 3, title: LETTER.title, body: LETTER.body });
    expect(r.content.checks ?? []).toEqual([]);
    expect(validateContent(r.content).filter((i) => i.level === "error")).toEqual([]);
    // The client reads the title and the text; the template id and version stay staff-side.
    expect(publicContent(r.content).loe).toEqual({ kind: "trademark", title: LETTER.title, body: LETTER.body });
  });

  it("a flat-fee draft takes the flat-fee letter", () => {
    const r = attachFirmLetter(faithe(), ok(GENERAL_LETTER), "copilot");
    expect(r.letter).toBe("attached");
    expect(r.content.loe?.kind).toBe("general");
  });

  it("no approved letter, no letter table yet, or a letter of the other kind: nothing attached and nothing to check", () => {
    for (const read of [ok(null), { status: "not-set-up" } as ApprovedRead, ok(GENERAL_LETTER)]) {
      const r = attachFirmLetter(sevetri(), read, "assistant");
      expect(r.letter).toBe("none");
      expect("loe" in r.content).toBe(false);
      expect(r.content.checks).toBeUndefined();
    }
  });

  it("a FAILED read never passes silently: no letter, and a check that says so, first in the list", () => {
    const base: ProposalContent = { ...sevetri(), checks: [{ text: "A credit was applied. Check it.", source: "consult", path: "adjustments[0]" }] };
    const r = attachFirmLetter(base, { status: "unavailable" }, "assistant");
    expect(r.letter).toBe("unreadable");
    expect("loe" in r.content).toBe(false);
    expect(r.content.checks).toEqual([
      { text: LETTER_NOT_ATTACHED_CHECK, source: "assistant", path: LETTER_CHECK_PATH },
      { text: "A credit was applied. Check it.", source: "consult", path: "adjustments[0]" },
    ]);
    expect(validateContent(r.content).filter((i) => i.level === "error")).toEqual([]);
    expect(LETTER_NOT_ATTACHED_CHECK.length).toBeLessThanOrEqual(300);
    // The words match what a person at the keyboard is told by the from-scratch door.
    expect(LETTER_NOT_ATTACHED_CHECK).toMatch(/^Couldn't read your engagement letter/);
    const scratch = readFileSync(join(process.cwd(), "src/app/dashboard/proposals/actions.ts"), "utf8");
    expect(scratch).toContain("Couldn't read your engagement letter, so nothing was created.");
  });

  it("the check is drawn in the editor's Ready to send? list as a Check linked to the Engagement letter section", () => {
    const r = attachFirmLetter(sevetri(), { status: "unavailable" }, "copilot");
    const list = buildChecklist([], r.content);
    expect(list).toEqual([{ level: "check", text: LETTER_NOT_ATTACHED_CHECK, where: "engagement letter", href: "#pe-sec-letter" }]);
    const slot = readFileSync(join(process.cwd(), "src/components/proposal-editor/EngagementLetterSlot.tsx"), "utf8");
    expect(slot).toContain('id="pe-sec-letter"');
  });

  it("a letter that a proposal cannot carry (an unknown merge field) is treated like a failed read: not attached, checked", () => {
    const r = attachFirmLetter(sevetri(), ok({ ...LETTER, body: "Dear {{nope}}," }), "assistant");
    expect(r.letter).toBe("unreadable");
    expect("loe" in r.content).toBe(false);
    expect(r.content.checks?.[0].path).toBe(LETTER_CHECK_PATH);
  });

  it("keeps the list within its cap of 12 and never repeats itself", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ text: `Check ${i}`, source: "consult" as const, path: "pay_url" }));
    const r = attachFirmLetter({ ...sevetri(), checks: twelve }, { status: "unavailable" }, "assistant");
    expect(r.content.checks).toHaveLength(12);
    expect(r.content.checks?.[0].path).toBe(LETTER_CHECK_PATH);
    const again = attachFirmLetter(r.content, { status: "unavailable" }, "assistant");
    expect(again.content.checks?.filter((c) => c.path === LETTER_CHECK_PATH)).toHaveLength(1);
    expect(validateContent(again.content).filter((i) => i.level === "error")).toEqual([]);
  });

  it("never mutates what it was given", () => {
    const before = sevetri();
    const frozen = JSON.stringify(before);
    attachFirmLetter(before, ok(LETTER), "assistant");
    attachFirmLetter(before, { status: "unavailable" }, "assistant");
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it("withoutLetterCheck removes only that check (the editor's Save calls it once a person has chosen)", () => {
    const withBoth: ProposalContent = { ...sevetri(), checks: [{ text: LETTER_NOT_ATTACHED_CHECK, source: "assistant", path: "loe" }, { text: "Other", source: "consult", path: "pay_url" }] };
    expect(withoutLetterCheck(withBoth).checks).toEqual([{ text: "Other", source: "consult", path: "pay_url" }]);
    expect("checks" in withoutLetterCheck({ ...sevetri(), checks: [{ text: LETTER_NOT_ATTACHED_CHECK, source: "assistant", path: "loe" }] })).toBe(false);
    const plain = sevetri();
    expect(withoutLetterCheck(plain)).toBe(plain);
  });
});

/* ─────────────────────────── the consult assistant ─────────────────────────── */

const TRANSCRIPT = [
  "Rebecca: Thanks for joining, Sevetri. Based on what you've told me I'd file the word mark for Prosperall and the logo too.",
  "Sevetri: Great, that sounds right to me.",
  "Rebecca: For Prosperall the right category is cloud based software as a service, so I'd cover that class.",
  "Sevetri: Please send me the proposal and I'll look at it tonight. ".repeat(3),
].join("\n");

const EXTRACT = {
  is_trademark_matter: true,
  recommendation_found: true,
  brands: [
    {
      name: "Prosperall",
      what: "Your company name",
      note_from_attorney: null,
      marks: [
        { kind: "word", preselected: true, why_quote: "I'd file the word mark for Prosperall and the logo too" },
        { kind: "logo", preselected: true, why_quote: "I'd file the word mark for Prosperall and the logo too" },
      ],
      classes: [{ label: "Cloud-Based Software as a Service (SaaS)", preselected: true, why_quote: "the right category is cloud based software as a service" }],
    },
  ],
  recommended_package: "Concierge",
  second_mark_discount: null,
  reduced_package: null,
  price_changes: [],
  credits: [],
  recommendation_summary: "Rebecca recommended word and logo marks for Prosperall.",
  reasoning_parts: { principle: true, risk_brand: null, risk_quote: null, fallback_brand: null, fallback_quote: null },
};

type LetterAnswer = "approved" | "none" | "fails" | "throws";

function consultSetup(letter: LetterAnswer) {
  /** The order things happened in: every model call and the letter read. */
  const order: string[] = [];
  const handler: Handler = (q: Recorded) => {
    if (q.table === "client_proposal_loe_template") {
      order.push("letter-read");
      if (letter === "throws") throw new Error("connection reset");
      if (letter === "fails") return { data: null, error: { message: "boom", code: "XX000" } };
      return { data: letter === "approved" ? [{ ...LETTER, status: "approved", updated_at: "2026-11-01T00:00:00Z", approved_at: "2026-11-01T00:00:00Z" }] : [], error: null };
    }
    if (q.table === "crm_activity" && q.action === "select") return { data: [], error: null };
    if (q.table === "client_proposal" && q.action === "select") return { data: [], error: null };
    if (q.table === "crm_activity" && q.action === "insert") return { data: null, error: null };
    if (q.table === "client_proposal_setting") return { data: { approver_user_ids: ["rebecca"], pricing: {} }, error: null };
    if (q.table === "crm_org") return { data: { name: "RPB Law", slug: "rpb-law" }, error: null };
    if (q.table === "crm_org_profile") return { data: { time_zone: "America/New_York" }, error: null };
    if (q.table === "client_proposal" && q.action === "insert") return { data: { ...(q.values as object), public_token: "T".repeat(43) }, error: null };
    return undefined;
  };
  const db = fakeAdmin(handler);
  const admin = fakeAdmin(() => undefined);
  const fake = fakeLlm(EXTRACT);
  const llm: typeof fake.llm = (async (req: Parameters<typeof fake.llm>[0]) => {
    order.push("model");
    return fake.llm(req);
  }) as typeof fake.llm;
  const createDraft = vi.fn<(input: unknown) => Promise<{ id: string }>>(async () => ({ id: "q-1" }));
  const input: ConsultProposalRunInput = {
    db: db.client as unknown as SupabaseClient,
    admin: admin.client as unknown as SupabaseClient,
    orgId: ORG,
    actorUserId: "user-1",
    source: { kind: "pasted", text: TRANSCRIPT },
    lead: { id: "lead-1", firstName: "Sevetri", lastName: "Wilson", email: "sevetri@example.com", businessName: "Prosperall" },
    matterId: null,
    llm,
    createDraft,
    queueOrgKey: "firm-queue-key",
    origin: "https://app.example.com",
    now: () => NOW,
  };
  return { input, db, admin, calls: fake.calls, createDraft, order };
}

afterEach(() => vi.restoreAllMocks());

describe("the consult assistant's draft", () => {
  it("carries the firm's approved letter, and not one character of it reached the model, the email, the queue item, the evidence event or a log", async () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const t = consultSetup("approved");
    const r = await runConsultProposal(t.input);
    expect(r.ok, r.ok ? "" : r.message).toBe(true);

    // The inserted draft has the letter, attached by default.
    const [ins] = writes(t.db.log, "client_proposal", "insert");
    const content = (ins.values as { content: ProposalContent }).content;
    expect(content.loe).toEqual({ kind: "trademark", template_id: LETTER.id, template_version: 3, title: LETTER.title, body: LETTER.body });
    expect(content.made_by).toBe("assistant");
    expect((content.checks ?? []).some((c) => c.path === LETTER_CHECK_PATH)).toBe(false);
    expect(validateContent(content).filter((i) => i.level === "error" && i.path.startsWith("loe"))).toEqual([]);

    // The model was asked at least once, and nothing it was given holds the letter.
    expect(t.calls.length).toBeGreaterThan(0);
    for (const c of t.calls) {
      expect(c.system).not.toContain(MARKER);
      expect(c.user).not.toContain(MARKER);
    }
    // The letter was read only AFTER the model's last call.
    expect(t.order.filter((o) => o === "letter-read")).toHaveLength(1);
    expect(t.order.lastIndexOf("model")).toBeLessThan(t.order.indexOf("letter-read"));

    // Nothing else that leaves the insert carries it.
    expect(JSON.stringify(t.createDraft.mock.calls)).not.toContain(MARKER);
    expect(JSON.stringify(writes(t.admin.log, "client_proposal_event", "insert"))).not.toContain(MARKER);
    expect(JSON.stringify(writes(t.db.log, "crm_activity", "insert"))).not.toContain(MARKER);
    for (const s of logs) expect(JSON.stringify(s.mock.calls)).not.toContain(MARKER);
  });

  it("reads the firm's letter fenced on the firm (the run may be on the service role), by kind and approved status", async () => {
    const t = consultSetup("approved");
    await runConsultProposal(t.input);
    const [read] = t.db.log.filter((q) => q.table === "client_proposal_loe_template");
    expect(read.action).toBe("select");
    expect(filterValue(read, "org_id")).toBe(ORG);
    expect(filterValue(read, "kind")).toBe("trademark");
    expect(filterValue(read, "status")).toBe("approved");
    assertOrgFenced(t.db.log);
  });

  it("a firm with no approved letter gets a draft with no letter and nothing to check about it", async () => {
    const t = consultSetup("none");
    expect((await runConsultProposal(t.input)).ok).toBe(true);
    const content = (writes(t.db.log, "client_proposal", "insert")[0].values as { content: ProposalContent }).content;
    expect("loe" in content).toBe(false);
    expect((content.checks ?? []).some((c) => c.path === LETTER_CHECK_PATH)).toBe(false);
    expect(String((t.createDraft.mock.calls[0] as unknown as [{ summary: string }])[0].summary)).not.toContain("engagement letter");
  });

  for (const how of ["fails", "throws"] as const) {
    it(`a letter read that ${how}: the draft is STILL created, with a Check in its checklist and a CHECK FIRST for the reviewer`, async () => {
      const t = consultSetup(how);
      const r = await runConsultProposal(t.input);
      expect(r.ok, r.ok ? "" : r.message).toBe(true);
      const content = (writes(t.db.log, "client_proposal", "insert")[0].values as { content: ProposalContent }).content;
      expect("loe" in content).toBe(false);
      expect(content.checks?.[0]).toEqual({ text: LETTER_NOT_ATTACHED_CHECK, source: "assistant", path: LETTER_CHECK_PATH });
      // The editor draws it.
      expect(buildChecklist([], content).some((i) => i.level === "check" && i.text === LETTER_NOT_ATTACHED_CHECK && i.href === "#pe-sec-letter")).toBe(true);
      // The reviewer's notes say it first, on the queue item and on the evidence event.
      const queued = (t.createDraft.mock.calls[0] as unknown as [{ summary: string }])[0];
      expect(queued.summary.startsWith(`CHECK FIRST: ${LETTER_NOT_ATTACHED_CHECK}`)).toBe(true);
      const [ev] = writes(t.admin.log, "client_proposal_event", "insert");
      expect((ev.values as { payload: { notes: string } }).payload.notes.startsWith(`CHECK FIRST: ${LETTER_NOT_ATTACHED_CHECK}`)).toBe(true);
    });
  }
});

/* ─────────────────────────── Copilot ─────────────────────────── */

const LEAD_ID = "33333333-3333-4333-8333-333333333333";
const lead = (): Lead => ({ id: LEAD_ID, org_id: ORG, first_name: "Jane", last_name: "Doe", business_name: "Doe Studio", email: "jane@example.com", mark_text: null }) as unknown as Lead;
const PRICING = { packages: [{ package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 }] };
const REQUEST = { lead: "Jane Doe", package: "Concierge", brands: [{ name: "DOEWARE", marks: ["word"], classes: ["Scheduling software"] }], payLink: "https://pay.example.com/x" };
const FLAT_FEE = { lead: "Jane Doe", payLink: "https://pay.example.com/x", matter: { title: "Contractor agreement", items: [{ label: "Draft the agreement", hours: 2, hourlyRate: 500 }], fee: 750 } };
const ASK = "Draft a proposal for Jane Doe";

function copilotDeps(read: ApprovedRead | "throws") {
  const create = vi.fn<(input: { content: ProposalContent }) => Promise<{ id: string }>>(async () => ({ id: "44444444-4444-4444-8444-444444444444" }));
  const readLetter = vi.fn(async (kind: "trademark" | "general"): Promise<ApprovedRead> => {
    if (read === "throws") throw new Error("no session");
    return read.status === "ok" && read.letter && read.letter.kind !== kind ? { status: "ok", letter: null } : read;
  });
  const d: DraftProposalDeps = { mayDraft: async () => true, getLead: async () => lead(), searchLeads: async () => [lead()], readPricing: async () => PRICING, readLetter, create };
  return { d, create, readLetter };
}

async function call(input: unknown, question: string, history: Array<{ role: "user" | "assistant"; content: string }>, d: DraftProposalDeps) {
  const sink = newDraftSink();
  const out = await runDraftProposal(input, { confirm: confirmationContext(ORG, question, history), sink, deps: async () => d, leadSearchTerm: (q) => q, citeLead: () => {}, citeProposal: () => {} });
  return { out, sink };
}

/** Preview, then a plain yes: returns both tool results (what goes back to the model) and what was inserted. */
async function previewThenYes(request: Record<string, unknown>, read: ApprovedRead | "throws") {
  const t = copilotDeps(read);
  const shown = await call(request, ASK, [], t.d);
  const readsAtPreview = t.readLetter.mock.calls.length;
  const ref = shown.sink.pending!.ref;
  const history = [{ role: "user" as const, content: ASK }, { role: "assistant" as const, content: `Ready.\n\nCreate this draft? (draft ref ${ref})` }];
  const done = await call({ ...request, confirmed: true }, "yes", history, t.d);
  return { ...t, shown, done, readsAtPreview };
}

describe("Copilot's draft", () => {
  it("the preview reads no letter and the tool result holds none of it", async () => {
    const t = await previewThenYes(REQUEST, ok(LETTER));
    expect(t.shown.out.status).toBe("ready_to_confirm");
    expect(t.readsAtPreview).toBe(0);
    expect(JSON.stringify(t.shown.out)).not.toContain(MARKER);
    expect(JSON.stringify(t.shown.sink)).not.toContain(MARKER);
  });

  it("after the user's yes the created draft carries the firm's letter, and the tool result that goes back to the model still holds none of it", async () => {
    const t = await previewThenYes(REQUEST, ok(LETTER));
    expect(t.done.out.status).toBe("created");
    expect(t.readLetter).toHaveBeenCalledTimes(1);
    expect(t.readLetter).toHaveBeenCalledWith("trademark");
    expect(t.create).toHaveBeenCalledTimes(1);
    const content = t.create.mock.calls[0][0].content;
    expect(content.loe).toEqual({ kind: "trademark", template_id: LETTER.id, template_version: 3, title: LETTER.title, body: LETTER.body });
    expect(content.made_by).toBe("copilot");
    expect(validateContent(content).filter((i) => i.level === "error")).toEqual([]);
    expect(JSON.stringify(t.done.out)).not.toContain(MARKER);
    expect(JSON.stringify(t.done.sink)).not.toContain(MARKER);
    expect(Object.keys(t.done.out)).not.toContain("content");
  });

  it("a flat-fee request asks for the flat-fee letter", async () => {
    const t = await previewThenYes(FLAT_FEE, ok(GENERAL_LETTER));
    expect(t.done.out.status).toBe("created");
    expect(t.readLetter).toHaveBeenCalledWith("general");
    expect(t.create.mock.calls[0][0].content.loe?.kind).toBe("general");
    expect(JSON.stringify(t.done.out)).not.toContain(MARKER);
  });

  it("a firm with no approved letter: a draft with no letter and no check about it", async () => {
    const t = await previewThenYes(REQUEST, ok(null));
    const content = t.create.mock.calls[0][0].content;
    expect("loe" in content).toBe(false);
    expect((content.checks ?? []).some((c) => c.path === LETTER_CHECK_PATH)).toBe(false);
    expect(t.done.out.issuesToFixInEditor).not.toContain(LETTER_NOT_ATTACHED_CHECK);
  });

  for (const read of [{ status: "unavailable" } as ApprovedRead, "throws" as const]) {
    it(`a letter read that ${read === "throws" ? "throws" : "fails"}: the draft is STILL created, with the Check, and Copilot is told in fixed words`, async () => {
      const t = await previewThenYes(REQUEST, read);
      expect(t.done.out.status).toBe("created");
      expect(t.create).toHaveBeenCalledTimes(1);
      const content = t.create.mock.calls[0][0].content;
      expect("loe" in content).toBe(false);
      expect(content.checks?.[0]).toEqual({ text: LETTER_NOT_ATTACHED_CHECK, source: "copilot", path: LETTER_CHECK_PATH });
      expect(buildChecklist([], content)[0]).toEqual({ level: "check", text: LETTER_NOT_ATTACHED_CHECK, where: "engagement letter", href: "#pe-sec-letter" });
      expect(t.done.out.issuesToFixInEditor).toContain(LETTER_NOT_ATTACHED_CHECK);
    });
  }

  it("an executor wired without a letter reader fails safe: the draft carries the check, never a silent letterless draft", async () => {
    const t = copilotDeps(ok(LETTER));
    const d = { ...t.d, readLetter: undefined } as unknown as DraftProposalDeps;
    const shown = await call(REQUEST, ASK, [], d);
    const history = [{ role: "user" as const, content: ASK }, { role: "assistant" as const, content: `Create this draft? (draft ref ${shown.sink.pending!.ref})` }];
    const done = await call({ ...REQUEST, confirmed: true }, "yes", history, d);
    expect(done.out.status).toBe("created");
    expect(t.create.mock.calls[0][0].content.checks?.[0].path).toBe(LETTER_CHECK_PATH);
  });
});

/* ─────────────────────────── no letter text can reach a prompt builder ─────────────────────────── */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}
const rel = (p: string) => p.replace(`${process.cwd()}/`, "");
const SRC = walk(join(process.cwd(), "src"));
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Everything that hands text to a model or builds what a model is given. */
const TALKS_TO_A_MODEL = /callClaude\b|askClaude\b|streamClaudeWithTools\b|callClaudeWithTools\b|\bllm\(|input\.llm\b|ctx\.llm\b|@anthropic-ai|StructuredCall\b|ChatCall\b/;
/** Anything that can put the firm's letter text, or a signed agreement, in a variable. */
const HOLDS_LETTER_TEXT =
  /@\/lib\/loe\/(templates-store|approved-letter-read|stored-agreement|signature-read|signed-letter|signed-pdf|signed-text-check|signing|render|pdf|live-guard|editor-state)\b|@\/lib\/proposals\/attach-letter\b|getApprovedLetter|readApprovedLetterScoped|attachFirmLetter|client_proposal_loe_template|agreement_text|\bloe\.body\b|\.loe\?\.body\b/;

describe("the firm's letter cannot reach a prompt builder", () => {
  const modelFiles = SRC.filter((f) => TALKS_TO_A_MODEL.test(code(f))).map(rel).sort();

  it("the scan finds the model-facing files (so the test below is not vacuous)", () => {
    for (const must of ["src/lib/ai/claude.ts", "src/lib/consult-proposal/draft.ts", "src/lib/agents/matters-chat.ts", "src/lib/consult-proposal/run.ts"]) expect(modelFiles).toContain(must);
    expect(modelFiles.length).toBeGreaterThan(10);
  });

  it("no file that talks to a model imports or reads the letter, except the consult run, which reads it after the model is done", () => {
    const offenders = modelFiles.filter((f) => HOLDS_LETTER_TEXT.test(code(join(process.cwd(), f))));
    expect(offenders).toEqual(["src/lib/consult-proposal/run.ts"]);
  });

  it("the consult run attaches the letter after its only model-using call, and the lettered content goes to the insert alone", () => {
    const src = code(join(process.cwd(), "src/lib/consult-proposal/run.ts"));
    const drafter = src.indexOf("draftProposalFromConsult({");
    const readAt = src.indexOf("getApprovedLetter(");
    const attachAt = src.indexOf("attachFirmLetter(draft.content");
    expect(drafter).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(drafter);
    expect(attachAt).toBeGreaterThan(readAt);
    // The model is referenced exactly once in the run (handed to the drafter), before the letter is read.
    expect(src.split("input.llm").length - 1).toBe(1);
    expect(src.indexOf("input.llm")).toBeLessThan(readAt);
    // The lettered content is used exactly once: the insert. The email, the queue item and the evidence event are built from `draft`.
    expect(src.split("withLetter.content").length - 1).toBe(1);
    const insert = src.slice(src.indexOf("insertAgentProposal("), src.indexOf("progress.proposalId = proposal.id"));
    expect(insert).toContain("content: withLetter.content");
    expect(src).toContain("renderProposalEmail(draft,");
    expect(src).not.toMatch(/letterRead\.letter|\.letter\.body|\.loe\b/);
  });

  it("the Copilot executor attaches the letter only in the confirmed branch, straight into the insert, and returns no content to the model", () => {
    const src = code(join(process.cwd(), "src/lib/agents/copilot-draft-proposal.ts"));
    const confirmedGuard = src.indexOf("if (!confirmed) {");
    const attachAt = src.indexOf("attachFirmLetter(draft.content");
    const createAt = src.indexOf("deps.create({");
    expect(confirmedGuard).toBeGreaterThan(-1);
    expect(attachAt).toBeGreaterThan(confirmedGuard);
    expect(createAt).toBeGreaterThan(attachAt);
    expect(src.split("withLetter.content").length - 1).toBe(1);
    expect(src.slice(createAt, src.indexOf("});", createAt))).toContain("content: withLetter.content");
    // No returned tool result carries the content or the read.
    for (const m of src.matchAll(/return \{[\s\S]*?\n {2,4}\};/g)) expect(m[0]).not.toMatch(/\bcontent\b|letterRead|withLetter\.content/);
    // The file that builds what the model sees never names the letter.
    expect(HOLDS_LETTER_TEXT.test(code(join(process.cwd(), "src/lib/copilot/draft-proposal.ts")))).toBe(false);
    expect(HOLDS_LETTER_TEXT.test(code(join(process.cwd(), "src/lib/agents/matters-chat.ts")))).toBe(false);
  });

  it("both model-facing builders call the one builder with letter: null", () => {
    for (const f of ["src/lib/consult-proposal/draft.ts", "src/lib/copilot/draft-proposal.ts"]) {
      const src = code(join(process.cwd(), f));
      const calls = [...src.matchAll(/buildDraftContent\(([^;]*)\);/g)].map((m) => m[1]);
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) expect(c, f).toMatch(/letter: null/);
    }
  });

  it("the from-scratch door attaches through the same helper (withLoeSnapshot, in the one builder) and refuses on a failed read", () => {
    const builder = read(join(process.cwd(), "src/lib/proposals/draft-spec.ts"));
    expect(builder).toContain("content = withLoeSnapshot(content, firm.letter, true);");
    const attach = read(join(process.cwd(), "src/lib/proposals/attach-letter.ts"));
    expect(attach).toContain("withLoeSnapshot(content, read.letter, true)");
    const scratch = read(join(process.cwd(), "src/app/dashboard/proposals/actions.ts"));
    expect(scratch).toMatch(/buildDraftContent\(spec, \{ pricing: settingsPricing, letter \}, rand\)/);
  });
});
