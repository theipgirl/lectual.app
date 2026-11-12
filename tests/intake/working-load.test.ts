import { describe, it, expect } from "vitest";
import {
  ACTIVITY_MAX_PAGES,
  ACTIVITY_PAGE,
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
type Call = { table: string; select: string; in?: [string, readonly string[]]; or?: string; not?: unknown[]; range?: [number, number] };

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

  it("the filter names every real type, a PERSON's stage move, and excludes agent / system / importer moves", () => {
    for (const t of ["email_sent", "email_received", "call_logged", "note", "voice_note"]) expect(REAL_ACTIVITY_FILTER).toContain(t);
    expect(REAL_ACTIVITY_FILTER).toContain("and(type.eq.stage_changed,actor_type.eq.user,payload->>actor.is.null)");
    // Not named anywhere: these never count.
    for (const t of ["lead_created", "ai_insight", "queue_drafted"]) expect(REAL_ACTIVITY_FILTER).not.toContain(t);
    expect(REAL_ACTIVITY_FILTER).not.toMatch(/actor_type\.eq\.(ai|system|automation)/);
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
      readConsults: async () => ({ status: "ok", events: [] }) as never,
      ...over,
    };
  }
  const approvals = { status: "ok", byLead: {} } as const;

  it("fills every source; consults count only future, linked consults", async () => {
    const f = await loadWorkingFacts(
      { leadIds: ["a", "b"], approvals: { status: "ok", byLead: { a: [{} as never] } }, mailboxOn: true },
      deps(
        {
          readProposals: async () => [{ family_id: "f", version: 1, status: "sent", lead_id: "b" }],
          readConsults: async () =>
            ({
              status: "ok",
              events: [
                event("1", "a", "2026-11-13T15:00:00Z"),
                event("2", "b", "2026-11-01T15:00:00Z"),
                event("3", "b", "2026-11-14T15:00:00Z", false),
                event("4", null, "2026-11-14T15:00:00Z"),
              ],
            }) as never,
        },
        (c) => (c.table === "crm_activity" ? { data: [{ lead_id: "a" }], error: null } : { data: [{ lead_id: "b" }], error: null }),
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
      deps(
        {
          readProposals: async () => {
            throw new Error("x");
          },
          readConsults: async () => ({ status: "unavailable" }),
        },
        () => "throw",
      ),
    );
    expect(f.activity).toEqual({ status: "unavailable" });
    expect(f.approvals).toEqual({ status: "unavailable" });
    expect(f.proposals).toEqual({ status: "unavailable" });
    expect(f.consults).toEqual({ status: "unavailable" });
    expect(f.booth).toEqual({ status: "unavailable" });
  });

  it("consults: feature off or no calendar columns is skipped; a full 500-row read is unavailable", async () => {
    let called = 0;
    const off = await loadWorkingFacts(
      { leadIds: ["a"], approvals, mailboxOn: false },
      deps({
        readConsults: async () => {
          called++;
          return { status: "ok", events: [] } as never;
        },
      }),
    );
    expect(off.consults).toEqual({ status: "skipped" });
    expect(called).toBe(0);
    const pre = await loadWorkingFacts({ leadIds: ["a"], approvals, mailboxOn: true }, deps({ readConsults: async () => ({ status: "database-update-needed" }) }));
    expect(pre.consults).toEqual({ status: "skipped" });
    const full = await loadWorkingFacts(
      { leadIds: ["a"], approvals, mailboxOn: true },
      deps({ readConsults: async () => ({ status: "ok", events: Array.from({ length: 500 }, (_, i) => event(String(i), "a", "2026-11-20T00:00:00Z")) }) as never }),
    );
    expect(full.consults).toEqual({ status: "unavailable" });
  });
});
