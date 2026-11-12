import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LETTER_CHANGED_SENTENCE, LETTER_UNREADABLE_SENTENCE, LINK_TURNED_ON } from "@/lib/proposal-editor/vocabulary";
import { LETTER_PENDING_FIX } from "@/lib/ui/words";
import type { ProposalContent } from "@/lib/proposals/types";
import { sevetri } from "../proposals/fixture";

/**
 * Review item 5. ONE guard decides whether a version that carries an engagement letter may go live: the copy on the proposal
 * must be the firm's current approved letter, read fenced on the proposal row's own org. Every path that turns a link on runs
 * it and refuses with the same fixed sentence:
 *   - "Save and create link"  (createLinkAction)
 *   - "Turn on the link"      (sendAction)
 *   - the approval queue      (makeProposalLive)
 * The store, the actions and the queue's go-live are the REAL modules here; only the database client is a fake.
 */

const ID = "11111111-1111-4111-8111-111111111111";
const ORG = "org-1";
const TEMPLATE = { id: "22222222-2222-4222-8222-222222222222", kind: "trademark", version: 3, status: "approved", title: "Engagement letter", body: "Dear {{client_name}},\n\nThis confirms our engagement.", updated_at: "2026-11-01T00:00:00Z", approved_at: "2026-11-01T00:00:00Z" };

function withLetter(over: Partial<{ template_version: number; body: string; template_id: string }> = {}): ProposalContent {
  return { ...sevetri(), loe: { kind: "trademark", template_id: TEMPLATE.id, template_version: TEMPLATE.version, title: TEMPLATE.title, body: TEMPLATE.body, ...over } };
}

type Row = Record<string, unknown>;
const state = {
  proposal: {} as Row,
  /** What the firm's approved-letter read answers. */
  template: { data: TEMPLATE as Row | null, error: null as Row | null, throws: false },
  role: "owner",
  rpc: [] as string[],
  updates: [] as Row[],
  templateFilters: [] as Array<[string, unknown]>,
  templateReads: 0,
};

function proposalRow(over: Row = {}): Row {
  return {
    id: ID,
    org_id: ORG,
    family_id: ID,
    version: 1,
    public_token: "t".repeat(43),
    lead_id: null,
    matter_id: null,
    client_name: "Sevetri Wilson",
    client_email: "sevetri@example.com",
    title: "Trademark Proposal",
    status: "approved",
    content: withLetter(),
    expires_on: "2026-12-31",
    pay_url: "https://pay.example/x",
    source: "manual",
    updated_at: "2026-11-10T00:00:00Z",
    ...over,
  };
}

/** A scoped client that answers the reads the store, the actions and the guard make, and records the writes. */
function fakeClient() {
  return {
    rpc: async (fn: string) => {
      state.rpc.push(fn);
      if (fn === "current_org_role") return { data: state.role, error: null };
      if (fn === "current_org_id") return { data: ORG, error: null };
      if (fn === "client_proposal_send") {
        state.proposal = { ...state.proposal, status: "sent" };
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let patch: Row | null = null;
      const result = () => {
        if (table === "client_proposal_loe_template") {
          state.templateReads += 1;
          state.templateFilters = filters;
          if (state.template.throws) throw new Error("connection reset");
          return { data: state.template.data, error: state.template.error };
        }
        if (table === "client_proposal") {
          if (patch) {
            state.updates.push(patch);
            const matches = filters.every(([c, v]) => state.proposal[c] === v);
            if (matches) state.proposal = { ...state.proposal, ...patch };
            return { data: matches ? state.proposal : null, error: null };
          }
          return { data: state.proposal, error: null };
        }
        return { data: [], error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        update: (p: Row) => {
          patch = p;
          return q;
        },
        eq: (c: string, v: unknown) => {
          filters.push([c, v]);
          return q;
        },
        in: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => result(),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          try {
            const r = result();
            // List reads (versions, events, activity) want arrays.
            return Promise.resolve(table === "client_proposal" && !patch ? { data: [state.proposal], error: null } : r).then(resolve, reject);
          } catch (e) {
            return Promise.reject(e).then(resolve, reject);
          }
        },
      };
      return q;
    },
  };
}

vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => fakeClient() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: async () => "firm" }));
vi.mock("@/lib/queue/api", () => ({ getQueueItem: vi.fn(async () => ({ id: "q", status: "approved" })) }));
vi.mock("../../src/app/dashboard/proposals/gate", () => ({
  gateStaffAction: async () => null,
  gateAdminAction: async () => null,
  gatePaidAction: async () => null,
  requireProposalsModule: async () => undefined,
}));

