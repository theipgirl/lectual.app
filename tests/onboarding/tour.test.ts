import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ROLES } from "@/lib/auth/roles";
import { canApproveQueue } from "@/lib/queue/roles";
import { SETUP_PATH } from "@/lib/setup/routes";
import { NAV, visibleNav } from "@/lib/nav";
import {
  TOUR_VERSION,
  buildTourMeta,
  navTourToken,
  requestTourAgain,
  shouldShowTour,
  SHOW_TOUR_EVENT,
  tourSelector,
  tourSteps,
} from "@/lib/onboarding/tour";

const ALL_MODULES = ["mailbox", "proposals", "agents", "agent-toolkit", "litigation", "inbox", "document-center"];
const slugsFor = (role: string) => visibleNav(ALL_MODULES, role as never).map((i) => ({ slug: i.slug }));
const ids = (role: string, extra: Partial<Parameters<typeof tourSteps>[0]> = {}) =>
  tourSteps({ role, navItems: slugsFor(role), aiConfigured: true, firmName: "Hartwell IP", ...extra }).map((s) => s.id);

describe("shouldShowTour", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty", {}],
    ["a string", "x"],
    ["flag a string", { lectual_tour: "yes" }],
    ["flag an array", { lectual_tour: [] }],
    ["flag null", { lectual_tour: null }],
    ["no version", { lectual_tour: {} }],
    ["version a string", { lectual_tour: { version: "1" } }],
    ["version NaN", { lectual_tour: { version: NaN } }],
    ["version negative", { lectual_tour: { version: -1 } }],
    ["version 0", { lectual_tour: { version: 0 } }],
    ["version Infinity", { lectual_tour: { version: Infinity } }],
  ])("shows for %s", (_n, meta) => {
    expect(shouldShowTour(meta)).toBe(true);
  });

  it("does not show at the current or a higher version", () => {
    expect(shouldShowTour({ lectual_tour: { version: TOUR_VERSION } })).toBe(false);
    expect(shouldShowTour({ lectual_tour: { version: TOUR_VERSION + 4 } })).toBe(false);
  });

  it("shows again when the version is bumped", () => {
    expect(shouldShowTour({ lectual_tour: { version: TOUR_VERSION } }, TOUR_VERSION + 1)).toBe(true);
  });

  it("a current member with empty metadata and one with version 0 both see it", () => {
    expect(shouldShowTour({ full_name: "A" })).toBe(true);
    expect(shouldShowTour({ lectual_tour: { version: 0 } })).toBe(true);
  });
});

describe("buildTourMeta", () => {
  it("holds the version, an ISO date and the outcome", () => {
    const meta = buildTourMeta("skipped", new Date("2026-10-22T10:00:00Z"));
    expect(meta).toEqual({ version: TOUR_VERSION, seen_at: "2026-10-22T10:00:00.000Z", outcome: "skipped" });
  });
});

describe("requestTourAgain", () => {
  it("dispatches the show event on the target", () => {
    const seen: string[] = [];
    requestTourAgain({ dispatchEvent: (e) => (seen.push(e.type), true) });
    expect(seen).toEqual([SHOW_TOUR_EVENT]);
  });
});

describe("tourSteps for an owner with everything", () => {
  const steps = tourSteps({ role: "owner", navItems: slugsFor("owner"), aiConfigured: true, firmName: "Hartwell IP" });

  it("is in the suggested order", () => {
    expect(steps.map((s) => s.id)).toEqual(["welcome", "rail", "today", "intake", "matters", "queue", "copilot", "bell", "account", "setup", "done"]);
  });

  it("has unique ids, titles, short bodies and string-or-null targets", () => {
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) {
      expect(s.title.length).toBeGreaterThan(0);
      expect((s.body.match(/[.!?](\s|$)/g) ?? []).length).toBeLessThanOrEqual(2);
      expect(s.target === null || typeof s.target === "string").toBe(true);
    }
    expect(steps[0].target).toBeNull();
    expect(steps[steps.length - 1].target).toBeNull();
  });

  it("names the firm in the welcome, as text, cut to 60 characters", () => {
    expect(steps[0].title).toContain("Hartwell IP");
    const long = tourSteps({ role: "owner", navItems: [], aiConfigured: false, firmName: "x".repeat(90) })[0].title;
    expect(long).toBe(`Welcome to ${"x".repeat(60)} on Lectual`);
    expect(tourSteps({ role: "owner", navItems: [], aiConfigured: false })[0].title).toBe("Welcome to Lectual");
  });
});

describe("dropping steps the person cannot see", () => {
  it.each(["matters", "intake", "queue"])("drops the %s step when its slug is absent", (slug) => {
    const nav = slugsFor("owner").filter((i) => i.slug !== slug);
    const got = tourSteps({ role: "owner", navItems: nav, aiConfigured: true }).map((s) => s.id);
    expect(got).not.toContain(slug);
    expect(got).toContain("bell");
  });

  it("drops Today when absent", () => {
    const got = tourSteps({ role: "owner", navItems: slugsFor("owner").filter((i) => i.slug !== ""), aiConfigured: true }).map((s) => s.id);
    expect(got).not.toContain("today");
  });

  it("the Copilot step follows aiConfigured", () => {
    expect(ids("owner", { aiConfigured: false })).not.toContain("copilot");
    expect(ids("owner", { aiConfigured: true })).toContain("copilot");
  });

  it("a firm without modules hears nothing about module-gated sections", () => {
    const nav = visibleNav([], "owner").map((i) => ({ slug: i.slug }));
    const text = tourSteps({ role: "owner", navItems: nav, aiConfigured: true })
      .map((s) => `${s.title} ${s.body}`)
      .join(" ")
      .toLowerCase();
    for (const gated of ["agents", "proposals", "skills", "mailbox"]) expect(text).not.toContain(gated);
  });

  it("a smaller view gives a smaller tour", () => {
    const viewer = tourSteps({ role: "viewer", navItems: [{ slug: "" }, { slug: "settings" }], aiConfigured: false });
    expect(viewer.length).toBeLessThan(tourSteps({ role: "owner", navItems: slugsFor("owner"), aiConfigured: true }).length);
  });
});

