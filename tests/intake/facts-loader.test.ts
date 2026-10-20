import { describe, it, expect, vi } from "vitest";
import type { Lead, Stage } from "@/lib/pipeline";
import { loadTemperatureFacts, type FactsDb } from "@/lib/intake/facts";
import { buildIntakeRows } from "@/lib/intake/rows";

const NOW = new Date("2026-10-20T12:00:00.000Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

type Row = Record<string, unknown>;
type Tables = Record<string, Row[] | { error: unknown } | "throw">;

/** A read-only fake: records every call, filters by in()/eq(), pages with range(). */
function fakeDb(tables: Tables) {
  const calls: string[] = [];
  const db: FactsDb = {
    from(table: string) {
      calls.push(`from:${table}`);
      const filters: Array<(r: Row) => boolean> = [];
      let slice: [number, number] | null = null;
      const q: any = {
        select: () => (calls.push("select"), q),
        in: (col: string, vals: readonly unknown[]) => (calls.push("in"), filters.push((r) => vals.includes(r[col])), q),
        eq: (col: string, val: unknown) => (calls.push("eq"), filters.push((r) => r[col] === val), q),
        order: () => (calls.push("order"), q),
        range: (a: number, b: number) => (calls.push("range"), (slice = [a, b]), q),
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
          const t = tables[table];
          if (t === "throw") return Promise.reject(new Error("boom")).then(ok, bad);
          if (t && !Array.isArray(t)) return Promise.resolve({ data: null, error: t.error }).then(ok, bad);
          const rows = (t ?? []).filter((r) => filters.every((f) => f(r)));
          const data = slice ? rows.slice(slice[0], slice[1] + 1) : rows;
          return Promise.resolve({ data, error: null }).then(ok, bad);
        },
      };
      return q;
    },
  };
  return { db, calls };
}

const stages = [
  { id: "open", category: "open" },
  { id: "won", category: "won" },
] as Pick<Stage, "id" | "category">[];

const lead = (id: string, extra: Partial<Lead> = {}) =>
  ({ id, current_stage_id: "open", stage_entered_at: daysBefore(30), last_inbound_at: null, ...extra }) as Pick<
    Lead,
    "id" | "current_stage_id" | "stage_entered_at" | "last_inbound_at"
  >;

const threeEmails = ["a", "b", "c"].map((id) => ({ id, sequence_id: "seq-3", type: "email" }));
const baseTables = (): Tables => ({
  crm_drip_step: [...threeEmails, { id: "d", sequence_id: "seq-2", type: "email" }, { id: "e", sequence_id: "seq-2", type: "email" }],
  crm_drip_enrollment: [],
  crm_meeting: [],
  crm_discovery_session: [],
  crm_activity: [],
});