beforeEach(() => {
  state.proposal = proposalRow();
  state.template = { data: TEMPLATE, error: null, throws: false };
  state.role = "owner";
  state.rpc = [];
  state.updates = [];
  state.templateFilters = [];
  state.templateReads = 0;
});

const sent = () => state.rpc.includes("client_proposal_send");
const form = (extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("proposalId", ID);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
};

/** The firm approved version 4 after this proposal was saved with version 3. */
const firmMovedOn = () => (state.template.data = { ...TEMPLATE, id: "33333333-3333-4333-8333-333333333333", version: 4, body: `${TEMPLATE.body}\n\nA new clause.` });

describe("the guard itself", () => {
  it("no letter on the proposal: nothing to check, and the firm's letter is not even read", async () => {
    const { letterLiveCheck, letterLiveRefusal } = await import("@/lib/loe/live-guard");
    const check = await letterLiveCheck(fakeClient() as never, { org_id: ORG, content: sevetri() });
    expect(check).toBe("no_letter");
    expect(letterLiveRefusal(check)).toBeNull();
    expect(state.templateReads).toBe(0);
  });

  it("the copy is the firm's current approved letter: the link may go live", async () => {
    const { letterLiveCheck, letterLiveRefusal } = await import("@/lib/loe/live-guard");
    const check = await letterLiveCheck(fakeClient() as never, { org_id: ORG, content: withLetter() });
    expect(check).toBe("current");
    expect(letterLiveRefusal(check)).toBeNull();
  });

  it("reads the firm's letter FENCED ON THE PROPOSAL ROW'S OWN ORG (safe on a service-role client too), by kind and approved status", async () => {
    const { letterLiveCheck } = await import("@/lib/loe/live-guard");
    await letterLiveCheck(fakeClient() as never, { org_id: "the-rows-own-org", content: withLetter() });
    expect(state.templateFilters).toEqual([
      ["kind", "trademark"],
      ["status", "approved"],
      ["org_id", "the-rows-own-org"],
    ]);
    // A row with no org of its own is never read against "whatever the connection sees".
    state.templateReads = 0;
    expect(await letterLiveCheck(fakeClient() as never, { org_id: "", content: withLetter() })).toBe("unreadable");
    expect(state.templateReads).toBe(0);
  });

  it("stale: another version, another text, or the firm no longer has an approved letter", async () => {
    const { letterLiveCheck, letterLiveRefusal } = await import("@/lib/loe/live-guard");
    firmMovedOn();
    expect(await letterLiveCheck(fakeClient() as never, { org_id: ORG, content: withLetter() })).toBe("stale");
    state.template.data = { ...TEMPLATE, body: `${TEMPLATE.body} edited` };
    expect(await letterLiveCheck(fakeClient() as never, { org_id: ORG, content: withLetter() })).toBe("stale");
    state.template.data = null;
    expect(await letterLiveCheck(fakeClient() as never, { org_id: ORG, content: withLetter() })).toBe("stale");
    expect(letterLiveRefusal("stale")).toBe(LETTER_CHANGED_SENTENCE);
  });

  it("unreadable: an error, a missing table, or a throw. Never 'current' on a guess", async () => {
    const { letterLiveCheck, letterLiveRefusal } = await import("@/lib/loe/live-guard");
    state.template = { data: null, error: { code: "XX000", message: "boom" }, throws: false };
    expect(await letterLiveCheck(fakeClient() as never, { org_id: ORG, content: withLetter() })).toBe("unreadable");
    state.template = { data: null, error: { code: "42P01", message: "relation does not exist" }, throws: false };
    expect(await letterLiveCheck(fakeClient() as never, { org_id: ORG, content: withLetter() })).toBe("unreadable");
    state.template = { data: null, error: null, throws: true };
    expect(await letterLiveCheck(fakeClient() as never, { org_id: ORG, content: withLetter() })).toBe("unreadable");
    expect(letterLiveRefusal("unreadable")).toBe(LETTER_UNREADABLE_SENTENCE);
  });

  it("the sentence works for every path (it does not assume unsaved changes on the page)", () => {
    expect(LETTER_CHANGED_SENTENCE).toMatch(/engagement letter has changed/);
    expect(LETTER_CHANGED_SENTENCE).toMatch(/link wasn't turned on/);
    expect(LETTER_CHANGED_SENTENCE).toMatch(/save it again/);
    expect(LETTER_CHANGED_SENTENCE).not.toMatch(/sent|email/i);
  });
});

describe("path 1: 'Turn on the link' (sendAction, a saved version)", () => {
  it("a current letter copy turns the link on", async () => {
    const { sendAction } = await import("../../src/app/dashboard/proposals/[id]/actions");
    expect(await sendAction({}, form())).toEqual({ saved: true, notice: LINK_TURNED_ON });
    expect(sent()).toBe(true);
    expect(state.templateFilters).toContainEqual(["org_id", ORG]);
  });

  it("a stale letter copy is refused with the fixed sentence and the database is never asked to send", async () => {
    firmMovedOn();
    const { sendAction } = await import("../../src/app/dashboard/proposals/[id]/actions");
    expect(await sendAction({}, form())).toEqual({ error: LETTER_CHANGED_SENTENCE });
    expect(sent()).toBe(false);
    expect(state.proposal.status).toBe("approved");
  });

  it("an unreadable firm letter is refused with its own sentence, and nothing is sent", async () => {
    state.template = { data: null, error: { code: "XX000" }, throws: false };
    const { sendAction } = await import("../../src/app/dashboard/proposals/[id]/actions");
    expect(await sendAction({}, form())).toEqual({ error: LETTER_UNREADABLE_SENTENCE });
    expect(sent()).toBe(false);
  });

  it("a proposal with no letter turns on as it always did, with no letter read", async () => {
    state.proposal = proposalRow({ content: sevetri() });
    const { sendAction } = await import("../../src/app/dashboard/proposals/[id]/actions");
    expect(await sendAction({}, form())).toEqual({ saved: true, notice: LINK_TURNED_ON });
    expect(state.templateReads).toBe(0);
  });
});

describe("path 2: the approval queue's go-live (makeProposalLive)", () => {
  it("a current letter copy goes live", async () => {
    const { makeProposalLive } = await import("@/lib/consult-proposal/link");
    expect(await makeProposalLive(ID)).toEqual({ ok: true });
    expect(sent()).toBe(true);
  });

  it("a stale letter copy does not go live: the same fixed sentence comes back and nothing is sent", async () => {
    firmMovedOn();
    const { makeProposalLive } = await import("@/lib/consult-proposal/link");
    expect(await makeProposalLive(ID)).toEqual({ ok: false, error: LETTER_CHANGED_SENTENCE });
    expect(sent()).toBe(false);
    expect(state.proposal.status).toBe("approved");
  });

  it("an unreadable firm letter does not go live either", async () => {
    state.template = { data: null, error: null, throws: true };
    const { makeProposalLive } = await import("@/lib/consult-proposal/link");
    expect(await makeProposalLive(ID)).toEqual({ ok: false, error: LETTER_UNREADABLE_SENTENCE });
    expect(sent()).toBe(false);
  });

  it("the queue's approve path stops on it before the item is resolved or a mailbox draft exists", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/queue/review-core.ts"), "utf8");
    const live = src.indexOf("await makeProposalLive(gate.proposal.id)");
    expect(live).toBeGreaterThan(-1);
    expect(src.indexOf("if (!live.ok)", live)).toBeGreaterThan(live);
    expect(src.indexOf("resolveQueueItem(", live)).toBeGreaterThan(src.indexOf("if (!live.ok)", live));
  });
});

