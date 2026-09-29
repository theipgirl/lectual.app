import { describe, expect, it } from "vitest";

import {
  advanceLeadForAcceptedQuote,
  markFromTerms,
  nextMatterNumber,
  openMatterForAcceptedQuote,
} from "@/lib/quotes/accept-matter";
import { FakeDb, type Row } from "./fake-db";

/**
 * "Matter opens automatically" on acceptance — accept-matter.ts. It runs on the
 * public token path with the service-role client, so the properties that make
 * it safe are the ones pinned here:
 *
 *  - every read and every write is fenced by the quote's OWN org id, and a row
 *    from another firm is never followed (a lead, a stage, a PA tag);
 *  - it does nothing unless the quote is accepted, has a lead and has no matter;
 *  - it is idempotent, and two concurrent runs link exactly one matter;
 *  - it never throws — a failure is reported, and the acceptance it follows is
 *    untouched (public.test.ts covers that end).
 */

const ORG = "org-a";
const OTHER_ORG = "org-b";
const QUOTE = "q-1";
const LEAD = "lead-1";
const NOW = new Date("2026-09-27T15:00:00.000Z");

function tables(quote: Row = {}): Record<string, Row[]> {
  return {
    crm_quote: [{ id: QUOTE, org_id: ORG, status: "accepted", lead_id: LEAD, matter_id: null, ...quote }],
    crm_lead: [
      {
        id: LEAD,
        org_id: ORG,
        first_name: "Nadia",
        last_name: "Petra",
        business_name: "Halcyon Rowe LLC",
        mark_text: "HALCYON",
        referral_source: "Intake form",
        current_stage_id: "ls-consult",
      },
      { id: "lead-elsewhere", org_id: OTHER_ORG, first_name: "Other", last_name: "Firm", business_name: null, current_stage_id: null },
    ],
    crm_lead_tag: [
      { org_id: ORG, lead_id: LEAD, tag_id: "tag-cr" },
      { org_id: OTHER_ORG, lead_id: LEAD, tag_id: "tag-other" },
    ],
    crm_tag: [
      { id: "tag-cr", org_id: ORG, dimension: "PA", code: "PA-COPYRIGHT" },
      { id: "tag-other", org_id: OTHER_ORG, dimension: "PA", code: "PA-PATENT" },
    ],
    crm_matter_stage: [
      { id: "st-closed", org_id: ORG, order_index: 5, is_open: false },
      { id: "st-search", org_id: ORG, order_index: 20, is_open: true },
      { id: "st-intake", org_id: ORG, order_index: 10, is_open: true },
      { id: "st-other", org_id: OTHER_ORG, order_index: 1, is_open: true },
    ],
    crm_matter: [
      { id: "m-1", org_id: ORG, matter_number: "HIP-2026-001" },
      { id: "m-2", org_id: ORG, matter_number: "HIP-2026-002" },
      { id: "m-x", org_id: OTHER_ORG, matter_number: "CR-2026-0003" },
    ],
    crm_stage: [
      { id: "ls-new", org_id: ORG, name: "New PNC", category: "open", order_index: 1 },
      { id: "ls-consult", org_id: ORG, name: "Consult booked", category: "open", order_index: 2 },
      { id: "ls-lost", org_id: ORG, name: "Not moving forward", category: "lost", order_index: 9 },
      { id: "ls-hired", org_id: ORG, name: "Hired Client", category: "won", order_index: 5 },
      { id: "ls-filed", org_id: ORG, name: "Filed", category: "won", order_index: 6 },
      { id: "ls-other-won", org_id: OTHER_ORG, name: "Other firm won", category: "won", order_index: 0 },
    ],
    crm_quote_event: [],
    crm_activity: [],
  };
}

function makeDb(quote: Row = {}): FakeDb {
  const db = new FakeDb(tables(quote));
  db.unique = { crm_matter: [["org_id", "matter_number"]] };
  return db;
}

