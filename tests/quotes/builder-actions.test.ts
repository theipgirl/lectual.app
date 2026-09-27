import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The quote builder's server actions against a FAKE scoped client — no
 * database. Ported from lectual's `quote-signed-copy.test.ts` (the terms race)
 * and extended to this app's new `updateDetailsAction` and to the attorney+
 * gate every action re-runs as its own POST entry point.
 */

type Op = {
  table: string;
  verb: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filters: Array<[string, unknown]>;
};

const db = vi.hoisted(() => ({
  role: "owner" as string | null,
  /** What `crm_quote ... maybeSingle()` hands back to the editability read. */
  quoteRow: null as Record<string, unknown> | null,
  /** What the UPDATE resolves to. `data: []` is PostgREST reporting that the
   * conditional update matched NOTHING — the race this suite is about. */
  updateResult: { data: [] as unknown, error: null as unknown },
  ops: [] as Op[],
}));

function makeQuery(table: string): Record<string, unknown> {
  const op: Op = { table, verb: "select", filters: [] };
  db.ops.push(op);
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.insert = (rows: unknown) => {
    op.verb = "insert";
    op.payload = rows;
    return q;
  };
  q.update = (patch: unknown) => {
    op.verb = "update";
    op.payload = patch;
    return q;
  };
  q.delete = () => {
    op.verb = "delete";
    return q;
  };
  q.eq = (column: string, value: unknown) => {
    op.filters.push([column, value]);
    return q;
  };
  q.in = () => q;
  q.order = () => q;
  q.limit = () => q;
  q.single = async () => ({ data: null, error: null });
  q.maybeSingle = async () => ({
    data: table === "crm_quote" && op.verb === "select" ? db.quoteRow : null,
    error: null,
  });
  q.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(op.verb === "update" ? db.updateResult : { data: [], error: null }).then(onFulfilled);
  return q;
}

function reset() {
  vi.resetModules();
  db.role = "owner";
  db.quoteRow = { id: "q-1", org_id: "org-1", status: "sent", expires_at: null };
  db.updateResult = { data: [], error: null };
  db.ops = [];
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => ({
      rpc: vi.fn(async (fn: string) =>
        fn === "current_org_role" ? { data: db.role, error: null } : { data: null, error: null },
      ),
      from: (table: string) => makeQuery(table),
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u-1" } }, error: null })) },
    })),
  }));
  // revalidatePath needs a Next request store that does not exist here.
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

async function actions() {
  return import("@/app/dashboard/quotes/[id]/actions");
}

const quoteUpdates = () => db.ops.filter((op) => op.table === "crm_quote" && op.verb === "update");
const eventInserts = () => db.ops.filter((op) => op.table === "crm_quote_event" && op.verb === "insert");
/** Every `.from(table)` the actions reached. The role rpc is not recorded. */
const tableOps = () => db.ops;

describe("saveTermsAction: the acceptance that lands mid-edit wins", () => {
  beforeEach(reset);

  it("pins the UPDATE to the status the read judged editable", async () => {
    db.updateResult = { data: [{ id: "q-1" }], error: null };
    await (await actions()).saveTermsAction({}, form({ quoteId: "q-1", termsBody: "Flat fee of 4500 dollars." }));
    const [update] = quoteUpdates();
    expect(update, "no update reached crm_quote").toBeTruthy();
    expect(update.filters).toContainEqual(["id", "q-1"]);
    expect(update.filters).toContainEqual(["status", "sent"]);
  });

  it("refuses, and writes no audit event, when the conditional update matches nothing", async () => {
    db.updateResult = { data: [], error: null };
    const state = await (await actions()).saveTermsAction({}, form({ quoteId: "q-1", termsBody: "REVISED: 9000 dollars." }));
    expect(state.error).toContain("changed while you were editing");
    expect(state.error).toContain("NOT saved");
    expect(eventInserts()).toHaveLength(0);
  });

  it("saves and records the revision — length only, never the text", async () => {
    db.updateResult = { data: [{ id: "q-1" }], error: null };
    const state = await (await actions()).saveTermsAction({}, form({ quoteId: "q-1", termsBody: "Flat fee of 4500 dollars." }));
    expect(state.error).toBeUndefined();
    expect(state.saved).toBe(true);
    expect(eventInserts()).toHaveLength(1);
    const payload = eventInserts()[0].payload as Record<string, unknown>;
    expect(payload.type).toBe("revised");
    expect(JSON.stringify(payload)).not.toContain("Flat fee of 4500 dollars.");
  });

  it("still refuses an accepted quote outright, with the readable reason", async () => {
    db.quoteRow = { id: "q-1", org_id: "org-1", status: "accepted", expires_at: null };
    const state = await (await actions()).saveTermsAction({}, form({ quoteId: "q-1", termsBody: "anything" }));
    expect(state.error).toContain("accepted");
    expect(quoteUpdates()).toHaveLength(0);
    expect(eventInserts()).toHaveLength(0);
  });
});

