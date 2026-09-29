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
  /** What the crm_quote UPDATE resolves to. `data: []` is PostgREST reporting
   * that the conditional update matched NOTHING — the race this suite is about. */
  updateResult: { data: [] as unknown, error: null as unknown },
  /** What a list read of `crm_quote_line` returns (the offer). */
  lines: [] as Record<string, unknown>[],
  /** What `crm_quote_line ... maybeSingle()` returns (one line by id). */
  lineRow: null as Record<string, unknown> | null,
  /** What `crm_service_item ... maybeSingle()` returns. */
  serviceItem: null as Record<string, unknown> | null,
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
  q.single = async () => ({
    data: op.verb === "insert" ? { id: "new-line", ...(op.payload as Record<string, unknown>) } : null,
    error: null,
  });
  q.maybeSingle = async () => ({
    data:
      op.verb !== "select"
        ? null
        : table === "crm_quote"
          ? db.quoteRow
          : table === "crm_quote_line"
            ? db.lineRow
            : table === "crm_service_item"
              ? db.serviceItem
              : null,
    error: null,
  });
  q.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(
      op.verb === "update" && table === "crm_quote"
        ? db.updateResult
        : op.verb === "select" && table === "crm_quote_line"
          ? { data: db.lines, error: null }
          : { data: [], error: null },
    ).then(onFulfilled);
  return q;
}

