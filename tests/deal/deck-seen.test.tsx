import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { DECK_SEEN_KEY, dealNudge, deckSeenStamp, NO_NUDGE, parseDeckSeen, withDeckSeen } from "@/lib/deal/nudge";

const NY = "America/New_York";
// 2:30 PM New York on Nov 10 2026: the 7:00 AM deal opened 12:00Z, the 2:00 PM deal 19:00Z.
const NOW = new Date("2026-11-10T19:30:00Z");
const ok = { status: "ok" as const, undecided: 3 };
const nudge = (seen: Date | null | undefined, now = NOW) => dealNudge({ now, timeZone: NY, read: ok, seen });

describe("dealNudge with the deck-seen stamp", () => {
  it("no stamp: ready", () => {
    expect(nudge(null)).toEqual({ ready: true, label: "2:00 PM", count: 3 });
    expect(nudge(undefined)).toMatchObject({ ready: true });
  });
  it("a stamp from before the current deal opened: ready", () => {
    expect(nudge(new Date("2026-11-10T18:59:59Z"))).toMatchObject({ ready: true, label: "2:00 PM" });
    expect(nudge(new Date("2026-11-09T22:00:00Z"))).toMatchObject({ ready: true });
  });
  it("a stamp at or after the current deal opened: no nudge", () => {
    expect(nudge(new Date("2026-11-10T19:00:00Z"))).toEqual(NO_NUDGE);
    expect(nudge(new Date("2026-11-10T19:10:00Z"))).toEqual(NO_NUDGE);
  });
  it("opened at the 7 AM deal, the 2 PM deal is a new one again", () => {
    const seen = new Date("2026-11-10T13:00:00Z");
    expect(nudge(seen, new Date("2026-11-10T17:00:00Z"))).toEqual(NO_NUDGE);
    expect(nudge(seen)).toMatchObject({ ready: true, label: "2:00 PM" });
  });
  // Changed on purpose: a far-future stamp used to hide the dot for good; now it counts as no stamp (the open then rewrites it).
  it("a stamp more than 5 minutes in the future counts as no stamp: ready", () => {
    expect(nudge(new Date("2027-01-01T00:00:00Z"))).toMatchObject({ ready: true });
    expect(nudge(new Date(NOW.getTime() + 5 * 60_000 + 1))).toMatchObject({ ready: true });
  });
  it("a stamp up to 5 minutes ahead of now (small skew) still counts", () => {
    expect(nudge(new Date(NOW.getTime() + 5 * 60_000))).toEqual(NO_NUDGE);
  });
  it("the other rules still hold with a usable stamp or none", () => {
    expect(dealNudge({ now: NOW, timeZone: NY, read: { status: "ok", undecided: 0 }, seen: null })).toEqual(NO_NUDGE);
    expect(dealNudge({ now: NOW, timeZone: NY, read: { status: "unavailable" }, seen: null })).toEqual(NO_NUDGE);
    expect(dealNudge({ now: new Date("2026-11-10T11:00:00Z"), timeZone: NY, read: ok, seen: null })).toEqual(NO_NUDGE);
  });
});

describe("the stored stamp", () => {
  it("parses an ISO string and treats anything else as none (a malformed stamp is no stamp)", () => {
    expect(parseDeckSeen({ [DECK_SEEN_KEY]: "2026-11-10T19:10:00.000Z" })?.toISOString()).toBe("2026-11-10T19:10:00.000Z");
    for (const bad of [{ [DECK_SEEN_KEY]: "not a date" }, { [DECK_SEEN_KEY]: 12345 }, { [DECK_SEEN_KEY]: null }, { [DECK_SEEN_KEY]: {} }, {}, null, undefined, "x"]) {
      expect(parseDeckSeen(bad)).toBeNull();
    }
  });
  it("a stamp over 40 characters or not ISO-shaped is no stamp", () => {
    expect(parseDeckSeen({ [DECK_SEEN_KEY]: "2026-11-10T19:10:00.000Z" + "0".repeat(20) })).toBeNull();
    expect(parseDeckSeen({ [DECK_SEEN_KEY]: "Nov 10 2026 7:10 PM" })).toBeNull();
    expect(parseDeckSeen({ [DECK_SEEN_KEY]: "1762801800000" })).toBeNull();
    expect(parseDeckSeen({ [DECK_SEEN_KEY]: "2026-11-10" })).toBeNull();
  });
  it("a malformed stamp leaves the nudge on and allows the write", () => {
    const meta = { [DECK_SEEN_KEY]: "garbage" };
    expect(nudge(parseDeckSeen(meta))).toMatchObject({ ready: true });
    expect(deckSeenStamp({ now: NOW, timeZone: NY, meta })).toEqual(NOW);
  });
  it("withDeckSeen merges: every other key is kept", () => {
    const meta = { full_name: "Rebecca Ames", lectual_tour: { version: 1 }, lectual_deal_times: { v: 1, times: ["08:00", "15:00"] } };
    const out = withDeckSeen(meta, NOW);
    expect(out).toEqual({ ...meta, [DECK_SEEN_KEY]: "2026-11-10T19:30:00.000Z" });
    expect(meta).not.toHaveProperty(DECK_SEEN_KEY);
    expect(withDeckSeen(null, NOW)).toEqual({ [DECK_SEEN_KEY]: "2026-11-10T19:30:00.000Z" });
  });
});