describe("updateDetailsAction: the header edit guards the same race", () => {
  beforeEach(reset);

  it("pins the update to the stored status and stores expiry at end of the firm's day", async () => {
    db.updateResult = { data: [{ id: "q-1" }], error: null };
    const state = await (await actions()).updateDetailsAction(
      {},
      form({ quoteId: "q-1", title: "Acme — trademark package", introBody: "Hello", expiresAt: "2026-09-30" }),
    );
    expect(state).toEqual({ saved: true });
    const [update] = quoteUpdates();
    expect(update.filters).toContainEqual(["status", "sent"]);
    // 23:59:59 in New York on the 30th (EDT, UTC-4) — not 23:59:59 UTC, which
    // would close the proposal at 7:59 PM the day it was meant to be open.
    expect((update.payload as Record<string, unknown>).expires_at).toBe("2026-10-01T03:59:59.000Z");
  });

  it("reports a lost race instead of a save", async () => {
    db.updateResult = { data: [], error: null };
    const state = await (await actions()).updateDetailsAction({}, form({ quoteId: "q-1", title: "T", expiresAt: "" }));
    expect(state.error).toContain("changed while you were editing");
  });

  it("refuses a terminal quote before any write", async () => {
    db.quoteRow = { id: "q-1", org_id: "org-1", status: "withdrawn", expires_at: null };
    const state = await (await actions()).updateDetailsAction({}, form({ quoteId: "q-1", title: "T" }));
    expect(state.error).toContain("withdrawn");
    expect(quoteUpdates()).toHaveLength(0);
  });
});

describe("every builder action re-checks attorney+ as its own POST endpoint", () => {
  beforeEach(reset);

  const calls: Array<[string, Record<string, string>]> = [
    ["updateDetailsAction", { quoteId: "q-1", title: "T" }],
    ["addLineAction", { quoteId: "q-1", kind: "legal_fee", chargeAt: "signing", label: "L", amount: "10" }],
    ["updateLineAction", { quoteId: "q-1", lineId: "l-1", kind: "legal_fee", chargeAt: "signing", label: "L", quantity: "1", amount: "10" }],
    ["deleteLineAction", { quoteId: "q-1", lineId: "l-1" }],
    ["moveLineAction", { quoteId: "q-1", lineId: "l-1", direction: "up" }],
    ["applyServiceItemAction", { quoteId: "q-1", serviceItemId: "s-1" }],
    ["sendQuoteAction", { quoteId: "q-1" }],
    ["withdrawQuoteAction", { quoteId: "q-1" }],
    ["saveTermsAction", { quoteId: "q-1", termsBody: "x" }],
    ["generateTermsAction", { quoteId: "q-1", clientName: "Acme" }],
  ];

  for (const role of ["paralegal", "intake", "viewer", null]) {
    it(`refuses ${role ?? "an unreadable role"} before touching a table`, async () => {
      db.role = role;
      const mod = (await actions()) as unknown as Record<string, (s: object, f: FormData) => Promise<{ error?: string }>>;
      for (const [name, fields] of calls) {
        const state = await mod[name]({}, form(fields));
        expect(state.error, name).toContain("owners, admins, senior admins and attorneys");
      }
      expect(tableOps(), "a refused caller reached the database").toHaveLength(0);
    });
  }

  it("lets the attorney through the gate", async () => {
    db.role = "attorney";
    db.updateResult = { data: [{ id: "q-1" }], error: null };
    const state = await (await actions()).saveTermsAction({}, form({ quoteId: "q-1", termsBody: "x" }));
    expect(state.error).toBeUndefined();
  });
});

describe("createQuoteAction re-checks the gate too", () => {
  beforeEach(reset);

  it("refuses a paralegal before reading the form", async () => {
    db.role = "paralegal";
    const { createQuoteAction } = await import("@/app/dashboard/quotes/actions");
    const state = await createQuoteAction({}, form({ title: "T" }));
    expect(state.error).toContain("attorneys");
    expect(tableOps()).toHaveLength(0);
  });
});
