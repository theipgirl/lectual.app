import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth/actions", () => ({ signOutAction: async () => {}, switchFirmAction: async () => ({}) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/queue/", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { visibleNav, railGroups, mobileBarItems } from "@/lib/nav";
import { Rail } from "@/components/shell/Rail";
import { MobileBar } from "@/components/shell/MobileBar";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { DECK_PATH, drawnNav, railTreeFor, shellFor } from "@/lib/views";
import { guideFor } from "@/lib/onboarding/welcome-deal";
import { buildDeck, type CardState } from "@/lib/queue/deck";
import { DEFAULT_DEAL_TIMES } from "@/lib/deal/times";
import { parseDealTimes, withDealTimes } from "@/lib/deal/person-times";
import { followup, qitem, U } from "../queue/routing-fixtures";

const ALL = ["mailbox", "agents", "proposals", "document-center", "agent-toolkit", "role-views"];
const base = { queueStatus: "ok" as const, pendingCount: 3, counts: {} };
const menuProps = { initials: "AB", name: "Ann B", email: "a@firm.test", role: "paralegal", firmName: "Firm", activeOrgId: "o1", switchableFirms: [] };
const READY = "Your 2:00 PM deal is ready · 3 cards";

describe("team Approvals opens the deck", () => {
  const drawn = drawnNav(visibleNav(ALL, "paralegal"), "team");

  it("rail and phone bar link Approvals to the deck, and the list path still lights it", () => {
    const groups = railGroups(drawn, "/dashboard/queue/", railTreeFor("team")!);
    const queue = groups[0].find((e) => e.label === "Approvals")!;
    expect(queue).toMatchObject({ href: DECK_PATH, active: true, countKey: "queue" });
    expect(railGroups(drawn, "/dashboard/queue/deck/", railTreeFor("team")!)[0].find((e) => e.label === "Approvals")!.active).toBe(true);
    const bar = mobileBarItems(drawn, "/dashboard/queue/", shellFor("team").bar).find((i) => i.label === "Approvals")!;
    expect(bar).toMatchObject({ href: DECK_PATH, active: true });
  });

  it("the technician list, viewer and social media keep the list", () => {
    const items = visibleNav(ALL, "paralegal");
    expect(drawnNav(items, "technician")).toBe(items);
    for (const role of ["viewer", "social_media"] as const) {
      const v = drawnNav(visibleNav(ALL, role), "technician");
      expect(v.find((i) => i.slug === "queue")?.href ?? "/dashboard/queue/").not.toBe(DECK_PATH);
    }
  });
});

describe("the deck for staff roles", () => {
  const ok = (events: never[] = []): CardState => ({ status: "ok", events });
  const caitlyn = { userId: U.caitlyn, role: "paralegal" as const };
  const run = (items: ReturnType<typeof qitem>[], routing = {}, cardState: CardState = ok()) =>
    buildDeck({ items, routing, viewer: caitlyn, cardState, trust: { status: "unknown" }, now: new Date("2026-11-10T15:00:00Z"), dealtAt: null });

  it("a routable item routed to the person has a Yes; an attorney-only one is not on a non-approver's deck", () => {
    const d = run([followup({ id: "fu" }), qitem({ id: "pc" })], { stalled_followup: U.caitlyn });
    expect(d.cards.map((c) => c.item.id)).toEqual(["fu"]);
    expect(d.cards[0].canYes).toBe(true);
  });

  it("items handed to the person appear with no Yes when attorney-only", () => {
    const handed: CardState = { status: "ok", events: [{ queueItemId: "pc", kind: "handoff", actorId: U.rebecca, targetUserId: U.caitlyn, until: null, note: null, createdAt: "2026-11-10T13:00:00Z" }] };
    const d = run([qitem({ id: "pc" })], {}, handed);
    expect(d.cards).toHaveLength(1);
    expect(d.cards[0]).toMatchObject({ canYes: false });
    expect(d.cards[0].handedToMe).not.toBeNull();
  });
});