describe("admin steps", () => {
  it.each(ROLES)("setup step for %s only in the admin tier", (role) => {
    expect(ids(role).includes("setup")).toBe(["owner", "admin", "senior_admin"].includes(role));
  });

  it.each(["", "root", "OWNER", "superuser"])("not for the unknown role %j", (role) => {
    expect(ids(role)).not.toContain("setup");
  });

  it.each(["owner", "admin", "senior_admin"])("%s without Settings in the rail still gets a centered setup card with the link", (role) => {
    const nav = slugsFor(role).filter((i) => i.slug !== "settings");
    const setup = tourSteps({ role, navItems: nav, aiConfigured: true }).find((s) => s.id === "setup");
    expect(setup).toBeDefined();
    expect(setup?.target).toBeNull();
    expect(setup?.link?.href).toBe(SETUP_PATH);
  });

  it("points at the Settings row when it is there", () => {
    const setup = tourSteps({ role: "admin", navItems: slugsFor("admin"), aiConfigured: true }).find((s) => s.id === "setup");
    expect(setup?.target).toBe("nav-settings");
    expect(setup?.link?.href).toBe(SETUP_PATH);
  });
});

describe("wording", () => {
  const VERBS = /\b(creat|mov|approv|send|sent|edit)\w*/i;
  const readOnly = ["viewer", "social_media", "mystery"];

  it.each(readOnly)("%s: no action verbs anywhere outside the queue step", (role) => {
    for (const s of tourSteps({ role, navItems: slugsFor("owner"), aiConfigured: true, firmName: "F" })) {
      if (s.id === "queue") continue;
      expect(`${s.title} ${s.body}`, s.id).not.toMatch(VERBS);
    }
  });

  it("the queue step follows canApproveQueue, with no second role list", () => {
    for (const role of ROLES) {
      const queue = tourSteps({ role, navItems: slugsFor("owner"), aiConfigured: true }).find((s) => s.id === "queue");
      if (canApproveQueue(role)) {
        expect(queue?.body, role).toContain("Nothing goes to a client until someone approves it.");
        expect(queue?.body, role).not.toMatch(/not approve/);
      } else {
        expect(queue?.body, role).toMatch(/see the drafts waiting here but not approve them/);
      }
    }
    const unknown = tourSteps({ role: "mystery", navItems: slugsFor("owner"), aiConfigured: true }).find((s) => s.id === "queue");
    expect(unknown?.body).toMatch(/not approve them/);
  });

  it("promises nothing and gives no legal advice", () => {
    const all = ROLES.flatMap((r) => tourSteps({ role: r, navItems: slugsFor("owner"), aiConfigured: true, firmName: "F" }));
    const text = all.map((s) => `${s.title} ${s.body}`).join(" ").toLowerCase();
    for (const bad of ["legal advice", "guarantee", "we recommend you file", "coming soon", "lorem", "todo", "placeholder"]) {
      expect(text).not.toContain(bad);
    }
  });
});

describe("targets", () => {
  const src = ["src/components/shell/Rail.tsx", "src/components/notifications/BellPopover.tsx", "src/components/shell/AccountMenu.tsx", "src/components/copilot/CopilotLauncher.tsx"]
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");

  it("only uses rail, nav-<slug>, bell, account, copilot", () => {
    const targets = new Set<string>();
    for (const role of ROLES) {
      for (const s of tourSteps({ role, navItems: NAV.map((n) => ({ slug: n.slug })), aiConfigured: true })) if (s.target) targets.add(s.target);
    }
    for (const t of targets) expect(t).toMatch(/^(rail|bell|account|copilot|nav-[a-z]+)$/);
  });

  it("every target exists as a data-tour hook in the source", () => {
    expect(src).toContain('data-tour="rail"');
    expect(src).toContain('data-tour="bell"');
    expect(src).toContain('data-tour="account"');
    expect(src).toContain('data-tour="copilot"');
    expect(src).toContain("navTourToken");
    // nav-<slug> targets resolve to a real NAV slug.
    for (const role of ROLES) {
      for (const s of tourSteps({ role, navItems: NAV.map((n) => ({ slug: n.slug })), aiConfigured: true })) {
        if (s.target?.startsWith("nav-")) {
          expect(NAV.some((n) => navTourToken(n.slug) === s.target), s.target).toBe(true);
        }
      }
    }
  });

  it("builds a safe selector", () => {
    expect(tourSelector("nav-queue")).toBe('[data-tour~="nav-queue"]');
    expect(tourSelector('x"] , body')).toBe('[data-tour~="xbody"]');
  });
});
