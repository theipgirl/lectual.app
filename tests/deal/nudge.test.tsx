import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { dealNudge, NO_NUDGE, type NudgeRead } from "@/lib/deal/nudge";
import { cardsHero } from "@/lib/today/owner-rules";
import { dealReadyLine } from "@/lib/ui/words";
import { qitem, U } from "../queue/routing-fixtures";

const state = vi.hoisted(() => ({ cardState: { status: "ok", events: [] } as unknown, rejectCards: false, rejectZone: false, cardReads: 0 }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/", useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/lib/queue/routing-load", () => ({ loadApprovalRouting: vi.fn(async () => ({ status: "failed" })) }));
vi.mock("@/lib/queue/card-state", () => ({ loadCardState: vi.fn(async () => {
    state.cardReads += 1;
    if (state.rejectCards) throw new Error("boom");
    return state.cardState;
  }) }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => {
    if (state.rejectZone) throw new Error("boom");
    return "America/New_York";
  }) }));
vi.mock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn() }));

const NY = "America/New_York";
const ok = (undecided: number): NudgeRead => ({ status: "ok", undecided });
const at = (iso: string, read: NudgeRead, times?: readonly string[]) => dealNudge({ now: new Date(iso), timeZone: NY, times, read });

describe("dealNudge (defaults 7:00 AM and 2:00 PM, New York)", () => {
  it("before the first deal: no nudge, even with carried-over cards", () => {
    expect(at("2026-11-10T11:59:00Z", ok(4))).toEqual(NO_NUDGE); // 6:59 AM
  });

  it("right at the first deal time: ready, named 7:00 AM", () => {
    expect(at("2026-11-10T12:00:00Z", ok(4))).toEqual({ ready: true, label: "7:00 AM", count: 4 });
  });

  it("between deals: still the 7:00 AM deal", () => {
    expect(at("2026-11-10T17:00:00Z", ok(2))).toEqual({ ready: true, label: "7:00 AM", count: 2 }); // noon
  });

  it("right at the second deal time and after the last deal: the 2:00 PM deal", () => {
    expect(at("2026-11-10T19:00:00Z", ok(3))).toEqual({ ready: true, label: "2:00 PM", count: 3 });
    expect(at("2026-11-11T02:00:00Z", ok(1))).toEqual({ ready: true, label: "2:00 PM", count: 1 }); // 9 PM
  });

  it("zero undecided cards: no nudge", () => {
    expect(at("2026-11-10T20:00:00Z", ok(0))).toEqual(NO_NUDGE);
    expect(at("2026-11-10T20:00:00Z", ok(-1))).toEqual(NO_NUDGE);
    expect(at("2026-11-10T20:00:00Z", ok(Number.NaN))).toEqual(NO_NUDGE);
  });

  it("a failed or unconfigured read gives no nudge, never a 0", () => {
    expect(at("2026-11-10T20:00:00Z", { status: "unavailable" })).toEqual({ ready: false });
    expect(at("2026-11-10T20:00:00Z", { status: "unconfigured" })).toEqual({ ready: false });
  });

  it("uses the person's own times", () => {
    expect(at("2026-11-10T13:30:00Z", ok(2), ["09:00", "15:30"])).toEqual(NO_NUDGE); // 8:30 AM, before 9:00
    expect(at("2026-11-10T14:00:00Z", ok(2), ["09:00", "15:30"])).toEqual({ ready: true, label: "9:00 AM", count: 2 });
  });

  it("DST spring-forward day (Mar 8 2026): the 7:00 AM deal opens at 11:00Z (EDT), not 12:00Z", () => {
    expect(at("2026-03-08T10:59:00Z", ok(2))).toEqual(NO_NUDGE);
    expect(at("2026-03-08T11:00:00Z", ok(2))).toEqual({ ready: true, label: "7:00 AM", count: 2 });
    expect(at("2026-03-08T17:59:00Z", ok(2))).toMatchObject({ label: "7:00 AM" });
    expect(at("2026-03-08T18:00:00Z", ok(2))).toMatchObject({ label: "2:00 PM" });
  });

  it("a deal time skipped by the DST jump opens just after it", () => {
    // 2:30 AM does not exist on Mar 8 in New York: no nudge before the jump, ready once it has passed.
    expect(at("2026-03-08T05:00:00Z", ok(1), ["02:30", "14:00"])).toEqual(NO_NUDGE);
    expect(at("2026-03-08T08:00:00Z", ok(1), ["02:30", "14:00"])).toMatchObject({ ready: true, label: "2:30 AM" });
  });

  it("DST fall-back day (Nov 1 2026): 7:00 AM is EST (12:00Z)", () => {
    expect(at("2026-11-01T11:59:00Z", ok(1))).toEqual(NO_NUDGE);
    expect(at("2026-11-01T12:00:00Z", ok(1))).toMatchObject({ ready: true, label: "7:00 AM" });
  });
});

