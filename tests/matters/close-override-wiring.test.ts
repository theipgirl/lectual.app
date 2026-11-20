import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };
/** A scripted scoped client: each from() takes the next queued result; every chain call is recorded. */
class Q implements PromiseLike<Result> {
  calls: Array<[string, unknown[]]> = [];
  constructor(public table: string, private result: Result) {}
  private rec(name: string, a: unknown[]) {
    this.calls.push([name, a]);
    return this;
  }
  select(...a: unknown[]) { return this.rec("select", a); }
  update(...a: unknown[]) { return this.rec("update", a); }
  insert(...a: unknown[]) { return this.rec("insert", a); }
  eq(...a: unknown[]) { return this.rec("eq", a); }
  limit(...a: unknown[]) { return this.rec("limit", a); }
  single() { return Promise.resolve(this.result); }
  maybeSingle() { return Promise.resolve(this.result); }
  then<A = Result, B = never>(f?: ((v: Result) => A | PromiseLike<A>) | null, r?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.result).then(f, r);
  }
}

const s = vi.hoisted(() => ({
  role: "attorney" as string | null,
  override: { data: null, error: null } as unknown,
  overrideThrows: false,
  queue: [] as Result[],
  qs: [] as unknown[],
}));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({
    from: (table: string) => {
      const q = new Q(table, s.queue.shift() ?? { data: null, error: null });
      s.qs.push(q);
      return q;
    },
    rpc: vi.fn(async (name: string) => {
      if (name === "current_org_role") return { data: s.role, error: null };
      if (name === "crm_close_matter_with_override") {
        if (s.overrideThrows) throw new Error("network");
        return s.override;
      }
      return { data: null, error: { message: "unknown" } };
    }),
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } }, error: null }) },
  })),
}));

const { closeMatterWithOverride } = await import("@/lib/matters/matters");

const matterOpen: Result = { data: { type: "TM", status: "open" }, error: null };
const oneOpen: Result = { data: [{ id: "d1", kind: "other", title: "Note to file", due_date: "2026-12-01", status: "open" }], error: null };
const qs = () => s.qs as Q[];
const updates = () => qs().filter((q) => q.calls.some(([n]) => n === "update"));

beforeEach(() => {
  s.role = "attorney";
  s.override = { data: null, error: null };
  s.overrideThrows = false;
  s.queue = [];
  s.qs = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("closeMatterWithOverride wiring: the rpc's error codes", () => {
  it("42501 from the function is the role refusal, nothing else is written", async () => {
    s.queue = [matterOpen, oneOpen];
    s.override = { data: null, error: { code: "42501", message: "matter_close_override_not_allowed" } };
    expect(await closeMatterWithOverride("m1", "Reason")).toEqual({ ok: false, error: "Only an attorney can close a matter that still has an open deadline." });
    expect(updates()).toHaveLength(0);
  });

  it("any other code, or a thrown call, is 'couldn't close', nothing written", async () => {
    for (const setup of [() => (s.override = { data: null, error: { code: "P0002", message: "x" } }), () => (s.overrideThrows = true)]) {
      s.queue = [matterOpen, oneOpen];
      s.qs = [];
      s.overrideThrows = false;
      setup();
      expect(await closeMatterWithOverride("m1", "Reason")).toEqual({ ok: false, error: "Couldn't close this matter. Nothing was changed. Try again." });
      expect(updates()).toHaveLength(0);
    }
  });

  it("missing function (PGRST202 / 42883) and a plain close that touched 0 rows: 'couldn't close', no timeline row", async () => {
    for (const code of ["PGRST202", "42883"]) {
      s.qs = [];
      s.queue = [matterOpen, oneOpen, { data: [], error: null }];
      s.override = { data: null, error: { code, message: "missing" } };
      expect(await closeMatterWithOverride("m1", "Reason")).toEqual({ ok: false, error: "Couldn't close this matter. Nothing was changed. Try again." });
      expect(qs().some((q) => q.table === "crm_activity")).toBe(false);
    }
  });

  it("missing function, the timeline row fails, the restore is fenced on status = closed and succeeds: not recorded, put back", async () => {
    s.override = { data: null, error: { code: "PGRST202", message: "missing" } };
    // read matter, read deadlines, close (1 row), logActivity's org read FAILS, restore (1 row)
    s.queue = [matterOpen, oneOpen, { data: [{ id: "m1" }], error: null }, { data: null, error: { code: "XX000" } }, { data: [{ id: "m1" }], error: null }];
    expect(await closeMatterWithOverride("m1", "Reason")).toEqual({ ok: false, error: "Couldn't record the reason, so the matter wasn't closed. Try again." });
    const restore = updates()[1];
    expect(restore.calls).toContainEqual(["eq", ["status", "closed"]]);
    expect((restore.calls.find(([n]) => n === "update")![1][0] as { status: string }).status).toBe("open");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("missing function, the timeline row fails and the restore finds 0 rows (or errors): the distinct sentence, matter id logged only", async () => {
    for (const restore of [{ data: [], error: null }, { data: null, error: { code: "XX000" } }]) {
      s.qs = [];
      (console.error as unknown as { mockClear(): void }).mockClear();
      s.override = { data: null, error: { code: "PGRST202", message: "missing" } };
      s.queue = [matterOpen, oneOpen, { data: [{ id: "m1" }], error: null }, { data: null, error: { code: "XX000" } }, restore];
      expect(await closeMatterWithOverride("m1", "Secret reason text")).toEqual({ ok: false, error: "The matter was closed, but the reason couldn't be recorded. Tell Lectual." });
      expect(console.error).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
      expect(logged).toContain("m1");
      expect(logged).not.toContain("Secret");
    }
  });
});
