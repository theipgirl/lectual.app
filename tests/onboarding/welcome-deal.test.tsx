import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { TOUR_VERSION } from "@/lib/onboarding/tour";
import {
  guideFor,
  shouldShowWelcome,
  WELCOME_VERSION,
  isLastCard,
  requestWelcomeAgain,
  shouldShowWelcomeDeal,
  SHOW_WELCOME_EVENT,
  startWelcome,
  stepWelcome,
  welcomeCards,
} from "@/lib/onboarding/welcome-deal";
import { closeTour } from "@/lib/onboarding/engine";
import { WelcomeDealView } from "@/components/onboarding/WelcomeDeal";
import { DEAL_TIMES_MENU_ITEM, DEAL_TIMES_OPEN } from "@/lib/ui/words";

const seen = { lectual_welcome: { version: WELCOME_VERSION, seen_at: "x", outcome: "finished" } };
const tourSeen = { lectual_tour: { version: TOUR_VERSION, seen_at: "x", outcome: "finished" } };

describe("welcomeCards", () => {
  it("is four cards in the board's order, each tagged and with a first step", () => {
    const cards = welcomeCards();
    expect(cards.map((c) => c.id)).toEqual(["cards", "moves", "deals", "review"]);
    for (const c of cards) {
      expect(c.tag).toBe("Welcome · 1 min");
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.step.length).toBeGreaterThan(0);
    }
  });

  it("card 3 names the person's own times, else the defaults", () => {
    expect(welcomeCards(["08:30", "15:45"])[2].body).toContain("8:30 AM and 3:45 PM");
    expect(welcomeCards()[2].body).toContain("7:00 AM and 2:00 PM");
    expect(welcomeCards(null)[2].body).toContain("7:00 AM and 2:00 PM");
    expect(welcomeCards(["09:00"])[2].body).toContain("7:00 AM and 2:00 PM");
  });

  it("card 3's first step names the controls that really exist, and the copy has no swipe wording", () => {
    const steps = welcomeCards()[2].step;
    expect(steps).toContain(DEAL_TIMES_OPEN);
    expect(steps).toContain(DEAL_TIMES_MENU_ITEM);
    const all = welcomeCards()
      .map((c) => `${c.title} ${c.body} ${c.step}`)
      .join(" ");
    expect(all).not.toMatch(/swipe/i);
  });

  it("card 2 describes only moves the deck has, and says the arrows store nothing", () => {
    const c = welcomeCards()[1];
    expect(c.body).toMatch(/5-second hold you can undo/);
    expect(c.body).toMatch(/Reject needs a note/);
    expect(c.body).toMatch(/Later/);
    expect(c.body).toMatch(/Hand off/);
    expect(c.body).toMatch(/Approving never sends/);
    expect(c.step).toMatch(/nothing is stored/);
  });
});

describe("the step engine", () => {
  it("next walks 0..3 and finishes on the last card", () => {
    let s = startWelcome();
    const seenIdx: number[] = [s.index];
    for (let i = 0; i < 3; i++) {
      s = stepWelcome(s, "next", 4);
      expect(s.outcome).toBeNull();
      seenIdx.push(s.index);
    }
    expect(seenIdx).toEqual([0, 1, 2, 3]);
    expect(stepWelcome(s, "next", 4)).toEqual({ index: 3, outcome: "finished" });
  });

  it("back never leaves card 1", () => {
    expect(stepWelcome({ index: 0 }, "back", 4)).toEqual({ index: 0, outcome: null });
    expect(stepWelcome({ index: 2 }, "back", 4)).toEqual({ index: 1, outcome: null });
  });

  it("skip ends as skipped from any card", () => {
    for (const i of [0, 1, 2, 3]) expect(stepWelcome({ index: i }, "skip", 4).outcome).toBe("skipped");
  });

  it("a replay starts again at card 1 with nothing decided", () => {
    expect(startWelcome()).toEqual({ index: 0, outcome: null });
    const dispatched: string[] = [];
    requestWelcomeAgain({
      dispatchEvent: (e) => {
        dispatched.push(e.type);
        return true;
      },
    });
    expect(dispatched).toEqual([SHOW_WELCOME_EVENT]);
  });

  it("only the last card reads Finish", () => {
    expect([0, 1, 2, 3].map((i) => isLastCard(i, 4))).toEqual([false, false, false, true]);
  });

  it("closing writes the outcome through the existing action, optimistically, and swallows a failed save", async () => {
    const calls: string[] = [];
    const store = { getItem: () => null, setItem: vi.fn() };
    await closeTour({
      outcome: "finished",
      action: async (o) => {
        calls.push(o);
      },
      storage: store,
      onClosed: () => calls.push("closed"),
    });
    expect(calls).toEqual(["closed", "finished"]);
    expect(store.setItem).toHaveBeenCalled();
    await expect(
      closeTour({ outcome: "skipped", action: async () => Promise.reject(new Error("boom")), storage: store, onClosed: () => {} }),
    ).resolves.toBeUndefined();
  });
});

