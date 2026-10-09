import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAcceptedSnapshot, type PublicQuoteLine } from "@/lib/quotes/public";
import { FakeDb, type Row } from "../quotes/fake-db";

/**
 * The signed quotes on a matter, as the engagement-letter form and the matter
 * page read them (loe-prefill-load.ts).
 *
 * What is pinned: the read goes through the caller's scoped client and names
 * only the columns the letter needs; only ACCEPTED quotes LINKED to THIS matter
 * count; an unreadable signed copy is reported as such rather than rebuilt from
 * the live lines; and the three states stay three — a failed read is never an
 * empty list. The generate action's re-check (`prefillForSignedQuote`) refuses
 * anything it cannot confirm.
 *
 * RLS itself (another firm's quote is invisible) is covered where the database
 * is: lectual's `tests/tenant-isolation.test.ts`. The fake has no RLS, so
 * nothing here claims it.
 */

const MATTER = "m-1";
const OTHER_MATTER = "m-2";

const state = vi.hoisted(() => ({
  client: null as unknown,
  matter: null as unknown,
  matterError: false,
}));

vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => state.client }));
vi.mock("@/lib/matters/matters", () => ({
  getMatter: async () => {
    if (state.matterError) throw new Error("db down");
    return state.matter;
  },
}));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));

const { loadSignedQuotesForMatter, prefillForSignedQuote } = await import("@/lib/documents/loe-prefill-load");

function lines(): PublicQuoteLine[] {
  const base = { kind: "legal_fee", charge_at: "signing", selection: "included", tier_group: null, selected: true, description: null, quantity: 1, sort_index: 0 };
  return [
    { ...base, id: "a", label: "Enhanced package", selection: "tier_option", tier_group: "Enhanced", unit_amount_cents: 325_000 },
    { ...base, id: "b", label: "USPTO filing fees", kind: "government_fee", charge_at: "filing", selection: "tier_option", tier_group: "Enhanced", quantity: 2, unit_amount_cents: 35_000 },
  ];
}

function snapshot(acceptedAt: string) {
  return buildAcceptedSnapshot({
    view: { title: "Filing", introBody: null, termsBody: "…in connection with the mark SUNBEAM, performing the services itemised above…", expiresAt: null, currency: "USD" },
    lines: lines(),
    acceptedAt,
    name: "Jane Doe",
    email: "jane@example.com",
  });
}

function quote(id: string, o: Row = {}): Row {
  return {
    id,
    org_id: "org-a",
    matter_id: MATTER,
    status: "accepted",
    title: `Quote ${id}`,
    accepted_at: "2026-09-27T15:00:00.000Z",
    accepted_snapshot: snapshot("2026-09-27T15:00:00.000Z"),
    public_token: "SECRET-TOKEN",
    accepted_ip: "203.0.113.9",
    ...o,
  };
}

function useDb(rows: Row[]): FakeDb {
  const db = new FakeDb({ crm_quote: rows });
  state.client = db;
  return db;
}