function reset() {
  vi.resetModules();
  db.role = "owner";
  db.quoteRow = { id: "q-1", org_id: "org-1", status: "sent", expires_at: null };
  db.updateResult = { data: [], error: null };
  db.lines = [];
  db.lineRow = null;
  db.serviceItem = null;
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
    ["addLineAction", { quoteId: "q-1", kind: "legal_fee", label: "L", amount: "10", placement: "package", packageName: "P" }],
    ["editLineAction", { quoteId: "q-1", lineId: "l-1", kind: "legal_fee", label: "L", amount: "10" }],
    ["setChargeAtAction", { quoteId: "q-1", lineId: "l-1", chargeAt: "filing" }],
    ["deleteLineAction", { quoteId: "q-1", lineId: "l-1" }],
    ["applyServiceItemAction", { quoteId: "q-1", serviceItemId: "s-1", placement: "add_on" }],
    ["setPackageOfferedAction", { quoteId: "q-1", packageName: "P", offered: "false" }],
    ["setAddOnOfferedAction", { quoteId: "q-1", lineId: "l-1", offered: "true" }],
    ["renamePackageAction", { quoteId: "q-1", packageName: "P", newName: "Q" }],
    ["duplicatePackageAction", { quoteId: "q-1", packageName: "P", newName: "Q" }],
    ["deletePackageAction", { quoteId: "q-1", packageName: "P" }],
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

/* ── packages and add-ons (packages.ts's mapping, through the store) ──────── */

const pkgLine = (id: string, pkg: string, selected: boolean, over: Record<string, unknown> = {}) => ({
  id,
  selection: "tier_option",
  tier_group: pkg,
  selected,
  kind: "legal_fee",
  charge_at: "signing",
  quantity: 1,
  unit_amount_cents: 100_000,
  label: id,
  ...over,
});
const lineWrites = () => db.ops.filter((op) => op.table === "crm_quote_line" && op.verb !== "select");

describe("a package's offer switch", () => {
  beforeEach(reset);

  it("refuses to withhold the last offered package, and writes nothing", async () => {
    db.lines = [pkgLine("a1", "Full", true), pkgLine("b1", "Filing only", false)];
    const state = await (await actions()).setPackageOfferedAction({}, form({ quoteId: "q-1", packageName: "Full", offered: "false" }));
    expect(state.error).toBe("At least one package has to be offered.");
    expect(lineWrites()).toHaveLength(0);
  });

  it("switches every line of the package at once, fenced on the quote AND the package", async () => {
    db.lines = [pkgLine("a1", "Full", true), pkgLine("a2", "Full", true), pkgLine("b1", "Filing only", true)];
    const state = await (await actions()).setPackageOfferedAction({}, form({ quoteId: "q-1", packageName: "Full", offered: "false" }));
    expect(state.error).toBeUndefined();
    const [write] = lineWrites();
    expect(write.verb).toBe("update");
    expect(write.payload).toMatchObject({ selected: false });
    expect(write.filters).toEqual(
      expect.arrayContaining([
        ["quote_id", "q-1"],
        ["selection", "tier_option"],
        ["tier_group", "Full"],
      ]),
    );
  });

  it("refuses a package that isn't on the quote", async () => {
    db.lines = [pkgLine("a1", "Full", true)];
    const state = await (await actions()).setPackageOfferedAction({}, form({ quoteId: "q-1", packageName: "Nope", offered: "true" }));
    expect(state.error).toBe("That package isn't on this quote.");
    expect(lineWrites()).toHaveLength(0);
  });

  it("does not touch an accepted quote", async () => {
    db.quoteRow = { id: "q-1", org_id: "org-1", status: "accepted", expires_at: null };
    db.lines = [pkgLine("a1", "Full", true), pkgLine("b1", "Filing only", true)];
    const state = await (await actions()).setPackageOfferedAction({}, form({ quoteId: "q-1", packageName: "Full", offered: "false" }));
    expect(state.error).toContain("accepted");
    expect(lineWrites()).toHaveLength(0);
  });
});

describe("placing a new line", () => {
  beforeEach(reset);

  it("gives a line joining a WITHHELD package that package's switch, not a posted one", async () => {
    db.lines = [pkgLine("a1", "Full", true), pkgLine("b1", "Filing only", false)];
    db.serviceItem = { id: "s-1", kind: "legal_fee", charge_at: "signing", unit_amount_cents: 90_000, label: "Filing, per class", description: null };
    const state = await (await actions()).applyServiceItemAction(
      {},
      form({ quoteId: "q-1", serviceItemId: "s-1", placement: "package", packageName: "Filing only", selected: "true" }),
    );
    expect(state.error).toBeUndefined();
    const insert = lineWrites().find((op) => op.verb === "insert");
    expect(insert?.payload).toMatchObject({ selection: "tier_option", tier_group: "Filing only", selected: false });
  });

  it("starts a new package offered, and a government fee at filing whatever was posted", async () => {
    db.lines = [pkgLine("a1", "Full", true)];
    const state = await (await actions()).addLineAction(
      {},
      form({ quoteId: "q-1", placement: "package", packageName: "  Filing   only ", kind: "government_fee", chargeAt: "signing", label: "USPTO fee", amount: "350" }),
    );
    expect(state.error).toBeUndefined();
    const insert = lineWrites().find((op) => op.verb === "insert");
    expect(insert?.payload).toMatchObject({
      selection: "tier_option",
      tier_group: "Filing only",
      selected: true,
      kind: "government_fee",
      charge_at: "filing",
      unit_amount_cents: 35_000,
    });
  });

  it("adds an add-on as an offered optional line", async () => {
    const state = await (await actions()).addLineAction(
      {},
      form({ quoteId: "q-1", placement: "add_on", kind: "legal_fee", label: "Watch service", amount: "600" }),
    );
    expect(state.error).toBeUndefined();
    const insert = lineWrites().find((op) => op.verb === "insert");
    expect(insert?.payload).toMatchObject({ selection: "optional", tier_group: null, selected: true, unit_amount_cents: 60_000 });
  });

  it("refuses a line with nowhere to go", async () => {
    const state = await (await actions()).addLineAction({}, form({ quoteId: "q-1", kind: "legal_fee", label: "L", amount: "10" }));
    expect(state.error).toBe("Choose where this line goes.");
    expect(lineWrites()).toHaveLength(0);
  });
});

describe("renaming, copying and removing packages", () => {
  beforeEach(reset);

  it("refuses a name another package already has", async () => {
    db.lines = [pkgLine("a1", "Full", true), pkgLine("b1", "Filing only", true)];
    const state = await (await actions()).renamePackageAction({}, form({ quoteId: "q-1", packageName: "Full", newName: "Filing only" }));
    expect(state.error).toBe("There's already a package called “Filing only”.");
    expect(lineWrites()).toHaveLength(0);
  });

  it("renames every line of the package, fenced on the old name", async () => {
    db.lines = [pkgLine("a1", "Full", true), pkgLine("a2", "Full", true)];
    await (await actions()).renamePackageAction({}, form({ quoteId: "q-1", packageName: "Full", newName: "Full prosecution" }));
    const [write] = lineWrites();
    expect(write.payload).toMatchObject({ tier_group: "Full prosecution" });
    expect(write.filters).toEqual(expect.arrayContaining([["quote_id", "q-1"], ["tier_group", "Full"]]));
  });

  it("copies a package's lines under the new name, offered", async () => {
    db.lines = [pkgLine("a1", "Full", true), pkgLine("a2", "Full", false)];
    await (await actions()).duplicatePackageAction({}, form({ quoteId: "q-1", packageName: "Full", newName: "Filing only" }));
    const insert = lineWrites().find((op) => op.verb === "insert");
    const rows = insert?.payload as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ org_id: "org-1", quote_id: "q-1", selection: "tier_option", tier_group: "Filing only", selected: true });
  });

  it("will not remove the only offered package while withheld ones remain", async () => {
    db.lines = [pkgLine("a1", "Full", true), pkgLine("b1", "Filing only", false)];
    const state = await (await actions()).deletePackageAction({}, form({ quoteId: "q-1", packageName: "Full" }));
    expect(state.error).toContain("At least one package has to be offered");
    expect(lineWrites()).toHaveLength(0);
  });
});