describe("the words", () => {
  it("say the deal and the count, singular for one", () => {
    expect(dealReadyLine("2:00 PM", 3)).toBe("Your 2:00 PM deal is ready · 3 cards");
    expect(dealReadyLine("7:00 AM", 1)).toBe("Your 7:00 AM deal is ready · 1 card");
  });
});

describe("Today's tile (cardsHero)", () => {
  const summary = { status: "ok" as const, count: 3, minutes: 5, dealLabel: "2:00 PM", nextDealLabel: "7:00 AM", laterArrivals: 0 };

  it("carries the ready line only when the nudge is ready, and nothing else changes", () => {
    const off = cardsHero(summary);
    expect(off.readyLine).toBeNull();
    const on = cardsHero(summary, { ready: true, label: "2:00 PM", count: 3 });
    expect(on.readyLine).toBe("Your 2:00 PM deal is ready · 3 cards");
    expect({ ...on, readyLine: null }).toEqual(off);
    expect(cardsHero(summary, NO_NUDGE)).toEqual(off);
  });

  it("failed, unconfigured and empty states never carry it", () => {
    const ready = { ready: true as const, label: "2:00 PM", count: 3 };
    expect(cardsHero({ status: "unavailable" }, ready).readyLine).toBeNull();
    expect(cardsHero({ status: "unconfigured" }, ready).readyLine).toBeNull();
    expect(cardsHero({ ...summary, count: 0 }, ready).readyLine).toBeNull();
  });
});

describe("rail dot and phone item (owner shell only)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws the dot and the hidden words on the Approvals row, in the owner shell", async () => {
    const { visibleNav } = await import("@/lib/nav");
    const { drawnNav, shellFor } = await import("@/lib/views");
    const { Rail } = await import("@/components/shell/Rail");
    const { MobileBar } = await import("@/components/shell/MobileBar");
    const items = drawnNav(visibleNav(["role-views", "proposals", "mailbox"], "owner"), "owner");
    const shell = shellFor("owner");
    const words = dealReadyLine("2:00 PM", 3);
    const rail = renderToStaticMarkup(<Rail items={items} queueStatus="ok" pendingCount={3} counts={{}} initialPinned tree={shell.tree} variant="owner" dealReady={words} />);
    expect(rail).toContain("lx-ready-dot");
    expect(rail.match(/lx-ready-dot/g)).toHaveLength(1);
    // The words exist once per link (the aria-label); no second hidden copy.
    expect(rail.split(words)).toHaveLength(2);
    // Collapsed rail: the dot is on the icon, in place of the count dot (the open-rail dot is clipped there).
    expect(rail).toMatch(/<span class="lx-rail-icon">(?:(?!<\/span>\s*<span class="lx-rail-label").)*?lx-rail-dot is-ready/s);
    const bar = renderToStaticMarkup(<MobileBar items={items} queueStatus="ok" pendingCount={3} counts={{}} bar={shell.bar} groups={shell.moreGroups} variant="owner" dealReady={words} />);
    expect(bar).toContain("lx-ready-dot--bar");
    expect(bar.split(words)).toHaveLength(2);
  });

  it("draws nothing without the nudge, and nothing in the technician shell even if handed words", async () => {
    const { visibleNav } = await import("@/lib/nav");
    const { Rail } = await import("@/components/shell/Rail");
    const { MobileBar } = await import("@/components/shell/MobileBar");
    const items = visibleNav(["mailbox"], "owner");
    const words = dealReadyLine("2:00 PM", 3);
    for (const dealReady of [null, undefined, words]) {
      const rail = renderToStaticMarkup(<Rail items={items} queueStatus="ok" pendingCount={3} counts={{}} initialPinned variant={undefined} dealReady={dealReady} />);
      const bar = renderToStaticMarkup(<MobileBar items={items} queueStatus="ok" pendingCount={3} counts={{}} variant={undefined} dealReady={dealReady} />);
      expect(rail + bar).not.toContain("lx-ready-dot");
      expect(rail + bar).not.toContain("is-ready");
    }
    const none = renderToStaticMarkup(<Rail items={items} queueStatus="ok" pendingCount={3} counts={{}} initialPinned variant="owner" />);
    expect(none).not.toContain("lx-ready-dot");
  });
});