describe("the stamp gate (at most two writes a day)", () => {
  it("writes when there is no stamp or it is older than the current deal", () => {
    expect(deckSeenStamp({ now: NOW, timeZone: NY, meta: {} })).toEqual(NOW);
    expect(deckSeenStamp({ now: NOW, timeZone: NY, meta: { [DECK_SEEN_KEY]: "2026-11-10T13:00:00.000Z" } })).toEqual(NOW);
  });
  it("writes nothing when the stored stamp is already after the current deal opened", () => {
    expect(deckSeenStamp({ now: NOW, timeZone: NY, meta: { [DECK_SEEN_KEY]: "2026-11-10T19:05:00.000Z" } })).toBeNull();
    expect(deckSeenStamp({ now: NOW, timeZone: NY, meta: { [DECK_SEEN_KEY]: "2026-11-10T19:00:00.000Z" } })).toBeNull();
  });
  it("a future stamp (beyond 5 minutes) is rewritten", () => {
    expect(deckSeenStamp({ now: NOW, timeZone: NY, meta: { [DECK_SEEN_KEY]: "2027-01-01T00:00:00.000Z" } })).toEqual(NOW);
  });
  it("writes nothing before today's first deal", () => {
    expect(deckSeenStamp({ now: new Date("2026-11-10T11:00:00Z"), timeZone: NY, meta: {} })).toBeNull();
  });
  it("uses the person's own times", () => {
    expect(deckSeenStamp({ now: new Date("2026-11-10T13:30:00Z"), timeZone: NY, times: ["09:00", "15:30"], meta: {} })).toBeNull(); // 8:30 AM
    expect(deckSeenStamp({ now: new Date("2026-11-10T14:30:00Z"), timeZone: NY, times: ["09:00", "15:30"], meta: {} })).toBeTruthy();
  });
});

const h = vi.hoisted(() => ({
  user: null as unknown,
  updateUser: vi.fn(),
  authError: null as unknown,
  throwClient: false,
  session: null as unknown,
  throwSession: false,
  feature: true,
}));
vi.mock("@/lib/firm/session", () => ({
  resolveFirmSession: async () => {
    if (h.throwSession) throw new Error("boom");
    return h.session;
  },
}));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: async () => h.feature }));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => {
    if (h.throwClient) throw new Error("boom");
    return { auth: { getUser: async () => ({ data: { user: h.user }, error: h.authError }), updateUser: h.updateUser } };
  },
}));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));