beforeEach(() => {
  state.matter = {
    id: MATTER,
    org_id: "org-a",
    mark_text: "SUNBEAM",
    international_classes: [25, 35],
    goods_services: "Clothing",
    package_name: "Enhanced",
  };
  state.matterError = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadSignedQuotesForMatter", () => {
  it("returns the accepted quotes linked to this matter, newest signature first", async () => {
    useDb([
      quote("q-old", { accepted_at: "2026-08-01T10:00:00.000Z" }),
      quote("q-new", { accepted_at: "2026-09-27T15:00:00.000Z" }),
      quote("q-draft", { status: "draft", accepted_at: null, accepted_snapshot: null }),
      quote("q-sent", { status: "sent", accepted_at: null, accepted_snapshot: null }),
      quote("q-declined", { status: "declined" }),
      quote("q-elsewhere", { matter_id: OTHER_MATTER }),
      quote("q-unlinked", { matter_id: null }),
    ]);

    const load = await loadSignedQuotesForMatter(MATTER);

    expect(load.status).toBe("ok");
    if (load.status !== "ok") return;
    expect(load.quotes.map((q) => q.quoteId)).toEqual(["q-new", "q-old"]);
    expect(load.quotes[0].reference).toMatch(/^QT-[0-9A-Z]{1,6}$/);
    expect(load.quotes[0].snapshot?.totals.due_at_signing).toBe(325_000);
  });

  it("an empty list under ok really is 'no signed quote'", async () => {
    useDb([quote("q-draft", { status: "draft" })]);
    expect(await loadSignedQuotesForMatter(MATTER)).toEqual({ status: "ok", quotes: [] });
  });

  it("names only the columns the letter needs: no public token, no signer IP", async () => {
    const db = useDb([quote("q-1")]);
    const load = await loadSignedQuotesForMatter(MATTER);
    expect(db.selects).toEqual([{ table: "crm_quote", columns: "id, title, accepted_at, accepted_snapshot" }]);
    expect(JSON.stringify(load)).not.toContain("SECRET-TOKEN");
    expect(JSON.stringify(load)).not.toContain("203.0.113.9");
  });

  it("reports a signed quote with no readable signed copy as signed-but-unreadable, not as absent", async () => {
    useDb([quote("q-1", { accepted_snapshot: null }), quote("q-2", { accepted_snapshot: { totals: "garbage" } })]);
    const load = await loadSignedQuotesForMatter(MATTER);
    expect(load.status).toBe("ok");
    if (load.status !== "ok") return;
    expect(load.quotes).toHaveLength(2);
    expect(load.quotes.every((q) => q.snapshot === null)).toBe(true);
  });

  it("a failed read is 'unavailable', never an empty list", async () => {
    const db = useDb([quote("q-1")]);
    db.failTable = "crm_quote";
    expect(await loadSignedQuotesForMatter(MATTER)).toEqual({ status: "unavailable" });
  });

  it("a client that throws is 'unavailable'", async () => {
    state.client = {
      from() {
        throw new Error("boom");
      },
    };
    expect(await loadSignedQuotesForMatter(MATTER)).toEqual({ status: "unavailable" });
  });

  it("a database without the quote tables is 'unconfigured', judged on the error code", async () => {
    const missing = { then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: { code: "PGRST205", message: "x" } }) };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) chain[m] = () => chain;
    Object.assign(chain, missing);
    state.client = { from: () => chain };
    expect(await loadSignedQuotesForMatter(MATTER)).toEqual({ status: "unconfigured" });
  });
});

describe("prefillForSignedQuote — the generate action's re-check", () => {
  it("builds the pre-fill from the stored snapshot and the matter", async () => {
    useDb([quote("q-1")]);
    const result = await prefillForSignedQuote(MATTER, "q-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prefill.quoteId).toBe("q-1");
    expect(result.prefill.packageName).toBe("Enhanced");
    expect(result.prefill.classCount).toBe("2");
    expect(result.prefill.amountPaid).toBe("$3,250");
    expect(result.prefill.markText).toBe("SUNBEAM");
    expect(result.prefill.acceptedOn).toBe("Sep 27, 2026");
  });

  it("refuses a quote that is not a signed quote on this matter", async () => {
    useDb([quote("q-elsewhere", { matter_id: OTHER_MATTER }), quote("q-draft", { status: "draft" })]);
    expect(await prefillForSignedQuote(MATTER, "q-elsewhere")).toEqual({ ok: false, reason: "not_signed" });
    expect(await prefillForSignedQuote(MATTER, "q-draft")).toEqual({ ok: false, reason: "not_signed" });
    expect(await prefillForSignedQuote(MATTER, "does-not-exist")).toEqual({ ok: false, reason: "not_signed" });
  });

  it("refuses a signed quote it cannot read, rather than building from anything else", async () => {
    useDb([quote("q-1", { accepted_snapshot: null })]);
    expect(await prefillForSignedQuote(MATTER, "q-1")).toEqual({ ok: false, reason: "unreadable" });
  });

  it("is unavailable when the quote read fails, and when the matter read fails", async () => {
    const db = useDb([quote("q-1")]);
    db.failTable = "crm_quote";
    expect(await prefillForSignedQuote(MATTER, "q-1")).toEqual({ ok: false, reason: "unavailable" });

    useDb([quote("q-1")]);
    state.matterError = true;
    expect(await prefillForSignedQuote(MATTER, "q-1")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("is matter_not_found for a matter the caller cannot see", async () => {
    useDb([quote("q-1")]);
    state.matter = null;
    expect(await prefillForSignedQuote(MATTER, "q-1")).toEqual({ ok: false, reason: "matter_not_found" });
  });
});
