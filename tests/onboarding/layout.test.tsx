import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { ReactElement, ReactNode } from "react";

const resolveFirmSession = vi.fn();
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: (...a: unknown[]) => resolveFirmSession(...a) }));
vi.mock("@/lib/queue/load", () => ({ loadActiveQueue: async () => ({ status: "ok", items: [] }) }));
vi.mock("@/lib/nav-counts", () => ({ loadRailCounts: async () => ({}) }));
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

import DashboardLayout from "@/app/dashboard/layout";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { TOUR_VERSION } from "@/lib/onboarding/tour";

function findAll(node: ReactNode, type: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, out));
  else if (node && typeof node === "object" && "props" in node) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (el.type === type) out.push(el);
    findAll(el.props.children, type, out);
  }
  return out;
}

const session = (meta: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  kind: "ok",
  user: { email: "a@b.co", user_metadata: meta },
  member: { role: "attorney", org_id: "o1" },
  org: { id: "o1", name: "Hartwell IP", slug: "h", modules: ["agents"] },
  role: "attorney",
  isPlatformAdmin: false,
  actingAsStaff: false,
  switchableFirms: [],
  displayName: "Ada",
  ...extra,
});

async function mounted() {
  const tree = await DashboardLayout({ children: null });
  return findAll(tree, OnboardingTour) as ReactElement<{ open: boolean; navSlugs: string[] }>[];
}

beforeEach(() => {
  resolveFirmSession.mockReset();
});

describe("dashboard layout and the tour", () => {
  it("opens it for a member who has not seen it", async () => {
    resolveFirmSession.mockResolvedValue(session({}));
    const found = await mounted();
    expect(found).toHaveLength(1);
    expect(found[0].props).toMatchObject({ open: true, role: "attorney", firmName: "Hartwell IP", aiConfigured: true });
    expect(found[0].props.navSlugs).toContain("");
    expect(found[0].props.navSlugs).toContain("agents");
  });

  it("does not open it once seen at the current version", async () => {
    resolveFirmSession.mockResolvedValue(session({ lectual_tour: { version: TOUR_VERSION, seen_at: "x", outcome: "finished" } }));
    expect((await mounted())[0].props.open).toBe(false);
  });

  it("does not open it for staff inside a firm they are not a member of", async () => {
    resolveFirmSession.mockResolvedValue(session({}, { actingAsStaff: true, member: null }));
    expect((await mounted())[0].props.open).toBe(false);
  });

  it("does not mount for signed-out or no-access", async () => {
    resolveFirmSession.mockResolvedValue({ kind: "signed-out", redirectTo: "/sign-in" });
    await expect(DashboardLayout({ children: null })).rejects.toThrow("redirect:/sign-in");
    resolveFirmSession.mockResolvedValue({ kind: "no-access", user: { email: "a@b.co" } });
    const tree = await DashboardLayout({ children: null });
    expect(findAll(tree, OnboardingTour)).toHaveLength(0);
  });

  it("adds no second user read to the layout", () => {
    const src = readFileSync("src/app/dashboard/layout.tsx", "utf8");
    expect(src).not.toMatch(/getUser|getSession|getScopedClient/);
    expect(src.match(/<OnboardingTour/g)).toHaveLength(1);
    expect(src).toContain("shouldShowTour(user.user_metadata)");
  });
});
