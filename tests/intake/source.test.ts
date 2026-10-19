import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake scoped client (same chainable-thenable shape as tests/pipeline/leads.test.ts) ──
class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  calls: Array<[string, unknown[]]> = [];
  constructor(private result: { data: unknown; error: unknown }) {}
  select(...a: unknown[]) {
    this.calls.push(["select", a]);
    return this;
  }
  eq(...a: unknown[]) {
    this.calls.push(["eq", a]);
    return this;
  }
  update(...a: unknown[]) {
    this.calls.push(["update", a]);
    return this;
  }
  single() {
    return Promise.resolve(this.result);
  }
  maybeSingle() {
    return Promise.resolve(this.result);
  }
  then<T1 = { data: unknown; error: unknown }, T2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

const state = vi.hoisted(() => ({
  role: "attorney" as string | null,
  /** One result per from() call, in order: [before-read, update]. */
  results: [] as Array<{ data: unknown; error: unknown }>,
  queries: [] as FakeQuery[],
  logActivitySafe: vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {}),
}));

const mockFrom = vi.fn(() => {
  const q = new FakeQuery(state.results.shift() ?? { data: null, error: null });
  state.queries.push(q);
  return q;
});
const mockRpc = vi.fn(() => Promise.resolve({ data: state.role, error: null as unknown }));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({ from: mockFrom, rpc: mockRpc })),
}));
vi.mock("@/lib/matters", () => ({ logActivitySafe: state.logActivitySafe }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setReferralSource } = await import("@/lib/intake/leads");
const { setSourceAction } = await import("@/app/dashboard/intake/actions");
const { isReferralSource, REFERRAL_SOURCES } = await import("@/lib/intake");

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "attorney";
  state.results = [];
  state.queries = [];
});

function updateOf(index: number): Record<string, unknown> {
  const call = state.queries[index].calls.find(([name]) => name === "update");
  return (call?.[1][0] ?? {}) as Record<string, unknown>;
}

describe("isReferralSource", () => {
  it("accepts every bucket and nothing else", () => {
    for (const source of REFERRAL_SOURCES) expect(isReferralSource(source)).toBe(true);
    expect(isReferralSource("Carrier Pigeon")).toBe(false);
    expect(isReferralSource("ugw")).toBe(false);
    expect(isReferralSource("None")).toBe(false);
    expect(isReferralSource("")).toBe(false);
    expect(isReferralSource(null)).toBe(false);
    expect(isReferralSource(undefined)).toBe(false);
    expect(isReferralSource(7)).toBe(false);
  });
});

describe("setReferralSource", () => {
  it("writes the bucket, and logs a from -> to timeline row after the write", async () => {
    state.results = [
      { data: { referral_source: "Inbound" }, error: null },
      { data: [{ id: "lead-1", referral_source: "UGW" }], error: null },
    ];
    const updated = await setReferralSource("lead-1", "UGW");
    expect(updated.referral_source).toBe("UGW");
    expect(updateOf(1).referral_source).toBe("UGW");
    expect(state.logActivitySafe).toHaveBeenCalledWith({
      type: "lead_updated",
      leadId: "lead-1",
      payload: {
        field: "referral_source",
        from: "Inbound",
        to: "UGW",
        summary: "Source set to UGW",
      },
    });
  });

  it("clears with null ('None') and says so on the timeline", async () => {
    state.results = [
      { data: { referral_source: "Event" }, error: null },
      { data: [{ id: "lead-1", referral_source: null }], error: null },
    ];
    await setReferralSource("lead-1", null);
    expect(updateOf(1).referral_source).toBeNull();
    expect(state.logActivitySafe.mock.calls[0][0].payload).toMatchObject({
      to: null,
      summary: "Source cleared",
    });
  });

  it("does not touch referral_detail (the verbatim import text)", async () => {
    state.results = [
      { data: { referral_source: null }, error: null },
      { data: [{ id: "lead-1" }], error: null },
    ];
    await setReferralSource("lead-1", "Instagram");
    expect(Object.keys(updateOf(1)).sort()).toEqual(["referral_source", "updated_at"]);
  });

  it("is a no-op — no update, no timeline row — when the value is unchanged", async () => {
    state.results = [
      { data: { referral_source: "UGW" }, error: null },
      { data: { id: "lead-1", referral_source: "UGW" }, error: null },
    ];
    await setReferralSource("lead-1", "UGW");
    expect(state.queries.some((q) => q.calls.some(([name]) => name === "update"))).toBe(false);
    expect(state.logActivitySafe).not.toHaveBeenCalled();
  });

  it("refuses roles outside CAN_WRITE_LEAD before touching the database", async () => {
    for (const role of ["viewer", "social_media"]) {
      state.role = role;
      await expect(setReferralSource("lead-1", "UGW")).rejects.toThrow();
    }
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuses a value outside REFERRAL_SOURCES even when called directly", async () => {
    await expect(setReferralSource("lead-1", "Carrier Pigeon" as never)).rejects.toThrow(/sources/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("reports a zero-row update (another firm's lead) instead of a green save", async () => {
    state.results = [
      { data: { referral_source: null }, error: null },
      { data: [], error: null },
    ];
    await expect(setReferralSource("lead-x", "UGW")).rejects.toThrow(/no longer exists/);
    expect(state.logActivitySafe).not.toHaveBeenCalled();
  });
});

describe("setSourceAction", () => {
  it("rejects a missing lead and an unknown source with friendly messages, no DB call", async () => {
    expect(await setSourceAction("", "UGW")).toEqual({ ok: false, error: "Missing lead." });
    expect(await setSourceAction("lead-1", "Carrier Pigeon" as never)).toEqual({
      ok: false,
      error: "That isn't one of the sources.",
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns ok for a valid set and for a clear", async () => {
    state.results = [
      { data: { referral_source: null }, error: null },
      { data: [{ id: "lead-1" }], error: null },
    ];
    expect(await setSourceAction("lead-1", "Melanin Money")).toEqual({ ok: true });

    state.results = [
      { data: { referral_source: "Melanin Money" }, error: null },
      { data: [{ id: "lead-1" }], error: null },
    ];
    expect(await setSourceAction("lead-1", null)).toEqual({ ok: true });
  });

  it("turns a role refusal into a friendly message, not a throw", async () => {
    state.role = "viewer";
    const result = await setSourceAction("lead-1", "UGW");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/permission/i);
  });

  it("never leaks a raw database error", async () => {
    state.results = [{ data: null, error: { message: 'relation "crm_lead" secret detail', code: "XX000" } }];
    const result = await setSourceAction("lead-1", "UGW");
    expect(result).toEqual({ ok: false, error: "Couldn't update this lead's source." });
  });
});