const run = (db: FakeDb, packageName: string | null = "Filing only") =>
  openMatterForAcceptedQuote(db, { quoteId: QUOTE, orgId: ORG }, { packageName, now: NOW });

const ours = (db: FakeDb) => db.tables.crm_matter.filter((m) => m.org_id === ORG);

describe("opening the matter", () => {
  it("opens one open matter for the quote's lead, in the firm's first open docket stage", async () => {
    const db = makeDb();
    const result = await run(db);
    expect(result).toMatchObject({ status: "opened", matterNumber: "CR-2026-0001" });
    if (result.status !== "opened") return;

    const matter = db.tables.crm_matter.find((m) => m.id === result.matterId);
    expect(matter).toMatchObject({
      org_id: ORG,
      lead_id: LEAD,
      // From the lead's PA tag IN THIS FIRM — the other firm's PA-PATENT is not read.
      type: "CR",
      title: "Halcyon Rowe LLC",
      package_name: "Filing only",
      status: "open",
      // The lowest-ordered OPEN stage of this firm: not the closed one, not
      // another firm's.
      stage_id: "st-intake",
      stage_entered_at: NOW.toISOString(),
    });
    expect(db.tables.crm_quote[0].matter_id).toBe(result.matterId);
  });

  it("records it on the quote's timeline and the lead's", async () => {
    const db = makeDb();
    const result = await run(db);
    if (result.status !== "opened") throw new Error("expected opened");
    expect(db.tables.crm_quote_event).toEqual([
      expect.objectContaining({
        org_id: ORG,
        quote_id: QUOTE,
        type: "revised",
        actor: "system",
        payload: { change: "matter_opened", matter_id: result.matterId, matter_number: "CR-2026-0001" },
      }),
    ]);
    expect(db.tables.crm_activity).toEqual([
      expect.objectContaining({ org_id: ORG, lead_id: LEAD, matter_id: result.matterId, type: "matter_opened", actor_type: "system" }),
    ]);
  });

  it("writes only rows stamped with the quote's own org, and fences every update and delete on it", async () => {
    const db = makeDb();
    await run(db);
    for (const table of ["crm_matter", "crm_quote_event", "crm_activity"]) {
      for (const row of db.tables[table].filter((r) => !["m-1", "m-2", "m-x"].includes(String(r.id)))) {
        expect(row.org_id, table).toBe(ORG);
      }
    }
    for (const write of db.writes.filter((w) => w.op !== "insert")) {
      expect(write.filters, write.table).toContainEqual({ kind: "eq", column: "org_id", value: ORG });
    }
  });

  it("uses the person's name when the lead has no business name, and TM when no PA tag", async () => {
    const db = makeDb();
    db.tables.crm_lead[0].business_name = null;
    db.tables.crm_lead_tag = [];
    const result = await run(db, null);
    if (result.status !== "opened") throw new Error("expected opened");
    expect(db.tables.crm_matter.find((m) => m.id === result.matterId)).toMatchObject({
      title: "Nadia Petra",
      type: "TM",
      package_name: null,
      matter_number: "TM-2026-0001",
    });
  });

  it("leaves the matter unplaced when the firm has no open docket stage", async () => {
    const db = makeDb();
    db.tables.crm_matter_stage = db.tables.crm_matter_stage.filter((s) => s.org_id !== ORG || !s.is_open);
    const result = await run(db);
    if (result.status !== "opened") throw new Error("expected opened");
    expect(db.tables.crm_matter.find((m) => m.id === result.matterId)).toMatchObject({ stage_id: null, stage_entered_at: null });
  });
});

