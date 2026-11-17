import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

const resolveFirmSession = vi.fn();
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: (...a: unknown[]) => resolveFirmSession(...a) }));
vi.mock("@/lib/queue/load", () => ({ loadActiveQueue: async () => ({ status: "ok", items: [] }) }));
vi.mock("@/lib/queue/mine-load", () => ({ mineQueue: async () => ({ status: "ok", items: [] }) }));
vi.mock("@/lib/nav-counts", () => ({ loadRailCounts: async () => ({}) }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  usePathname: () => "/dashboard/",
}));
vi.mock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));
vi.mock("@/components/shell/Rail", () => ({ Rail: () => null }));
vi.mock("@/components/shell/SectionLabel", () => ({ SectionLabel: () => null }));
vi.mock("@/components/shell/AccountMenu", () => ({ AccountMenu: () => null }));
vi.mock("@/components/shell/NoFirmAccess", () => ({ NoFirmAccess: () => null }));
vi.mock("@/components/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/copilot/CopilotLauncher", () => ({ CopilotLauncher: () => null }));
vi.mock("@/components/onboarding/OnboardingTour", () => ({ OnboardingTour: () => null }));
vi.mock("@/components/onboarding/WelcomeDeal", () => ({ WelcomeDeal: () => null }));

import DashboardLayout from "@/app/dashboard/layout";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { WelcomeDeal } from "@/components/onboarding/WelcomeDeal";
import { TOUR_VERSION } from "@/lib/onboarding/tour";
import { WELCOME_VERSION } from "@/lib/onboarding/welcome-deal";

function findAll(node: ReactNode, type: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, out));
  else if (node && typeof node === "object" && "props" in node) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (el.type === type) out.push(el);
    findAll(el.props.children, type, out);
  }
  return out;
}

const session = (meta: Record<string, unknown>, modules: string[], extra: Record<string, unknown> = {}) => ({
  kind: "ok",
  user: { id: "u1", email: "a@b.co", user_metadata: meta },
  member: { role: "owner", org_id: "o1" },
  org: { id: "o1", name: "Hartwell IP", slug: "h", modules },
  role: "owner",
  isPlatformAdmin: false,
  actingAsStaff: false,
  switchableFirms: [],
  displayName: "Ada",
  ...extra,
});

async function drawn() {
  const tree = await DashboardLayout({ children: null });
  return {
    welcome: findAll(tree, WelcomeDeal) as ReactElement<{ open: boolean; dealTimes: string[] }>[],
    tour: findAll(tree, OnboardingTour) as ReactElement<{ open: boolean }>[],
  };
}

beforeEach(() => resolveFirmSession.mockReset());

describe("which first-sign-in guide the layout draws", () => {
  it("owner view: the welcome deal, open, with the person's own deal times; no tour", async () => {
    resolveFirmSession.mockResolvedValue(
      session({ lectual_deal_times: { v: 1, times: ["08:00", "15:00"] } }, ["role-views"]),
    );
    const { welcome, tour } = await drawn();
    expect(tour).toHaveLength(0);
    expect(welcome).toHaveLength(1);
    expect(welcome[0].props.open).toBe(true);
    expect(welcome[0].props.dealTimes).toEqual(["08:00", "15:00"]);
  });

  it("owner view with the tour seen but no welcome flag: the welcome deal still opens", async () => {
    resolveFirmSession.mockResolvedValue(
      session({ lectual_tour: { version: TOUR_VERSION, seen_at: "x", outcome: "skipped" } }, ["role-views"]),
    );
    expect((await drawn()).welcome[0].props.open).toBe(true);
  });

  it("owner view with the welcome flag seen: closed", async () => {
    resolveFirmSession.mockResolvedValue(
      session({ lectual_welcome: { version: WELCOME_VERSION, seen_at: "x", outcome: "finished" } }, ["role-views"]),
    );
    expect((await drawn()).welcome[0].props.open).toBe(false);
  });

  it("staff acting in the firm: closed", async () => {
    resolveFirmSession.mockResolvedValue(session({}, ["role-views"], { actingAsStaff: true, member: null }));
    const { welcome, tour } = await drawn();
    // Staff acting without a preview are in the technician shell: the tour component, closed.
    expect(welcome.every((w) => w.props.open === false)).toBe(true);
    expect(tour.every((t) => t.props.open === false)).toBe(true);
  });

  it("technician view (no role-views switch): the tour, no welcome deal", async () => {
    resolveFirmSession.mockResolvedValue(session({}, []));
    const { welcome, tour } = await drawn();
    expect(welcome).toHaveLength(0);
    expect(tour).toHaveLength(1);
    expect(tour[0].props.open).toBe(true);
  });
});