describe("loadTemperatureFacts", () => {
  it("a completed enrolment in a 3-email sequence with no later inbound gives sequenceEndedNoReplyAt", async () => {
    const t = baseTables();
    t.crm_drip_enrollment = [
      { id: "e1", lead_id: "L1", sequence_id: "seq-3", status: "completed", enrolled_at: daysBefore(9), completed_at: daysBefore(2) },
    ];
    const { db } = fakeDb(t);
    const read = await loadTemperatureFacts([lead("L1")], stages, db);
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(read.byLead.L1.sequenceEndedNoReplyAt).toBe(daysBefore(2));
  });

  it("a 2-email sequence, a stopped enrolment and an enrolment followed by an inbound each give no such fact", async () => {
    const t = baseTables();
    t.crm_drip_enrollment = [
      { id: "e1", lead_id: "L1", sequence_id: "seq-2", status: "completed", enrolled_at: daysBefore(9), completed_at: daysBefore(2) },
      { id: "e2", lead_id: "L2", sequence_id: "seq-3", status: "stopped", enrolled_at: daysBefore(9), completed_at: null },
      { id: "e3", lead_id: "L3", sequence_id: "seq-3", status: "completed", enrolled_at: daysBefore(9), completed_at: daysBefore(2) },
    ];
    const { db } = fakeDb(t);
    const read = await loadTemperatureFacts(
      [lead("L1"), lead("L2"), lead("L3", { last_inbound_at: daysBefore(5) })],
      stages,
      db,
    );
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    for (const id of ["L1", "L2", "L3"]) expect(read.byLead[id]?.sequenceEndedNoReplyAt ?? null).toBeNull();
    // They still have a first touch from the enrolment itself.
    expect(read.byLead.L2.firstTouchAt).toBe(daysBefore(9));
  });

  it("an inbound at or before enrolment does not block the fact", async () => {
    const t = baseTables();
    t.crm_drip_enrollment = [
      { id: "e1", lead_id: "L1", sequence_id: "seq-3", status: "completed", enrolled_at: daysBefore(9), completed_at: daysBefore(2) },
    ];
    const { db } = fakeDb(t);
    const read = await loadTemperatureFacts([lead("L1", { last_inbound_at: daysBefore(12) })], stages, db);
    if (read.status === "ok") expect(read.byLead.L1.sequenceEndedNoReplyAt).toBe(daysBefore(2));
    else throw new Error("unavailable");
  });

  it("bookedAt takes the newest of a linked meeting, a booked_lss session and a won stage", async () => {
    const t = baseTables();
    t.crm_meeting = [{ id: "m", lead_id: "L1", started_at: daysBefore(6) }];
    t.crm_discovery_session = [
      { id: "s1", lead_id: "L1", started_at: daysBefore(4), outcome: "booked_lss" },
      { id: "s2", lead_id: "L1", started_at: daysBefore(1), outcome: "no_show" },
    ];
    const { db } = fakeDb(t);

    const a = await loadTemperatureFacts([lead("L1", { current_stage_id: "won", stage_entered_at: daysBefore(2) })], stages, db);
    if (a.status !== "ok") throw new Error("unavailable");
    expect(a.byLead.L1.bookedAt).toBe(daysBefore(2)); // won stage is newest
    const b = await loadTemperatureFacts([lead("L1")], stages, db);
    if (b.status !== "ok") throw new Error("unavailable");
    expect(b.byLead.L1.bookedAt).toBe(daysBefore(4)); // the no_show session is not a booking
  });

  it("firstTouchAt is the earliest of activity and enrolment times, and absent when neither exists", async () => {
    const t = baseTables();
    t.crm_activity = [
      { id: "a1", lead_id: "L1", created_at: daysBefore(8), type: "email_sent" },
      { id: "a2", lead_id: "L1", created_at: daysBefore(3), type: "call_logged" },
      { id: "a3", lead_id: "L1", created_at: daysBefore(20), type: "note" }, // not outreach
    ];
    t.crm_drip_enrollment = [
      { id: "e1", lead_id: "L1", sequence_id: "seq-2", status: "active", enrolled_at: daysBefore(11), completed_at: null },
    ];
    const { db } = fakeDb(t);
    const read = await loadTemperatureFacts([lead("L1"), lead("L2")], stages, db);
    if (read.status !== "ok") throw new Error("unavailable");
    expect(read.byLead.L1.firstTouchAt).toBe(daysBefore(11));
    expect(read.byLead.L2).toBeUndefined();
  });

  it("an enrolment read that returns an error is unavailable, with no facts and no exception", async () => {
    const t = baseTables();
    t.crm_drip_enrollment = { error: { message: "rls" } };
    t.crm_activity = [{ id: "a1", lead_id: "L1", created_at: daysBefore(20), type: "email_sent" }];
    const { db } = fakeDb(t);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const read = await loadTemperatureFacts([lead("L1")], stages, db);
    expect(read).toEqual({ status: "unavailable" });
    warn.mockRestore();
  });

  it("a read that throws behaves the same way", async () => {
    const t = baseTables();
    t.crm_meeting = "throw";
    const { db } = fakeDb(t);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(loadTemperatureFacts([lead("L1")], stages, db)).resolves.toEqual({ status: "unavailable" });
    warn.mockRestore();
  });

  it("only reads: select, in, eq, order and range", async () => {
    const t = baseTables();
    t.crm_drip_enrollment = [
      { id: "e1", lead_id: "L1", sequence_id: "seq-3", status: "completed", enrolled_at: daysBefore(9), completed_at: daysBefore(2) },
    ];
    const { db, calls } = fakeDb(t);
    await loadTemperatureFacts([lead("L1")], stages, db);
    const verbs = new Set(calls.filter((c) => !c.startsWith("from:")));
    for (const verb of verbs) expect(["select", "in", "eq", "order", "range"]).toContain(verb);
    expect(calls.filter((c) => c.startsWith("from:")).every((c) => /crm_(drip_enrollment|drip_step|meeting|discovery_session|activity)$/.test(c))).toBe(true);
  });

  it("pages past 1000 rows instead of truncating", async () => {
    const t = baseTables();
    t.crm_activity = Array.from({ length: 1500 }, (_, i) => ({
      id: `a${String(i).padStart(4, "0")}`,
      lead_id: "L1",
      created_at: i === 1400 ? daysBefore(40) : daysBefore(2),
      type: "email_sent",
    }));
    const { db } = fakeDb(t);
    const read = await loadTemperatureFacts([lead("L1")], stages, db);
    if (read.status !== "ok") throw new Error("unavailable");
    expect(read.byLead.L1.firstTouchAt).toBe(daysBefore(40));
  });

  it("no leads is ok and reads nothing", async () => {
    const { db, calls } = fakeDb(baseTables());
    expect(await loadTemperatureFacts([], stages, db)).toEqual({ status: "ok", byLead: {} });
    expect(calls).toEqual([]);
  });
});

describe("buildIntakeRows with and without facts", () => {
  const l = {
    id: "L1",
    org_id: "o",
    first_name: "Ana",
    last_name: "Ruiz",
    email: "a@x.test",
    current_stage_id: "open",
    stage_entered_at: daysBefore(12),
    temperature: null,
    assigned_to: null,
    last_activity_at: null,
    last_outbound_at: daysBefore(3),
    last_inbound_at: null,
  } as unknown as Lead;
  const st = [{ id: "open", name: "Follow-Up", category: "open", order_index: 1, aging_threshold_days: 7 }] as unknown as Stage[];

  it("an unavailable read (no factsByLeadId) returns today's temperatures, with no invented cold", () => {
    const [row] = buildIntakeRows({ leads: [l], stages: st, members: [], now: NOW });
    expect(row.temperature.level).toBe("warm");
    expect(row.facts).toBeUndefined();
    expect("suggestion" in row.temperature).toBe(false);
  });

  it("facts reach deriveTemperature and are kept on the row for client re-derivation", () => {
    const facts = { firstTouchAt: daysBefore(11), bookedAt: null };
    const [row] = buildIntakeRows({ leads: [l], stages: st, members: [], factsByLeadId: { L1: facts }, now: NOW });
    expect(row.temperature.suggestion).toBe("long_term_nurture");
    expect(row.facts).toEqual(facts);
  });
});