describe("what the matter carries over", () => {
  it("takes the mark from the lead and 'Came from' from the lead's source", async () => {
    const db = makeDb();
    const result = await run(db);
    if (result.status !== "opened") throw new Error("expected opened");
    expect(db.tables.crm_matter.find((m) => m.id === result.matterId)).toMatchObject({
      mark_text: "HALCYON",
      referral_source: "Intake form",
    });
  });

  it("prefers the mark the client signed for in the generated terms", async () => {
    const db = makeDb({
      terms_body: "SCOPE\n\nThe Firm will represent you in connection with the mark ROWE & CO, performing the services itemised above.",
    });
    const result = await run(db);
    if (result.status !== "opened") throw new Error("expected opened");
    expect(db.tables.crm_matter.find((m) => m.id === result.matterId)?.mark_text).toBe("ROWE & CO");
  });

  it("reads only the generated scope sentence", () => {
    expect(markFromTerms(null)).toBeNull();
    expect(markFromTerms("We will help with your brand.")).toBeNull();
    expect(markFromTerms("…in connection with the mark BEAN THERE, performing the services…")).toBe("BEAN THERE");
  });

  it("uses the firm's time zone for the matter number's year", async () => {
    const db = makeDb();
    db.tables.crm_lead_tag = [];
    // 03:00 UTC on Jan 1 is still Dec 31 in Los Angeles.
    const result = await openMatterForAcceptedQuote(
      db,
      { quoteId: QUOTE, orgId: ORG },
      { packageName: null, now: new Date("2027-01-01T03:00:00Z"), timeZone: "America/Los_Angeles" },
    );
    expect(result).toMatchObject({ status: "opened", matterNumber: "TM-2026-0001" });
  });
});

describe("the lead moves to the firm's won stage", () => {
  const advance = (db: FakeDb) => advanceLeadForAcceptedQuote(db, { quoteId: QUOTE, orgId: ORG }, { now: NOW });

  it("moves the lead to the lowest won stage of THIS firm and names it on the timeline", async () => {
    const db = makeDb();
    expect(await advance(db)).toEqual({ status: "moved", stageId: "ls-hired", stageName: "Hired Client" });
    expect(db.tables.crm_lead[0]).toMatchObject({ current_stage_id: "ls-hired", stage_entered_at: NOW.toISOString() });
    expect(db.tables.crm_activity).toEqual([
      expect.objectContaining({
        org_id: ORG,
        lead_id: LEAD,
        type: "stage_changed",
        actor_type: "system",
        payload: expect.objectContaining({ from_stage: "Consult booked", to_stage: "Hired Client", to_stage_id: "ls-hired" }),
      }),
    ]);
    for (const write of db.writes.filter((w) => w.op !== "insert")) {
      expect(write.filters).toContainEqual({ kind: "eq", column: "org_id", value: ORG });
    }
  });

  it("opens no second matter", async () => {
    const db = makeDb();
    await run(db);
    await advance(db);
    expect(ours(db)).toHaveLength(3);
  });

  it("leaves a lead already in a won stage alone", async () => {
    const db = makeDb();
    db.tables.crm_lead[0].current_stage_id = "ls-filed";
    expect(await advance(db)).toEqual({ status: "skipped", reason: "already_won" });
    expect(db.writes).toEqual([]);
  });

  it("does nothing for a firm with no won stage, or a quote not accepted", async () => {
    const db = makeDb();
    db.tables.crm_stage = db.tables.crm_stage.filter((st) => st.org_id !== ORG || st.category !== "won");
    expect(await advance(db)).toEqual({ status: "skipped", reason: "no_won_stage" });
    expect(await advance(makeDb({ status: "sent" }))).toEqual({ status: "skipped", reason: "not_accepted" });
  });

  it("never throws", async () => {
    const db = makeDb();
    db.failTable = "crm_stage";
    await expect(advance(db)).resolves.toEqual({ status: "failed" });
  });
});