describe("markDeckSeenAction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    h.updateUser.mockReset().mockResolvedValue({ error: null });
    h.authError = null;
    h.throwClient = false;
    h.throwSession = false;
    h.feature = true;
    h.user = { user_metadata: { full_name: "Rebecca", lectual_deal_times: { v: 1, times: ["07:00", "14:00"] } } };
    h.session = { kind: "ok", actingAsStaff: false, get user() { return h.user; } };
  });

  it("writes the stamp, keeping every other metadata key", async () => {
    const { markDeckSeenAction } = await import("@/lib/account/deck-seen-actions");
    expect(await markDeckSeenAction()).toEqual({ wrote: true });
    expect(h.updateUser).toHaveBeenCalledTimes(1);
    expect(h.updateUser).toHaveBeenCalledWith({ data: { full_name: "Rebecca", lectual_deal_times: { v: 1, times: ["07:00", "14:00"] }, [DECK_SEEN_KEY]: NOW.toISOString() } });
  });

  it("does not write when the stored stamp is already after the deal opened", async () => {
    const { markDeckSeenAction } = await import("@/lib/account/deck-seen-actions");
    h.user = { user_metadata: { [DECK_SEEN_KEY]: "2026-11-10T19:05:00.000Z" } };
    expect(await markDeckSeenAction()).toEqual({ wrote: false });
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("refuses, writing nothing: no session, signed out, no firm access, Lectual staff acting in a firm, role-views off, a throwing session read", async () => {
    const { markDeckSeenAction } = await import("@/lib/account/deck-seen-actions");
    const refused = async () => {
      expect(await markDeckSeenAction()).toEqual({ wrote: false });
      expect(h.updateUser).not.toHaveBeenCalled();
    };
    h.session = { kind: "signed-out", redirectTo: "/sign-in" };
    await refused();
    h.session = { kind: "no-access", user: h.user };
    await refused();
    h.session = null;
    await refused();
    h.session = { kind: "ok", actingAsStaff: true, user: h.user };
    await refused();
    h.session = { kind: "ok", actingAsStaff: false, user: h.user };
    h.feature = false;
    await refused();
    h.feature = true;
    h.throwSession = true;
    await refused();
  });

  it("a stored stamp far in the future is rewritten", async () => {
    const { markDeckSeenAction } = await import("@/lib/account/deck-seen-actions");
    h.user = { user_metadata: { [DECK_SEEN_KEY]: "2027-01-01T00:00:00.000Z" } };
    expect(await markDeckSeenAction()).toEqual({ wrote: true });
    expect(h.updateUser).toHaveBeenCalledWith({ data: { [DECK_SEEN_KEY]: NOW.toISOString() } });
  });

  it("fails quietly: update error, thrown client", async () => {
    const { markDeckSeenAction } = await import("@/lib/account/deck-seen-actions");
    h.user = { user_metadata: {} };
    h.updateUser.mockResolvedValue({ error: new Error("x") });
    expect(await markDeckSeenAction()).toEqual({ wrote: false });
    h.throwClient = true;
    expect(await markDeckSeenAction()).toEqual({ wrote: false });
  });

  it("takes no argument from the browser", () => {
    const src = readFileSync("src/lib/account/deck-seen-actions.ts", "utf8");
    expect(src).toMatch(/markDeckSeenAction\(\): Promise/);
    expect(src).not.toMatch(/getAdminClient/);
    expect(src).toMatch(/resolveFirmSession\(\)/);
    expect(src).toMatch(/actingAsStaff/);
    expect(src).toMatch(/orgHasModule\("role-views"\)/);
  });
});

describe("wiring", () => {
  it("the deck page mounts the stamp only after an ok load, in the owner's shell and not for staff; the mark runs in an effect", () => {
    const view = readFileSync("src/app/dashboard/queue/deck/deck-view.tsx", "utf8");
    expect(view).toMatch(/!actingAsStaff && canChangeDealTimes \? <DeckSeenMark \/> : null/);
    expect(view.match(/<DeckSeenMark/g)).toHaveLength(1);
    // Used once, inside the ok-load frame, after the unavailable early return.
    expect(view.match(/\{seenMark\}/g)).toHaveLength(1);
    expect(view.indexOf("{seenMark}")).toBeGreaterThan(view.indexOf('if (load.status !== "ok")'));
    const unavailable = view.slice(view.indexOf('if (load.status !== "ok")'), view.indexOf("const [routed"));
    expect(unavailable).not.toContain("seenMark");
    const mark = readFileSync("src/components/deck/DeckSeenMark.tsx", "utf8");
    expect(mark).toMatch(/useEffect\(\(\) => \{[\s\S]*markDeckSeenAction\(\)/);
  });

  it("the layout and Today give the rule the stored stamp; the technician shell never reads it", () => {
    const layout = readFileSync("src/app/dashboard/layout.tsx", "utf8");
    expect(layout).toMatch(/shell\.variant === "owner" \? loadDealNudge\([^\n]*parseDeckSeen\(user\.user_metadata\)/);
    expect(readFileSync("src/components/today/OwnerToday.tsx", "utf8")).toMatch(/seen: parseDeckSeen\(metadata\)/);
  });

  it("loadDealNudge passes the stamp through: a seen deal gives no nudge", async () => {
    vi.doMock("@/lib/queue/routing-load", () => ({ loadApprovalRouting: async () => ({ status: "failed" }) }));
    vi.doMock("@/lib/queue/card-state", () => ({ loadCardState: async () => ({ status: "ok", events: [] }) }));
    const { loadDealNudge } = await import("@/lib/queue/deal-nudge-load");
    const { qitem, U } = await import("../queue/routing-fixtures");
    const viewer = { userId: U.rebecca, role: "attorney" as const };
    const load = { status: "ok" as const, items: [qitem({ id: "a", created_at: "2026-11-10T11:00:00Z" })] };
    expect(await loadDealNudge(load, viewer, ["07:00", "14:00"], null)).toMatchObject({ ready: true });
    expect(await loadDealNudge(load, viewer, ["07:00", "14:00"], new Date("2026-11-10T19:05:00Z"))).toEqual(NO_NUDGE);
  });
});
