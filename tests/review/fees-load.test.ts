import { beforeEach, describe, expect, it, vi } from "vitest";
import { factCells } from "@/lib/review/sheet-cells";
import { feesFor, type AcceptedFeeRow, type TrackerFeeRow } from "@/lib/review/fees-cells";
import { CHUNK } from "@/lib/review/load";
import { FEES_CHUNK, FEES_MAX_PAGES, FEES_PAGE, PROPOSAL_FEE_SELECT, TRACKER_FEE_SELECT, readAcceptedProposalFees, readTrackerFees } from "@/lib/review/fees-load";

/** A recording fake of the scoped client: every `from(table).select(...)` chain is logged, and answered by `answer`. */
type Call = { table: string; select: string; eq: [string, unknown][]; inn: [string, readonly string[]][]; range: [number, number] | null };
function fakeDb(answer: (call: Call) => { data: unknown[] | null; error?: unknown }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      return {
        select(select: string) {
          const call: Call = { table, select, eq: [], inn: [], range: null };
          const b: Record<string, unknown> = {
            eq: (c: string, v: unknown) => (call.eq.push([c, v]), b),
            in: (c: string, v: readonly string[]) => (call.inn.push([c, v]), b),
            order: () => b,
            range: (from: number, to: number) => ((call.range = [from, to]), b),
            then: (resolve: (v: unknown) => unknown) => {
              calls.push(call);
              const r = answer(call);
              return resolve({ data: r.data, error: r.error ?? null });
            },
          };
          return b;
        },
      };
    },
  };
  return { db, calls };
}