describe("path 3: 'Save and create link' (createLinkAction)", () => {
  it("a stale copy is refused BEFORE approving: the version stays a draft and nothing is sent", async () => {
    state.proposal = proposalRow({ status: "draft" });
    firmMovedOn();
    const { createLinkAction } = await import("../../src/app/dashboard/proposals/[id]/actions");
    expect(await createLinkAction({}, form())).toEqual({ error: LETTER_CHANGED_SENTENCE });
    expect(state.updates).toEqual([]);
    expect(state.proposal.status).toBe("draft");
    expect(sent()).toBe(false);
  });

  it("an unreadable firm letter is refused before approving", async () => {
    state.proposal = proposalRow({ status: "draft" });
    state.template = { data: null, error: { code: "XX000" }, throws: false };
    const { createLinkAction } = await import("../../src/app/dashboard/proposals/[id]/actions");
    expect(await createLinkAction({}, form())).toEqual({ error: LETTER_UNREADABLE_SENTENCE });
    expect(state.updates).toEqual([]);
    expect(sent()).toBe(false);
  });

  it("a current copy approves and goes live, and the guard ran both before approving and inside the send", async () => {
    state.proposal = proposalRow({ status: "draft" });
    const { createLinkAction } = await import("../../src/app/dashboard/proposals/[id]/actions");
    const r = await createLinkAction({}, form());
    expect(r.error).toBeUndefined();
    expect(state.updates).toEqual([{ status: "approved" }]);
    expect(sent()).toBe(true);
    expect(state.templateReads).toBe(2);
  });
});