describe("the add-on switch and the Charged pill", () => {
  beforeEach(reset);

  it("offers only an optional line on its own — never one line of a package", async () => {
    db.lineRow = { id: "a1", quote_id: "q-1", selection: "tier_option", label: "a1" };
    const state = await (await actions()).setAddOnOfferedAction({}, form({ quoteId: "q-1", lineId: "a1", offered: "false" }));
    expect(state.error).toBe("Only an add-on can be offered on its own.");
    expect(lineWrites()).toHaveLength(0);
  });

  it("refuses to move a government fee to signing", async () => {
    db.lineRow = { id: "g1", quote_id: "q-1", kind: "government_fee", charge_at: "filing", selection: "included", tier_group: null, selected: true, unit_amount_cents: 35_000 };
    const state = await (await actions()).setChargeAtAction({}, form({ quoteId: "q-1", lineId: "g1", chargeAt: "signing" }));
    expect(state.error).toContain("can't be charged at signing");
    expect(lineWrites()).toHaveLength(0);
  });
});

describe("Send refuses an offer the client could not sign", () => {
  beforeEach(reset);

  it("refuses a draft whose packages are all withheld, before any event or status write", async () => {
    db.quoteRow = { id: "q-1", org_id: "org-1", status: "draft", expires_at: null };
    db.lines = [pkgLine("a1", "Full", false)];
    const state = await (await actions()).sendQuoteAction({}, form({ quoteId: "q-1" }));
    expect(state.error).toBe("At least one package has to be offered.");
    expect(quoteUpdates()).toHaveLength(0);
    expect(eventInserts()).toHaveLength(0);
  });

  it("refuses an empty draft", async () => {
    db.quoteRow = { id: "q-1", org_id: "org-1", status: "draft", expires_at: null };
    const state = await (await actions()).sendQuoteAction({}, form({ quoteId: "q-1" }));
    expect(state.error).toBe("Add at least one line before sending.");
    expect(quoteUpdates()).toHaveLength(0);
  });
});