describe("deal times are per person", () => {
  it("each person's own metadata decides; one save never touches another", () => {
    const a = withDealTimes({ full_name: "A" }, ["06:30", "13:00"]);
    const b = { full_name: "B" };
    expect(parseDealTimes(a)).toEqual(["06:30", "13:00"]);
    expect(parseDealTimes(b)).toEqual([...DEFAULT_DEAL_TIMES]);
    expect(a.full_name).toBe("A");
  });

  it("an owner's already saved times are still honoured, whatever the role reading them", () => {
    const saved = { lectual_deal_times: { v: 1, times: ["08:00", "15:30"] }, lectual_welcome: { version: 1 } };
    expect(parseDealTimes(saved)).toEqual(["08:00", "15:30"]);
    expect(withDealTimes(saved, ["09:00", "16:00"]).lectual_welcome).toEqual({ version: 1 });
  });

  it("bad data reads as the defaults", () => {
    for (const bad of [null, "x", {}, { lectual_deal_times: "08:00" }, { lectual_deal_times: { v: 2, times: ["08:00", "15:00"] } }, { lectual_deal_times: { v: 1, times: ["08:00", "08:30"] } }, { lectual_deal_times: { v: 1, times: ["25:00", "15:00"] } }])
      expect(parseDealTimes(bad)).toEqual([...DEFAULT_DEAL_TIMES]);
  });

  it("the save action writes only the signed-in person's own account", async () => {
    vi.resetModules();
    const updateUser = vi.fn(async () => ({ error: null }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1", user_metadata: { full_name: "Ann" } } }, error: null }), updateUser } })) }));
    const { saveDealTimesAction } = await import("@/lib/account/deal-times-actions");
    expect(await saveDealTimesAction({ times: ["07:00", "14:00"], userId: "someone-else" })).toMatchObject({ ok: true });
    expect(updateUser).toHaveBeenCalledWith({ data: { full_name: "Ann", lectual_deal_times: { v: 1, times: ["07:00", "14:00"] } } });
    expect(readFileSync(path.join(process.cwd(), "src/lib/account/deal-times-actions.ts"), "utf8")).not.toMatch(/admin|service/i);
  });
});

describe("deal dot and menu item follow the deck flag", () => {
  const team = shellFor("team");
  const drawn = drawnNav(visibleNav(ALL, "paralegal"), "team");

  it("team has the deck behaviours but not the owner's welcome deal", () => {
    expect(team).toMatchObject({ deck: true, variant: undefined, look: "team" });
    expect(shellFor("owner")).toMatchObject({ deck: true, variant: "owner" });
    expect(shellFor("technician").deck).toBe(false);
    expect(guideFor(team.variant)).toBe("tour");
  });

  it("rail, phone bar and menu draw the deal-ready dot and Deal times for team, not for technician", () => {
    const rail = (deck: boolean) => renderToStaticMarkup(createElement(Rail, { ...base, items: drawn, initialPinned: true, tree: team.tree, look: team.look, deck, dealReady: READY }));
    expect(rail(true)).toContain(READY);
    expect(rail(false)).not.toContain("deal is ready");
    const bar = (deck: boolean) => renderToStaticMarkup(createElement(MobileBar, { ...base, items: drawn, bar: team.bar, more: false, look: team.look, deck, dealReady: READY }));
    expect(bar(true)).toContain("lx-ready-dot");
    expect(bar(false)).not.toContain("lx-ready-dot");
    const menu = (deck: boolean | undefined, look?: "team") => renderToStaticMarkup(createElement(AccountMenu, { ...menuProps, settingsInMenu: true, look, deck }));
    expect(menu(true, "team")).toMatch(/Deal times/);
    expect(menu(false, "team")).not.toMatch(/Deal times/);
    expect(renderToStaticMarkup(createElement(AccountMenu, { ...menuProps }))).not.toMatch(/Deal times/);
  });

  it("the layout and the deck page read `deck`, and the welcome deal stays on `variant`", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/dashboard/layout.tsx"), "utf8");
    expect(layout).toContain("shell.deck ? loadDealNudge");
    expect(layout).toContain("shell.deck && <DealTimesDialog");
    expect(layout).toContain("guideFor(shell.variant)");
    expect(readFileSync(path.join(process.cwd(), "src/app/dashboard/queue/deck/deck-view.tsx"), "utf8")).toContain(".deck;");
  });
});
