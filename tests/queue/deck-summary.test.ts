import { describe, it, expect, vi, beforeEach } from "vitest";
import { qitem, U } from "./routing-fixtures";

/** Today's "Your cards" read: three states, built from the same deal as the deck, never throws. */

const state = vi.hoisted(() => ({ load: null as unknown, cardState: { status: "ok", events: [] } as unknown, throwQueue: false }));
vi.mock("@/lib/queue/load", () => ({
  loadActiveQueue: vi.fn(async () => {
    if (state.throwQueue) throw new Error("boom");
    return state.load;
  }),
}));
vi.mock("@/lib/queue/routing-load", () => ({ loadApprovalRouting: vi.fn(async () => ({ status: "failed" })) }));
vi.mock("@/lib/queue/card-state", () => ({ loadCardState: vi.fn(async () => state.cardState) }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));

const { loadDeckSummary } = await import("@/lib/queue/deck-summary");
const viewer = { userId: U.rebecca, role: "attorney" as const };

beforeEach(() => {
  state.throwQueue = false;
  state.cardState = { status: "ok", events: [] };
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T15:00:00Z")); // 10:00 AM in New York
});

describe("loadDeckSummary", () => {
  it("counts the dealt cards and the later arrivals", async () => {
    state.load = { status: "ok", items: [qitem({ id: "a", created_at: "2026-11-10T11:00:00Z" }), qitem({ id: "b", created_at: "2026-11-10T13:00:00Z" })] };
    expect(await loadDeckSummary(viewer)).toEqual({ status: "ok", count: 1, minutes: 2, dealLabel: "7:00 AM", nextDealLabel: "2:00 PM", laterArrivals: 1 });
  });

  it("an empty, reached queue is ok with 0", async () => {
    state.load = { status: "ok", items: [] };
    expect(await loadDeckSummary(viewer)).toMatchObject({ status: "ok", count: 0 });
  });

  it("keeps unconfigured and unavailable apart, and never throws", async () => {
    state.load = { status: "unconfigured", reason: "org-key", items: [] };
    expect(await loadDeckSummary(viewer)).toEqual({ status: "unconfigured" });
    state.load = { status: "unavailable", items: [] };
    expect(await loadDeckSummary(viewer)).toEqual({ status: "unavailable" });
    state.throwQueue = true;
    expect(await loadDeckSummary(viewer)).toEqual({ status: "unavailable" });
  });

  it("card events it can't read never lower the count", async () => {
    state.load = { status: "ok", items: [qitem({ id: "a", created_at: "2026-11-10T11:00:00Z" })] };
    state.cardState = { status: "unavailable" };
    expect(await loadDeckSummary(viewer)).toMatchObject({ status: "ok", count: 1 });
  });
});