// What loadReview reads besides the fee reads: all empty, so the rows come from `listMatters` / `listLeads` below.
const dbRef: { current: unknown } = { current: null };
const matters = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => dbRef.current }));
vi.mock("@/lib/matters", () => ({ listMatters: async () => matters.list }));
vi.mock("@/lib/pipeline", () => ({ listLeads: async () => [], listStages: async () => [] }));
vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: async () => [] }));
vi.mock("@/lib/queue/load", () => ({ loadActiveQueue: async () => ({ status: "unconfigured" }) }));
vi.mock("@/lib/queue/lead-pending", () => ({ loadPendingApprovalsByLead: async () => ({ status: "ok", byLead: {} }) }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/org/modules", () => ({ activeOrgModulesOrNull: async () => [] }));
vi.mock("@/lib/files/read", () => ({ countFilesByParent: async () => new Map(), countLettersByMatter: async () => new Map() }));
vi.mock("@/lib/leads/live", () => ({ leadRead: async (fn: (kit: { merged: boolean }) => Promise<unknown>) => fn({ merged: false }) }));
vi.mock("@/app/dashboard/matters/list-utils", () => ({ matterIdsNeedingReview: () => new Set() }));

const NOW = new Date("2026-11-02T15:00:00Z");
const matter = (id: string, over: Record<string, unknown> = {}) => ({
  id, matter_number: `TM-${id}`, title: "Northwind Tea", mark_text: "NORTHWIND", owner_name: "Northwind Tea LLC", status: "open", type: "TM", lead_id: null, assigned_to: null,
  stage_entered_at: "2026-10-20T00:00:00Z", created_at: "2026-01-01T00:00:00Z", lawmatics_id: null, lawmatics_synced_at: null,
  stage: { code: "10", label: "Application Filed", is_open: true, waiting_on: "uspto", order_index: 5 }, ...over,
});
const proposal = (over: Partial<AcceptedFeeRow> = {}): AcceptedFeeRow => ({ id: "p1", family_id: "f1", version: 1, lead_id: null, matter_id: "m1", accepted_at: "2026-10-20T12:00:00Z", legal: 125000, gov: 70000, ...over });
const ledger = (over: Partial<TrackerFeeRow> = {}): TrackerFeeRow => ({ matter_id: "m1", created_at: "2026-09-01T00:00:00Z", kind: "legal_fee", total: "$4,750", due: "2026-12-01", ...over });

async function load(options: Parameters<typeof import("@/lib/review/load").loadReview>[1]) {
  const { loadReview } = await import("@/lib/review/load");
  return loadReview(NOW, options);
}
const okLoad = (r: Awaited<ReturnType<typeof load>>) => {
  if (r.status !== "ok") throw new Error("expected ok");
  return r;
};

beforeEach(() => {
  matters.list = [matter("m1", { lead_id: "l1" })];
  dbRef.current = fakeDb(() => ({ data: [] })).db;
});

describe("loadReview({ withFees })", () => {
  it("withFees false: neither injected read is called, rows carry no fees, the note does not name fees", async () => {
    const reads = { acceptedProposalFees: vi.fn(async () => []), trackerFees: vi.fn(async () => []) };
    const r = okLoad(await load({ withFees: false, reads }));
    expect(reads.acceptedProposalFees).not.toHaveBeenCalled();
    expect(reads.trackerFees).not.toHaveBeenCalled();
    expect(r.rows.every((row) => !("fees" in row))).toBe(true);
    expect(r.failed).not.toContain("fees");
    // no options at all is the same as false
    const none = okLoad(await load(undefined));
    expect(none.rows.every((row) => !("fees" in row))).toBe(true);
  });

  it("withFees true: each read is called once, with the loader's own scoped client and the record ids", async () => {
    const reads = { acceptedProposalFees: vi.fn(async (...args: unknown[]) => (void args, [] as never[])), trackerFees: vi.fn(async (...args: unknown[]) => (void args, [] as never[])) };
    const r = okLoad(await load({ withFees: true, reads }));
    expect(reads.acceptedProposalFees).toHaveBeenCalledTimes(1);
    expect(reads.trackerFees).toHaveBeenCalledTimes(1);
    expect(reads.acceptedProposalFees.mock.calls[0][0]).toBe(dbRef.current);
    expect(reads.trackerFees.mock.calls[0][0]).toBe(dbRef.current);
    expect(reads.acceptedProposalFees.mock.calls[0][1]).toEqual(["m1"]);
    expect(reads.acceptedProposalFees.mock.calls[0][2]).toEqual(["l1"]);
    expect(r.rows[0].fees).toEqual({ legal: null, legalDue: null, gov: null, govDue: null });
    expect(r.failed).not.toContain("fees");
  });

  it("lead-filed proposal on matter row: $1,250 legal / $700 USPTO, titled as coming from the accepted proposal", async () => {
    const reads = { acceptedProposalFees: async () => [proposal({ matter_id: null, lead_id: "l1" })], trackerFees: async () => [] };
    const row = okLoad(await load({ withFees: true, reads })).rows[0];
    expect(row.kind).toBe("matter");
    expect(row.fees?.legal).toEqual({ text: "$1,250.00", from: "proposal" });
    expect(row.fees?.gov).toEqual({ text: "$700.00", from: "proposal" });
    const cells = factCells(row, "2026-11-02");
    expect(cells.legalFee).toMatchObject({ text: "$1,250.00", title: "From the accepted proposal" });
    expect(cells.govFee).toMatchObject({ text: "$700.00", title: "From the accepted proposal" });
  });

  it("matter-filed proposal shows on the matter row too", async () => {
    const reads = { acceptedProposalFees: async () => [proposal()], trackerFees: async () => [] };
    const row = okLoad(await load({ withFees: true, reads })).rows[0];
    expect(row.fees?.legal?.text).toBe("$1,250.00");
  });

  it("a proposal of another record is not shown on this one", async () => {
    const reads = { acceptedProposalFees: async () => [proposal({ matter_id: "elsewhere", lead_id: "other-lead" })], trackerFees: async () => [] };
    expect(okLoad(await load({ withFees: true, reads })).rows[0].fees?.legal).toBeNull();
  });

  it("a failed or cut-short injected read fails the fees source: fields absent on every row, cells say Couldn't load, the note names fees", async () => {
    for (const reads of [
      { acceptedProposalFees: async () => { throw new Error("x"); }, trackerFees: async () => [] },
      { acceptedProposalFees: async () => [], trackerFees: async () => { throw new Error("y"); } },
    ]) {
      const r = okLoad(await load({ withFees: true, reads }));
      expect(r.failed).toContain("fees");
      for (const row of r.rows) {
        expect("fees" in row).toBe(false);
        expect(factCells(row, "2026-11-02").legalFee).toEqual({ text: "Couldn't load", tone: "failed" });
        expect(factCells(row, "2026-11-02").govFeeDue.text).toBe("Couldn't load");
      }
    }
  });

  it("truncated tracker read fails the fees source (the real read, through the loader)", async () => {
    // Every tracker page comes back full, so the page budget runs out: the read must reject, not return what it has.
    const { db, calls } = fakeDb((c) => ({ data: c.select === TRACKER_FEE_SELECT ? Array.from({ length: FEES_PAGE }, () => ({ matter_id: "m1", created_at: null, kind: "legal_fee", total: "$1", due: null })) : [] }));
    dbRef.current = db;
    const r = okLoad(await load({ withFees: true }));
    expect(calls.filter((c) => c.select === TRACKER_FEE_SELECT)).toHaveLength(FEES_MAX_PAGES);
    expect(r.failed).toContain("fees");
    expect("fees" in r.rows[0]).toBe(false);
    expect(factCells(r.rows[0], "2026-11-02").legalFee.text).toBe("Couldn't load");
  });

  it("truncated proposal read fails the fees source (the real read, through the loader)", async () => {
    const { db } = fakeDb((c) => ({ data: c.select === PROPOSAL_FEE_SELECT ? Array.from({ length: FEES_PAGE }, () => proposal()) : [] }));
    dbRef.current = db;
    const r = okLoad(await load({ withFees: true }));
    expect(r.failed).toContain("fees");
    expect("fees" in r.rows[0]).toBe(false);
  });

  it("the default reads run through the loader and fill the cells from both sources", async () => {
    const { db } = fakeDb((c) => ({
      data: c.select === PROPOSAL_FEE_SELECT ? [proposal()] : c.select === TRACKER_FEE_SELECT ? [ledger({ kind: "filing_fee", total: "$350", due: "2026-12-15" })] : [],
    }));
    dbRef.current = db;
    const r = okLoad(await load({ withFees: true }));
    expect(r.failed).not.toContain("fees");
    expect(r.rows[0].fees).toEqual({ legal: { text: "$1,250.00", from: "proposal" }, legalDue: null, gov: { text: "$700.00", from: "proposal" }, govDue: "2026-12-15" });
  });
});

describe("fee rules (pure)", () => {
  const row = { kind: "matter" as const, id: "m1" };
  it("ledger-only shows verbatim strings and due dates, titled as from the spreadsheet import", () => {
    const f = feesFor(row, null, [], [ledger(), ledger({ kind: "filing_fee", total: "$1,050.00 (3 classes)", due: "Jan 5" })]);
    expect(f).toEqual({ legal: { text: "$4,750", from: "spreadsheet" }, legalDue: "2026-12-01", gov: { text: "$1,050.00 (3 classes)", from: "spreadsheet" }, govDue: "Jan 5" });
    const cells = factCells({ kind: "matter", fees: f }, "2026-11-02");
    expect(cells.legalFee.title).toBe("From the spreadsheet import");
    expect(cells.legalFeeDue).toMatchObject({ text: "2026-12-01", title: "From the spreadsheet import" });
  });
  it("the newest ledger row per kind wins; amounts are never re-parsed", () => {
    const f = feesFor(row, null, [], [ledger({ created_at: "2026-08-01T00:00:00Z", total: "$1" }), ledger({ created_at: "2026-10-01T00:00:00Z", total: "$4,750.50" })]);
    expect(f.legal?.text).toBe("$4,750.50");
  });
  it("the proposal wins over the ledger", () => {
    const f = feesFor(row, null, [proposal()], [ledger(), ledger({ kind: "filing_fee", total: "$999" })]);
    expect(f.legal).toEqual({ text: "$1,250.00", from: "proposal" });
    expect(f.gov).toEqual({ text: "$700.00", from: "proposal" });
  });
  it("newest accepted_at wins + 2 proposals", () => {
    const older = proposal({ id: "a", family_id: "f1", accepted_at: "2026-09-01T00:00:00Z", legal: 100000 });
    const newer = proposal({ id: "b", family_id: "f2", accepted_at: "2026-10-15T00:00:00Z", legal: 250000 });
    const f = feesFor(row, null, [older, newer], []);
    expect(f.legal).toEqual({ text: "$2,500.00 · 2 proposals", from: "proposal" });
    // the same family twice (a version and its row filed both ways) is ONE proposal
    expect(feesFor(row, null, [older, { ...older, lead_id: "l1" }], [], ).legal?.text).toBe("$1,000.00");
  });
  it("due dates absent without ledger: a proposal with no ledger row reads a dash for both", () => {
    const f = feesFor(row, null, [proposal()], []);
    expect(f.legalDue).toBeNull();
    expect(f.govDue).toBeNull();
    const cells = factCells({ kind: "matter", fees: f }, "2026-11-02");
    expect(cells.legalFeeDue).toEqual({ text: "—", tone: "none" });
    expect(cells.govFeeDue).toEqual({ text: "—", tone: "none" });
  });
  it("a proposal total that is not a number falls through to the ledger", () => {
    expect(feesFor(row, null, [proposal({ legal: "1250" as never })], [ledger()]).legal?.from).toBe("spreadsheet");
  });
  it("a lead row takes only proposals filed on the lead; nothing from the ledger", () => {
    const lead = { kind: "lead" as const, id: "l1" };
    expect(feesFor(lead, null, [proposal({ matter_id: null, lead_id: "l1" })], [ledger({ matter_id: "l1" })]).legal?.from).toBe("proposal");
    expect(feesFor(lead, null, [], [ledger({ matter_id: "l1" })]).legal).toBeNull();
  });
});

describe("the reads themselves", () => {
  it("proposal select string names only ids, the accept time and the two quote totals", () => {
    expect(PROPOSAL_FEE_SELECT).toBe("id, family_id, version, lead_id, matter_id, accepted_at, legal:accepted_snapshot->quote->legal_total_cents, gov:accepted_snapshot->quote->gov_total_cents");
    for (const banned of ["content", "client_name", "client_email", "selection", "*"]) expect(PROPOSAL_FEE_SELECT).not.toContain(banned);
    // accepted_snapshot appears only as a JSON path, never bare
    expect(PROPOSAL_FEE_SELECT.replace(/accepted_snapshot->/g, "")).not.toContain("accepted_snapshot");
  });
  it("tracker select string names the matter, the time and three payload paths: no bare payload and no *", () => {
    expect(TRACKER_FEE_SELECT).toBe("matter_id, created_at, kind:payload->>kind, total:payload->>total, due:payload->>due_date");
    expect(TRACKER_FEE_SELECT).not.toContain("*");
    expect(TRACKER_FEE_SELECT.replace(/payload->>/g, "")).not.toContain("payload");
  });
  it("only ACCEPTED proposals are asked for (a sent one shows nothing), by matter and by lead", async () => {
    const { db, calls } = fakeDb(() => ({ data: [] }));
    await readAcceptedProposalFees(db, ["m1"], ["l1"]);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.table).toBe("client_proposal");
      expect(c.select).toBe(PROPOSAL_FEE_SELECT);
      expect(c.eq).toContainEqual(["status", "accepted"]);
    }
    expect(calls.map((c) => c.inn[0][0]).sort()).toEqual(["lead_id", "matter_id"]);
  });
  it("the tracker read filters on payload->>source = tracker-import in the query", async () => {
    const { db, calls } = fakeDb(() => ({ data: [] }));
    await readTrackerFees(db, ["m1"]);
    expect(calls[0].table).toBe("crm_activity");
    expect(calls[0].eq).toContainEqual(["payload->>source", "tracker-import"]);
    expect(calls[0].select).toBe(TRACKER_FEE_SELECT);
  });
  it("chunked by CHUNK: 170 ids make three queries of at most CHUNK ids each, and nothing is read for no ids", async () => {
    expect(FEES_CHUNK).toBe(CHUNK);
    const ids = Array.from({ length: 170 }, (_, i) => `m${i}`);
    const { db, calls } = fakeDb(() => ({ data: [] }));
    await readTrackerFees(db, ids);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.inn[0][1].length)).toEqual([80, 80, 10]);
    const none = fakeDb(() => ({ data: [] }));
    await readTrackerFees(none.db, []);
    await readAcceptedProposalFees(none.db, [], []);
    expect(none.calls).toHaveLength(0);
  });
  it("paged: a full page asks for the next one, a short page ends the read, and ranges advance", async () => {
    let n = 0;
    const { db, calls } = fakeDb(() => ({ data: n++ === 0 ? Array.from({ length: FEES_PAGE }, () => ledger()) : [ledger()] }));
    const rows = await readTrackerFees(db, ["m1"]);
    expect(rows).toHaveLength(FEES_PAGE + 1);
    expect(calls.map((c) => c.range)).toEqual([[0, FEES_PAGE - 1], [FEES_PAGE, 2 * FEES_PAGE - 1]]);
  });
  it("truncated proposal read rejects rather than returning a capped page, and so does an error", async () => {
    await expect(readAcceptedProposalFees(fakeDb(() => ({ data: Array.from({ length: FEES_PAGE }, () => proposal()) })).db, ["m1"], [])).rejects.toThrow();
    await expect(readAcceptedProposalFees(fakeDb(() => ({ data: null, error: { code: "x" } })).db, ["m1"], [])).rejects.toThrow();
  });
  it("truncated tracker read rejects rather than returning a capped page, and so does an error", async () => {
    await expect(readTrackerFees(fakeDb(() => ({ data: Array.from({ length: FEES_PAGE }, () => ledger()) })).db, ["m1"])).rejects.toThrow();
    await expect(readTrackerFees(fakeDb(() => ({ data: null, error: { code: "x" } })).db, ["m1"])).rejects.toThrow();
  });
});

describe("fee reads run beside the other optional reads", () => {
  it("both fee reads start while another read in the same batch is still pending", async () => {
    // A task read that never answers keeps the batch open; the fee reads must already have been called.
    dbRef.current = {
      from: () => ({ select: () => { const b: Record<string, unknown> = { eq: () => b, in: () => b, order: () => b, range: () => b, then: () => undefined }; return b; } }),
    };
    matters.list = [matter("m1")];
    const reads = { acceptedProposalFees: vi.fn(async (...args: unknown[]) => (void args, [] as never[])), trackerFees: vi.fn(async (...args: unknown[]) => (void args, [] as never[])) };
    void load({ withFees: true, reads });
    await new Promise((r) => setTimeout(r, 20));
    expect(reads.acceptedProposalFees).toHaveBeenCalledTimes(1);
    expect(reads.trackerFees).toHaveBeenCalledTimes(1);
  });
});