describe("a draft whose letter couldn't be attached, still unresolved, never goes live", () => {
  /** No letter on the content, and the check an assistant's draft carries when the firm's letter couldn't be read. */
  const pending = (): ProposalContent => ({ ...sevetri(), checks: [{ text: "Couldn't read your engagement letter when this draft was made, so it isn't attached yet.", source: "assistant", path: "loe" }] });

  it("the guard answers 'unattached' without reading the firm's letter, and refuses with the fixed sentence", async () => {
    const { letterLiveCheck, letterLiveRefusal } = await import("@/lib/loe/live-guard");
    const check = await letterLiveCheck(fakeClient() as never, { org_id: ORG, content: pending() });
    expect(check).toBe("unattached");
    expect(letterLiveRefusal(check)).toBe(LETTER_PENDING_FIX);
    expect(state.templateReads).toBe(0);
  });

  it("'Save and create link': refused before approving, nothing written, nothing sent", async () => {
    state.proposal = proposalRow({ status: "draft", content: pending() });
    const { createLinkAction } = await import("../../src/app/dashboard/proposals/[id]/actions");
    expect(await createLinkAction({}, form())).toEqual({ error: LETTER_PENDING_FIX });
    expect(state.updates).toEqual([]);
    expect(sent()).toBe(false);
  });

  it("'Turn on the link' and the queue's go-live: refused inside the send, even for a row that somehow got saved", async () => {
    state.proposal = proposalRow({ status: "approved", content: pending() });
    const { sendAction } = await import("../../src/app/dashboard/proposals/[id]/actions");
    expect(await sendAction({}, form())).toEqual({ error: LETTER_PENDING_FIX });
    const { makeProposalLive } = await import("@/lib/consult-proposal/link");
    expect(await makeProposalLive(ID)).toEqual({ ok: false, error: LETTER_PENDING_FIX });
    expect(sent()).toBe(false);
  });

  it("the approve step itself refuses it (the store validates for approval)", async () => {
    state.proposal = proposalRow({ status: "draft", content: pending() });
    const { approveProposal } = await import("@/lib/proposals/store");
    await expect(approveProposal(ID)).rejects.toMatchObject({ code: "validation" });
    expect(state.updates).toEqual([]);
  });
});

describe("one guard, one place", () => {
  it("sendProposal is the only caller of client_proposal_send, and it runs the guard before it", () => {
    const store = readFileSync(join(process.cwd(), "src/lib/proposals/store.ts"), "utf8");
    const fn = store.slice(store.indexOf("export async function sendProposal"), store.indexOf("export async function withdrawProposal"));
    const guard = fn.indexOf("letterLiveRefusal(await letterLiveCheck(supabase, current))");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(fn.indexOf('db.rpc("client_proposal_send"'));
    expect(store.split('rpc("client_proposal_send"').length - 1).toBe(1);
  });

  it("every make-live path ends in sendProposal, and create-link asks the same guard first", () => {
    const actions = readFileSync(join(process.cwd(), "src/app/dashboard/proposals/[id]/actions.ts"), "utf8");
    expect(actions).toMatch(/makeLive: sendProposal/);
    expect(actions).toMatch(/lifecycle\(formData, sendProposal, LINK_TURNED_ON/);
    expect(actions).toMatch(/letterCurrent: async \(id\) => \{[\s\S]*?return letterLiveCheck\(await getScopedClient\(\), row\);/);
    const link = readFileSync(join(process.cwd(), "src/lib/consult-proposal/link.ts"), "utf8");
    expect(link.slice(link.indexOf("export async function makeProposalLive"))).toMatch(/await sendProposal\(proposalId\);/);
    // No other file makes a version live.
    for (const f of ["src/lib/queue/review-core.ts", "src/lib/consult-proposal/run.ts", "src/lib/agents/copilot-draft-proposal.ts", "src/lib/proposals/public.ts"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), f).not.toMatch(/client_proposal_send|update\(\{\s*status:\s*"sent"/);
    }
  });
});
