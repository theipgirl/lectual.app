import { describe, it, expect, vi } from "vitest";

/** passingSwitchedOn (card-state.ts): `no` whenever a pass would fall back to the approver's own Outlook. */
const state = vi.hoisted(() => ({ error: null as unknown, throws: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => {
    if (state.throws) throw new Error("no session");
    const q = { select: () => q, limit: async () => ({ data: [], error: state.error }) };
    return { from: () => q };
  }),
}));
const { passingSwitchedOn } = await import("@/lib/queue/card-state");

describe("passingSwitchedOn", () => {
  it.each([
    [null, "yes"],
    [{ code: "42703", message: "column queue_card_event.attempt does not exist" }, "no"],
    [{ code: "PGRST204", message: "attempt" }, "no"],
    [{ code: "42P01", message: "relation does not exist" }, "no"],
    [{ code: "PGRST205", message: "table not found" }, "no"],
    [{ code: "500", message: "boom" }, "unknown"],
  ])("%j -> %s", async (error, want) => {
    state.throws = false;
    state.error = error;
    expect(await passingSwitchedOn()).toBe(want);
  });
  it("a thrown read is unknown", async () => {
    state.throws = true;
    expect(await passingSwitchedOn()).toBe("unknown");
  });
});