describe("who sees it", () => {
  it("owner shell, member, unseen: yes", () => {
    expect(shouldShowWelcomeDeal({ userMetadata: {}, shellVariant: "owner", actingAsStaff: false })).toBe(true);
  });
  it("a person who finished the tour but not the welcome deal still sees it", () => {
    expect(shouldShowWelcomeDeal({ userMetadata: tourSeen, shellVariant: "owner", actingAsStaff: false })).toBe(true);
    expect(shouldShowWelcome({ lectual_welcome: [] })).toBe(true);
    expect(shouldShowWelcome({ lectual_welcome: { version: 0 } })).toBe(true);
  });
  it("not when the welcome flag is seen at this version", () => {
    expect(shouldShowWelcomeDeal({ userMetadata: seen, shellVariant: "owner", actingAsStaff: false })).toBe(false);
  });
  it("not for staff acting in a firm", () => {
    expect(shouldShowWelcomeDeal({ userMetadata: {}, shellVariant: "owner", actingAsStaff: true })).toBe(false);
  });
  it("not in the technician shell, which keeps the tour", () => {
    expect(shouldShowWelcomeDeal({ userMetadata: {}, shellVariant: undefined, actingAsStaff: false })).toBe(false);
    expect(guideFor(undefined)).toBe("tour");
    expect(guideFor("owner")).toBe("welcome");
  });
});

describe("the dialog", () => {
  const render = (index: number) =>
    renderToStaticMarkup(<WelcomeDealView cards={welcomeCards()} index={index} onNext={() => {}} onBack={() => {}} onSkip={() => {}} />);

  it("is a modal dialog drawn with the deck's own card classes", () => {
    const html = render(0);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("dk-card");
    expect(html).toContain("dk-move--yes");
    expect(html).toContain("1 / 4");
    expect(html).toContain("Skip the tour");
    expect(html).toContain(">Next<");
    expect(html).toContain("First step:");
  });

  it("the last card says Finish; the first disables back", () => {
    expect(render(3)).toContain(">Finish<");
    expect(render(3)).toContain("4 / 4");
    expect(render(0)).toMatch(/disabled=""[^>]*>‹|aria-label="Previous step"[^>]*disabled/);
  });
});

describe("wiring", () => {
  it("the dialog writes only its own flag, and staff in a firm write nothing", () => {
    const src = readFileSync("src/components/onboarding/WelcomeDeal.tsx", "utf8");
    expect(src).toContain("markWelcomeSeenAction");
    expect(src).not.toContain("markTourSeenAction");
    expect(src).toContain("persist ? markWelcomeSeenAction");
    expect(readFileSync("src/app/dashboard/layout.tsx", "utf8")).toContain("persist={!actingAsStaff}");
  });

  it("the layout draws the tour only for the technician shell and the welcome deal only for the owner shell", () => {
    const src = readFileSync("src/app/dashboard/layout.tsx", "utf8");
    expect(src).toContain('guideFor(shell.variant) === "welcome"');
    expect(src.match(/<WelcomeDeal/g)).toHaveLength(1);
    expect(src.match(/<OnboardingTour/g)).toHaveLength(1);
  });

  it("the owner menu replays the welcome deal; the technician menu keeps replaying the tour", () => {
    const src = readFileSync("src/components/shell/AccountMenu.tsx", "utf8");
    expect(src).toContain('variant === "owner" ? requestWelcomeAgain(window) : requestTourAgain(window)');
  });

  it("the dialog's CSS keeps the sentences off Courier and out of small type", () => {
    const css = readFileSync("src/components/onboarding/welcome-deal.css", "utf8");
    expect(css).not.toMatch(/Courier|var\(--mono\)/);
    for (const m of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(13);
  });
});