describe("the layout wires it for the owner shell only", () => {
  it("asks loadDealNudge only inside the owner branch and passes dealReady to both", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/dashboard/layout.tsx", "utf8");
    expect(src).toMatch(/shell\.variant === "owner" \? loadDealNudge\(allQueue/);
    expect(src.match(/dealReady=\{dealReady\}/g)).toHaveLength(2);
  });
});

describe("loadDealNudge", () => {
  const viewer = { userId: U.rebecca, role: "attorney" as const };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T15:00:00Z")); // 10:00 AM New York
  });

  it("counts the viewer's dealt cards from the loaded queue; a later arrival does not count", async () => {
    const { loadDealNudge } = await import("@/lib/queue/deal-nudge-load");
    const load = { status: "ok" as const, items: [qitem({ id: "a", created_at: "2026-11-10T11:00:00Z" }), qitem({ id: "b", created_at: "2026-11-10T13:00:00Z" })] };
    expect(await loadDealNudge(load, viewer, ["07:00", "14:00"])).toEqual({ ready: true, label: "7:00 AM", count: 1 });
    expect(await loadDealNudge({ status: "ok", items: [qitem({ id: "c", created_at: "2026-11-10T13:00:00Z" })] }, viewer, ["07:00", "14:00"])).toEqual(NO_NUDGE);
  });

  it("an empty queue, an unreachable one and a thrown read are all no nudge", async () => {
    const { loadDealNudge } = await import("@/lib/queue/deal-nudge-load");
    expect(await loadDealNudge({ status: "ok", items: [] }, viewer, ["07:00", "14:00"])).toEqual(NO_NUDGE);
    expect(await loadDealNudge({ status: "unavailable", items: [] }, viewer, ["07:00", "14:00"])).toEqual(NO_NUDGE);
    expect(await loadDealNudge({ status: "unconfigured", items: [], reason: "org-key" }, viewer, ["07:00", "14:00"])).toEqual(NO_NUDGE);
    const load = { status: "ok" as const, items: [qitem({ id: "a", created_at: "2026-11-10T11:00:00Z" })] };
    // card events that can't be read deal every card, and a throw is swallowed
    state.cardState = { status: "unavailable" };
    expect((await loadDealNudge(load, viewer, ["07:00", "14:00"])).ready).toBe(true);
  });

  it("an empty queue makes no card-state read", async () => {
    const { loadDealNudge } = await import("@/lib/queue/deal-nudge-load");
    state.cardReads = 0;
    expect(await loadDealNudge({ status: "ok", items: [] }, viewer, ["07:00", "14:00"])).toEqual(NO_NUDGE);
    expect(state.cardReads).toBe(0);
  });

  it("a rejecting card-state or time-zone read is no nudge and does not throw", async () => {
    const { loadDealNudge } = await import("@/lib/queue/deal-nudge-load");
    const load = { status: "ok" as const, items: [qitem({ id: "a", created_at: "2026-11-10T11:00:00Z" })] };
    state.rejectCards = true;
    await expect(loadDealNudge(load, viewer, ["07:00", "14:00"])).resolves.toEqual(NO_NUDGE);
    state.rejectCards = false;
    state.rejectZone = true;
    await expect(loadDealNudge(load, viewer, ["07:00", "14:00"])).resolves.toEqual(NO_NUDGE);
    state.rejectZone = false;
  });
});