describe("matter numbers — one sequence per type per year, never a taken one", () => {
  it("is the highest number in that type-and-year sequence + 1, zero-padded", () => {
    expect(nextMatterNumber("TM", "2026", [])).toBe("TM-2026-0001");
    expect(nextMatterNumber("TM", "2026", ["A", "B"])).toBe("TM-2026-0001");
    // Other types, other years and other schemes never advance this sequence.
    expect(nextMatterNumber("TM", "2026", ["HIP-2026-009", "CR-2026-0004", "TM-2025-0007"])).toBe("TM-2026-0001");
    expect(nextMatterNumber("TM", "2026", ["TM-2026-0003", "TM-2026-0001"])).toBe("TM-2026-0004");
  });

  it("steps past a number already taken", () => {
    expect(nextMatterNumber("TM", "2026", ["TM-2026-0002"])).toBe("TM-2026-0003");
  });

  it("tries the next number when the insert loses a race for this one", async () => {
    const db = makeDb();
    db.insertFailure = { table: "crm_matter", code: "23505" };
    const result = await run(db);
    expect(result).toMatchObject({ status: "opened", matterNumber: "CR-2026-0002" });
  });
});

describe("only when it should, and only once", () => {
  it("does nothing for a quote with no lead", async () => {
    const db = makeDb({ lead_id: null });
    expect(await run(db)).toEqual({ status: "skipped", reason: "no_lead" });
    expect(db.writes).toEqual([]);
  });

  it("does nothing for a quote that already has a matter", async () => {
    const db = makeDb({ matter_id: "m-1" });
    expect(await run(db)).toEqual({ status: "skipped", reason: "has_matter" });
    expect(db.writes).toEqual([]);
  });

  it("does nothing for a quote that is not accepted", async () => {
    const db = makeDb({ status: "sent" });
    expect(await run(db)).toEqual({ status: "skipped", reason: "not_accepted" });
    expect(db.writes).toEqual([]);
  });

  it("does not follow a lead id into another firm", async () => {
    // 0068's composite FK makes this row impossible; the read is fenced anyway.
    const db = makeDb({ lead_id: "lead-elsewhere" });
    expect(await run(db)).toEqual({ status: "skipped", reason: "no_lead" });
    expect(db.writes).toEqual([]);
  });

  it("is idempotent — a second run finds the matter and opens nothing", async () => {
    const db = makeDb();
    const first = await run(db);
    expect(first.status).toBe("opened");
    expect(await run(db)).toEqual({ status: "skipped", reason: "has_matter" });
    expect(ours(db)).toHaveLength(3);
    expect(db.tables.crm_quote_event).toHaveLength(1);
  });

  it("links exactly one matter when two runs race, and the loser removes its own", async () => {
    const db = makeDb();
    let arrived = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    db.beforeQuery = async (table, op) => {
      if (table !== "crm_quote" || op !== "select") return;
      arrived += 1;
      if (arrived >= 2) release();
      await gate;
    };
    const [a, b] = await Promise.all([run(db), run(db)]);
    db.beforeQuery = null;

    const opened = [a, b].filter((r) => r.status === "opened");
    expect(opened).toHaveLength(1);
    expect([a, b].find((r) => r.status !== "opened")).toEqual({ status: "skipped", reason: "has_matter" });
    // One new matter survives, and it is the one the quote points at.
    expect(ours(db)).toHaveLength(3);
    const linked = db.tables.crm_quote[0].matter_id;
    expect(ours(db).some((m) => m.id === linked)).toBe(true);
    expect(db.tables.crm_quote_event).toHaveLength(1);
    expect(db.tables.crm_activity).toHaveLength(1);
  });
});

describe("never throws, never half-links", () => {
  it("reports a failed matter insert and links nothing", async () => {
    const db = makeDb();
    db.failInsertTable = "crm_matter";
    await expect(run(db)).resolves.toEqual({ status: "failed" });
    expect(db.tables.crm_quote[0].matter_id).toBeNull();
    expect(db.tables.crm_quote_event).toHaveLength(0);
  });

  it("keeps the matter when only the timeline rows fail", async () => {
    const db = makeDb();
    db.failInsertTable = "crm_quote_event";
    const result = await run(db);
    expect(result.status).toBe("opened");
    expect(db.tables.crm_quote[0].matter_id).not.toBeNull();
  });

  it("reports an unreachable database as failed, not as a throw", async () => {
    const db = makeDb();
    db.failTable = "crm_quote";
    await expect(run(db)).resolves.toEqual({ status: "failed" });
  });
});
