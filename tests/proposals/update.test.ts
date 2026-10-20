import { describe, it, expect, vi, beforeEach } from "vitest";

import { ProposalError } from "@/lib/proposals/errors";
import type { ProposalContent } from "@/lib/proposals/types";
import { sevetri } from "./fixture";

/**
 * updateProposal's optimistic concurrency, against a fake scoped client that
 * behaves like PostgREST + the 0089 trigger: `.update().eq()...` changes only
 * rows matching EVERY filter, and a changed row gets a fresh updated_at.
 */

type Row = Record<string, unknown>;
const ID = "11111111-1111-4111-8111-111111111111";
const T0 = "2026-10-19T12:00:00.123456+00:00";

let table: Row[] = [];
let events: Row[] = [];
let updates: Array<{ filters: Array<[string, unknown]>; patch: Row }> = [];
let tick = 0;

function builder(name: string) {
  const filters: Array<[string, unknown]> = [];
  let op: "select" | "update" | "insert" = "select";
  let payload: Row = {};
  const run = () => {
    if (name === "client_proposal_event") {
      if (op === "insert") events.push(payload);
      return { data: null, error: null };
    }
    const hit = table.filter((r) => filters.every(([c, v]) => r[c] === v));
    if (op === "update") {
      updates.push({ filters: [...filters], patch: payload });
      for (const r of hit) {
        Object.assign(r, payload, { updated_at: `2026-10-19T12:00:0${++tick}.000000+00:00` });
      }
    }
    return { data: hit.map((r) => ({ ...r })), error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q,
    update: (p: Row) => ((op = "update"), (payload = p), q),
    insert: (p: Row) => ((op = "insert"), (payload = p), q),
    eq: (c: string, v: unknown) => (filters.push([c, v]), q),
    maybeSingle: () => {
      const r = run();
      return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error });
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  };
  return q;
}

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    from: (name: string) => builder(name),
    rpc: async (fn: string) => ({ data: fn === "current_org_role" ? "owner" : "org-1", error: null }),
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  }),
}));

import { PROPOSAL_SAVE_CONFLICT, updateProposal } from "@/lib/proposals/store";

const MESSAGE = "Someone else saved this proposal while you were editing. Reload to see their changes.";

function row(over: Row = {}): Row {
  return {
    id: ID,
    org_id: "org-1",
    family_id: ID,
    version: 1,
    status: "draft",
    client_name: "Sevetri Wilson",
    client_email: "sevetri@example.com",
    title: "Trademark Proposal",
    content: sevetri(),
    expires_on: null,
    pay_url: null,
    lead_id: null,
    matter_id: null,
    updated_at: T0,
    ...over,
  };
}

beforeEach(() => {
  table = [row()];
  events = [];
  updates = [];
  tick = 0;
});

describe("updateProposal: optimistic concurrency", () => {
  it("saves when the editor's updated_at is still current, fencing the write on it", async () => {
    const saved = await updateProposal(ID, { title: "New title" }, { expectedUpdatedAt: T0 });
    expect(saved.title).toBe("New title");
    expect(updates).toHaveLength(1);
    expect(updates[0].filters).toContainEqual(["updated_at", T0]);
    expect(updates[0].filters).toContainEqual(["status", "draft"]);
    expect(events.map((e) => e.type)).toEqual(["edited"]);
  });

  it("refuses a stale updated_at with the conflict message and changes nothing", async () => {
    table[0].updated_at = "2026-10-19T12:05:00.000000+00:00"; // a colleague saved after this editor loaded
    const err = await updateProposal(ID, { title: "Mine" }, { expectedUpdatedAt: T0 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProposalError);
    expect(err.code).toBe("conflict");
    expect(err.message).toBe(MESSAGE);
    expect(PROPOSAL_SAVE_CONFLICT).toBe(MESSAGE);
    expect(updates).toHaveLength(0);
    expect(table[0].title).toBe("Trademark Proposal");
    expect(events).toHaveLength(0);
  });

  it("two saves from the same page: the first lands, the second conflicts", async () => {
    await updateProposal(ID, { title: "First" }, { expectedUpdatedAt: T0 });
    const err = await updateProposal(ID, { title: "Second" }, { expectedUpdatedAt: T0 }).catch((e) => e);
    expect(err).toMatchObject({ code: "conflict", message: MESSAGE });
    expect(table[0].title).toBe("First");
  });

  it("the write's own fence catches a save that lands between the read and the update", async () => {
    // The row read matches, but by the time the update runs it has moved: zero rows change.
    const original = table[0];
    let reads = 0;
    Object.defineProperty(table, "filter", {
      configurable: true,
      value: function (fn: (r: Row) => boolean) {
        reads += 1;
        if (reads === 2) original.updated_at = "2026-10-19T12:09:00.000000+00:00";
        return Array.prototype.filter.call(this, fn);
      },
    });
    const err = await updateProposal(ID, { title: "Racing" }, { expectedUpdatedAt: T0 }).catch((e) => e);
    expect(err).toMatchObject({ code: "conflict", message: MESSAGE });
    expect(original.title).toBe("Trademark Proposal");
  });

  it("then a save with the NEW updated_at works", async () => {
    const first = await updateProposal(ID, { title: "First" }, { expectedUpdatedAt: T0 });
    const second = await updateProposal(ID, { title: "Second" }, { expectedUpdatedAt: first.updated_at });
    expect(second.title).toBe("Second");
  });

  it.each([undefined, "", "   ", "not a date"])("never writes unfenced: %j is refused", async (bad) => {
    const err = await updateProposal(ID, { title: "x" }, { expectedUpdatedAt: bad as never }).catch((e) => e);
    expect(err).toMatchObject({ code: "conflict", message: MESSAGE });
    expect(updates).toHaveLength(0);
  });

  it("a frozen version still says so, once the editor is current", async () => {
    table = [row({ status: "sent" })];
    const err = await updateProposal(ID, { title: "x" }, { expectedUpdatedAt: T0 }).catch((e) => e);
    expect(err).toMatchObject({ code: "frozen" });
  });
});

describe("updateProposal keeps content.package_basis through a normal save (Sprint 6)", () => {
  it("a content save that carries it stores it, and one made by the editor's own parsers keeps it", async () => {
    const basis = { name: "Enhanced", edited: ["price"] };
    table = [row({ content: { ...sevetri(), package_basis: basis } })];
    const current = table[0].content as ProposalContent;
    // The editor's own section parsers spread the current content, so the basis rides along.
    const { parsePricing, parseMessage } = await import("@/lib/proposal-editor/form");
    const form = new FormData();
    for (const [k, v] of Object.entries({ package: "Enhanced", base: "3000", includedClasses: "2", perClass: "700", secondMarkPct: "15", govPerClass: "350" })) form.set(k, v);
    const priced = parsePricing(form);
    expect(priced.ok).toBe(true);
    if (!priced.ok) return;
    await updateProposal(ID, { content: { ...current, pricing: priced.value } }, { expectedUpdatedAt: T0 });
    expect((table[0].content as ProposalContent).package_basis).toEqual(basis);
    expect((table[0].content as ProposalContent).pricing.base_cents).toBe(300_000);

    const message = parseMessage(new FormData(), table[0].content as ProposalContent);
    expect(message.ok && message.value.package_basis).toEqual(basis);
  });
});
