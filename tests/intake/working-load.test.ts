import { describe, it, expect } from "vitest";
import {
  ACTIVITY_MAX_PAGES,
  ACTIVITY_PAGE,
  CONSULT_MAX_PAGES,
  readConsultLeadIds,
  REAL_ACTIVITY_FILTER,
  approvalsFact,
  loadWorkingFacts,
  readBoothLeadIds,
  readRealActivityLeadIds,
  type WorkingDb,
  type WorkingFactsDeps,
} from "@/lib/intake/working-load";

type Row = Record<string, unknown>;
type Page = { data: Row[] | null; error: unknown };
type Call = { table: string; select: string; in?: [string, readonly string[]]; or?: string; not?: unknown[]; eq?: unknown[]; gte?: unknown[]; range?: [number, number] };

/** Fake scoped client: `respond` gets each finished call and returns its page (or "throw"). */
function fakeDb(respond: (c: Call) => Page | "throw") {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      return {
        select(select: string) {
          const call: Call = { table, select };
          const finish = {
            order: () => ({
              range: (a: number, b: number) => {
                call.range = [a, b];
                calls.push(call);
                const r = respond(call);
                return r === "throw" ? Promise.reject(new Error("boom")) : Promise.resolve(r);
              },
            }),
          };
          return {
            in: (col: string, vals: readonly string[]) => {
              call.in = [col, vals];
              return {
                or: (f: string) => {
                  call.or = f;
                  return finish;
                },
              };
            },
            not: (...args: unknown[]) => {
              call.not = args;
              return finish;
            },
            eq: (...args: unknown[]) => {
              call.eq = args;
              return {
                not: (...n: unknown[]) => {
                  call.not = n;
                  return {
                    gte: (...g: unknown[]) => {
                      call.gte = g;
                      return finish;
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as WorkingDb;
  return { db, calls };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `lead-${i}`);

describe("readRealActivityLeadIds", () => {
  it("selects lead_id only, filters to the real types and a person's stage move, and returns distinct ids", async () => {
    const { db, calls } = fakeDb(() => ({ data: [{ lead_id: "lead-1" }, { lead_id: "lead-1" }, { lead_id: "lead-3" }, { lead_id: null }], error: null }));
    const got = await readRealActivityLeadIds(db, ids(5));
    expect([...got].sort()).toEqual(["lead-1", "lead-3"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "crm_activity", select: "lead_id", or: REAL_ACTIVITY_FILTER });
  });

  it("the filter names every real type, mail for any actor, the rest only for a person, and no importer/agent/system shape", () => {
    for (const t of ["email_sent", "email_received", "call_logged", "note", "voice_note"]) expect(REAL_ACTIVITY_FILTER).toContain(t);
    for (const t of ["lead_created", "ai_insight", "queue_drafted"]) expect(REAL_ACTIVITY_FILTER).not.toContain(t);
    expect(REAL_ACTIVITY_FILTER).not.toMatch(/actor_type\.eq\.(ai|system|automation)/);
  });

  // A small evaluator of the PostgREST `or` string over sample rows shaped like the real writers.
  function splitTop(str: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of str) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }
  function evalClause(clause: string, row: Record<string, unknown>): boolean {
    if (clause.startsWith("and(")) return splitTop(clause.slice(4, -1)).every((c) => evalClause(c, row));
    const m = /^(.+?)\.(in|eq|is)\.(.*)$/.exec(clause)!;
    const [, col, op, val] = m;
    const v = col === "payload->>actor" ? (row.payload as Record<string, unknown>)?.actor ?? null : row[col];
    if (op === "in") return val.slice(1, -1).split(",").includes(String(v));
    if (op === "eq") return v === val;
    return val === "null" ? v === null || v === undefined : false;
  }
  const counts = (row: Record<string, unknown>) => splitTop(REAL_ACTIVITY_FILTER).some((c) => evalClause(c, row));
  const R = (type: string, actor_type: string, payload: Record<string, unknown> = {}) => ({ type, actor_type, payload });

  it("pins the real writers' shapes against the filter", () => {
    // Counts: mail from the mailbox sync (system), a person's note / call / voice note, a person's stage move.
    expect(counts(R("email_sent", "system"))).toBe(true);
    expect(counts(R("email_received", "system"))).toBe(true);
    expect(counts(R("note", "user"))).toBe(true);
    expect(counts(R("call_logged", "user"))).toBe(true);
    expect(counts(R("voice_note", "user"))).toBe(true);
    expect(counts(R("stage_changed", "user"))).toBe(true);
    // Does not count: the public intake form's note (system), the importer, the Stage Keeper, the hired sync, automations.
    expect(counts(R("note", "system"))).toBe(false);
    expect(counts(R("lead_created", "system", { source: "lawmatics_import" }))).toBe(false);
    expect(counts(R("stage_changed", "ai", { actor: "agent:stage-keeper" }))).toBe(false);
    expect(counts(R("stage_changed", "user", { actor: "agent:stage-keeper" }))).toBe(false);
    expect(counts(R("stage_changed", "system", { actor: "lawmatics-sync" }))).toBe(false);
    expect(counts(R("stage_changed", "automation"))).toBe(false);
    expect(counts(R("ai_insight", "ai"))).toBe(false);
  });

  it("chunks the lead ids (100 per query) and pages past 1,000 rows", async () => {
    const full = Array.from({ length: ACTIVITY_PAGE }, () => ({ lead_id: "lead-0" }));
    const { db, calls } = fakeDb((c) => {
      if (c.in![1][0] === "lead-100") return { data: [{ lead_id: "lead-100" }], error: null };
      return c.range![0] === 0 ? { data: full, error: null } : { data: [{ lead_id: "lead-2" }], error: null };
    });
    const got = await readRealActivityLeadIds(db, ids(150));
    expect([...got].sort()).toEqual(["lead-0", "lead-100", "lead-2"]);
    // chunk 1: two pages; chunk 2: one page.
    expect(calls.filter((c) => c.in![1].length === 100).map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(calls.filter((c) => c.in![1].length === 50)).toHaveLength(1);
  });

  it("fails (never a partial set) when a page errors, throws, or the page budget runs out", async () => {
    await expect(readRealActivityLeadIds(fakeDb(() => ({ data: null, error: { code: "x" } })).db, ids(3))).rejects.toThrow();
    await expect(readRealActivityLeadIds(fakeDb(() => "throw").db, ids(3))).rejects.toThrow();
    const full = Array.from({ length: ACTIVITY_PAGE }, () => ({ lead_id: "lead-0" }));
    const { db, calls } = fakeDb(() => ({ data: full, error: null }));
    await expect(readRealActivityLeadIds(db, ids(3))).rejects.toThrow(/page budget/);
    expect(calls).toHaveLength(ACTIVITY_MAX_PAGES);
  });

  it("reads nothing for no leads", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    expect((await readRealActivityLeadIds(db, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("readBoothLeadIds", () => {
  it("selects lead_id only, skips null ids and returns distinct leads", async () => {
    const { db, calls } = fakeDb(() => ({ data: [{ lead_id: "a" }, { lead_id: "a" }, { lead_id: "b" }], error: null }));
    expect([...(await readBoothLeadIds(db))].sort()).toEqual(["a", "b"]);
    expect(calls[0]).toMatchObject({ table: "crm_booth_scorecard", select: "lead_id", not: ["lead_id", "is", null] });
  });
  it("fails on an error", async () => {
    await expect(readBoothLeadIds(fakeDb(() => ({ data: null, error: {} })).db)).rejects.toThrow();
  });
});

describe("approvalsFact", () => {
  it("maps the queue's three states", () => {
    expect(approvalsFact({ status: "ok", byLead: { a: [{} as never], b: [] } })).toEqual({ status: "ok", leadIds: new Set(["a"]) });
    expect(approvalsFact({ status: "unconfigured" })).toEqual({ status: "skipped" });
    expect(approvalsFact({ status: "unavailable" })).toEqual({ status: "unavailable" });
  });
});

describe("loadWorkingFacts", () => {
  const NOW = new Date("2026-11-12T12:00:00Z");
  const event = (id: string, lead: string | null, startsAt: string, consult = true) => ({ id, lead_id: lead, starts_at: startsAt, is_consult: consult });
  function deps(over: Partial<WorkingFactsDeps> = {}, respond?: Parameters<typeof fakeDb>[0]): WorkingFactsDeps {
    return {
      db: fakeDb(respond ?? (() => ({ data: [], error: null }))).db,
      now: NOW,
      readProposals: async () => [],
      ...over,
    };
  }
  const approvals = { status: "ok", byLead: {} } as const;

  it("fills every source from its own read", async () => {
    const f = await loadWorkingFacts(
      { leadIds: ["a", "b"], approvals: { status: "ok", byLead: { a: [{} as never] } }, mailboxOn: true },
      deps({ readProposals: async () => [{ family_id: "f", version: 1, status: "sent", lead_id: "b" }] }, (c) =>
        c.table === "crm_activity" ? { data: [{ lead_id: "a" }], error: null } : c.table === "crm_calendar_event" ? { data: [{ lead_id: "a" }, { lead_id: null }], error: null } : { data: [{ lead_id: "b" }], error: null },
      ),
    );
    expect(f.activity).toEqual({ status: "ok", leadIds: new Set(["a"]) });
    expect(f.approvals).toEqual({ status: "ok", leadIds: new Set(["a"]) });
    expect(f.proposals).toEqual({ status: "ok", leadIds: new Set(["b"]) });
    expect(f.consults).toEqual({ status: "ok", leadIds: new Set(["a"]) });
    expect(f.booth).toEqual({ status: "ok", leadIds: new Set(["b"]) });
  });

  it("a failing source is unavailable on its own and never throws", async () => {
    const f = await loadWorkingFacts(
      { leadIds: ["a"], approvals: { status: "unavailable" }, mailboxOn: true },
      deps({ readProposals: async () => { throw new Error("x"); } }, () => "throw"),
    );
    for (const k of ["activity", "proposals", "consults", "booth"] as const) expect(f[k]).toEqual({ status: "unavailable" });
    expect(f.approvals).toEqual({ status: "unavailable" });
  });

  it("consults: its own query (is_consult, linked, from now, lead_id only), never the calendar read", async () => {
    const { db, calls } = fakeDb(() => ({ data: [{ lead_id: "a" }], error: null }));
    expect([...(await readConsultLeadIds(db, NOW))!]).toEqual(["a"]);
    expect(calls[0]).toMatchObject({ table: "crm_calendar_event", select: "lead_id", eq: ["is_consult", true], not: ["lead_id", "is", null], gte: ["starts_at", NOW.toISOString()] });
  });

  it("consults: a busy calendar is paged, not marked unknown; only an exhausted page budget fails", async () => {
    const full = Array.from({ length: ACTIVITY_PAGE }, (_, i) => ({ lead_id: `l${i}` }));
    const paged = fakeDb((c) => (c.range![0] === 0 ? { data: full, error: null } : { data: [{ lead_id: "last" }], error: null }));
    expect((await readConsultLeadIds(paged.db, NOW))!.size).toBe(ACTIVITY_PAGE + 1);
    const endless = fakeDb(() => ({ data: full, error: null }));
    await expect(readConsultLeadIds(endless.db, NOW)).rejects.toThrow(/page budget/);
    expect(endless.calls).toHaveLength(CONSULT_MAX_PAGES);
  });

  it("consults: feature off or no calendar columns is skipped", async () => {
    const off = await loadWorkingFacts({ leadIds: ["a"], approvals, mailboxOn: false }, deps());
    expect(off.consults).toEqual({ status: "skipped" });
    const before = await loadWorkingFacts({ leadIds: ["a"], approvals, mailboxOn: true }, deps({}, (c) => (c.table === "crm_calendar_event" ? { data: null, error: { code: "42703" } } : { data: [], error: null })));
    expect(before.consults).toEqual({ status: "skipped" });
  });
});
