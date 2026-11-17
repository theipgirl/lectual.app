import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The stage reads and the `phase` column. A database without the column answers 42703 / PGRST204 (judged by CODE), and
 * every read that uses MATTER_STAGE_COLUMNS then falls back to the old columns so nothing else breaks. Any other
 * failure stays a failed read.
 */
type Err = { code: string; message: string } | null;
const h = vi.hoisted(() => ({
  selects: [] as string[],
  phaseError: null as Err,
  otherError: null as Err,
  plainError: null as Err,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({
    from: () => ({
      select: (cols: string) => {
        h.selects.push(cols);
        const result = () => {
          if (h.otherError) return { data: null, error: h.otherError };
          if (!cols.includes("phase") && h.plainError) return { data: null, error: h.plainError };
          if (cols.includes("phase") && h.phaseError) return { data: null, error: h.phaseError };
          const keep = cols.split(",").map((c) => c.trim());
          return { data: h.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.includes(k)))), error: null };
        };
        const chain = {
          order: () => Promise.resolve(result()),
          eq: () => ({ maybeSingle: async () => { const r = result(); return { data: r.data?.[0] ?? null, error: r.error }; } }),
        };
        return chain;
      },
    }),
  })),
}));

const base = { id: "s1", code: "1", label: "One", order_index: 1, is_open: true, waiting_on: "firm", phase: "pre_filing" };
const { loadMatterStages, listMatterStages, MATTER_STAGE_COLUMNS, MATTER_STAGE_COLUMNS_NO_PHASE } = await import("@/lib/matters/stages");

beforeEach(() => {
  h.selects = [];
  h.phaseError = null;
  h.otherError = null;
  h.plainError = null;
  h.rows = [{ ...base }];
});

describe("MATTER_STAGE_COLUMNS", () => {
  it("adds phase to the old columns, and the fallback is exactly the old list", () => {
    expect(MATTER_STAGE_COLUMNS).toBe("id, code, label, order_index, is_open, waiting_on, phase");
    expect(MATTER_STAGE_COLUMNS_NO_PHASE).toBe("id, code, label, order_index, is_open, waiting_on");
  });
});

describe("loadMatterStages", () => {
  it("ok: reads the phase", async () => {
    const r = await loadMatterStages();
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.stages[0].phase).toBe("pre_filing");
  });

  it.each(["42703", "PGRST204"])("not-set-up on %s: falls back to the old columns and carries no phase", async (code) => {
    h.phaseError = { code, message: "anything at all" };
    const r = await loadMatterStages();
    expect(r.status).toBe("not-set-up");
    if (r.status === "not-set-up") {
      expect(r.stages).toHaveLength(1);
      expect(r.stages[0].phase).toBeUndefined();
    }
    expect(h.selects).toEqual([MATTER_STAGE_COLUMNS, MATTER_STAGE_COLUMNS_NO_PHASE]);
  });

  it("does not guess from message text: a missing-column message with another code is a failed read", async () => {
    h.phaseError = { code: "XX000", message: 'column "phase" does not exist' };
    const r = await loadMatterStages();
    expect(r.status).toBe("unavailable");
    expect(h.selects).toEqual([MATTER_STAGE_COLUMNS]);
  });

  it("unavailable on any other failure, never 'no phases'", async () => {
    h.otherError = { code: "XX000", message: "boom" };
    expect((await loadMatterStages()).status).toBe("unavailable");
  });

  it("unavailable when even the fallback read fails", async () => {
    h.phaseError = { code: "42703", message: "x" };
    h.plainError = { code: "XX000", message: "boom" };
    expect((await loadMatterStages()).status).toBe("unavailable");
  });
});

describe("listMatterStages (what listMatters and the board use)", () => {
  it("still returns the stages on a database with no phase column", async () => {
    h.phaseError = { code: "42703", message: "x" };
    const stages = await listMatterStages();
    expect(stages.map((s) => s.id)).toEqual(["s1"]);
  });
  it("still throws on a real failure", async () => {
    h.otherError = { code: "XX000", message: "boom" };
    await expect(listMatterStages()).rejects.toBeTruthy();
  });
});
