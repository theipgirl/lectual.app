import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ROLES } from "@/lib/auth/roles";

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
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));
vi.mock("@/lib/auth/actions", () => ({ signOutAction: async () => {}, switchFirmAction: async () => ({}) }));
vi.mock("@/lib/onboarding/actions", () => ({ markTourSeenAction: vi.fn() }));
vi.mock("@/lib/onboarding/hub-actions", () => ({ markHubFlowAction: vi.fn(), resetHubProgressAction: vi.fn(), hideHubCardAction: vi.fn(), pickHubRecordsAction: vi.fn() }));
vi.mock("@/components/shell/Rail", () => ({ Rail: () => null }));
vi.mock("@/components/shell/SectionLabel", () => ({ SectionLabel: () => null }));
vi.mock("@/components/shell/NoFirmAccess", () => ({ NoFirmAccess: () => null }));
vi.mock("@/components/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/copilot/CopilotLauncher", () => ({ CopilotLauncher: () => null }));
vi.mock("@/components/onboarding/OnboardingTour", async (orig) => ({ ...(await orig<typeof import("@/components/onboarding/OnboardingTour")>()), OnboardingTour: () => null }));
vi.mock("@/components/onboarding/GettingStartedRunner", () => ({ GettingStartedRunner: () => null }));

import DashboardLayout from "@/app/dashboard/layout";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { TourView } from "@/components/onboarding/OnboardingTour";
import { GettingStartedRunner } from "@/components/onboarding/GettingStartedRunner";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { HUB_PATH, visibleFlows } from "@/lib/onboarding/hub";
import { stepView, toTourStep, NO_RECORDS } from "@/lib/onboarding/hub-runner";

function findAll(node: ReactNode, type: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, out));
  else if (node && typeof node === "object" && "props" in node) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (el.type === type) out.push(el);
    findAll(el.props.children, type, out);
  }
  return out;
}

beforeEach(() => resolveFirmSession.mockReset());

describe("layout", () => {
  const session = {
    kind: "ok",
    user: { email: "a@b.co", user_metadata: {} },
    member: { role: "attorney", org_id: "o1" },
    org: { id: "o1", name: "Hartwell IP", slug: "h", modules: ["agents"] },
    role: "attorney",
    isPlatformAdmin: false,
    actingAsStaff: false,
    switchableFirms: [],
    displayName: "Ada",
  };

  it("mounts the runner once, with the role, modules and AI flag, beside the unchanged tour", async () => {
    resolveFirmSession.mockResolvedValue(session);
    const tree = await DashboardLayout({ children: null });
    const runner = findAll(tree, GettingStartedRunner);
    expect(runner).toHaveLength(1);
    expect(runner[0].props).toMatchObject({ role: "attorney", modules: ["agents"], aiConfigured: true });
    const tour = findAll(tree, OnboardingTour) as ReactElement<Record<string, unknown>>[];
    expect(tour).toHaveLength(1);
    expect(Object.keys(tour[0].props).sort()).toEqual(["aiConfigured", "firmName", "navSlugs", "open", "role"]);
  });

  it("passes null modules through when the list could not be read", async () => {
    resolveFirmSession.mockResolvedValue({ ...session, org: { ...session.org, modules: null } });
    const runner = findAll(await DashboardLayout({ children: null }), GettingStartedRunner);
    expect((runner[0].props as { modules: unknown }).modules).toBeNull();
  });

  it("the layout source adds no user read and mounts the runner exactly once", () => {
    const src = readFileSync("src/app/dashboard/layout.tsx", "utf8");
    expect(src).not.toMatch(/getUser|getSession|getScopedClient/);
    expect(src.match(/<GettingStartedRunner/g)).toHaveLength(1);
    expect(src.match(/<OnboardingTour/g)).toHaveLength(1);
  });

  it("the runner is closed on load unless a valid flow is waiting in sessionStorage", () => {
    const src = readFileSync("src/components/onboarding/GettingStartedRunner.tsx", "utf8");
    expect(src).toContain("useState<HubFlow | null>(null)");
    expect(src).toContain("resumeFlow(raw, flows)");
    expect(src).toContain("hasVisibleModal(document)");
  });
});

describe("account menu", () => {
  const menu = (role: string) =>
    renderToStaticMarkup(
      createElement(AccountMenu, { initials: "AB", name: "Ada", email: "a@b.co", role, firmName: "F", activeOrgId: "o1", switchableFirms: [] }),
    );

  it.each(ROLES)("links to Getting started right before Show tips again for %s", (role) => {
    const html = menu(role);
    const link = html.indexOf("Getting started");
    const tips = html.indexOf("Show tips again");
    expect(html).toMatch(/<a [^>]*href="\/dashboard\/getting-started\/?"[^>]*>Getting started<\/a>/);
    expect(link).toBeGreaterThan(-1);
    expect(tips).toBeGreaterThan(link);
    expect(html.slice(link, tips)).not.toContain("<form");
  });

  it("Show tips again still dispatches the first-sign-in tour event", () => {
    const src = readFileSync("src/components/shell/AccountMenu.tsx", "utf8");
    expect(src).toContain("requestTourAgain(window)");
    expect(src).toMatch(/Show tips again\s*<\/button>/);
    expect(HUB_PATH).toBe("/dashboard/getting-started/");
  });
});

describe("popover", () => {
  const flow = visibleFlows({ role: "owner", modules: ["proposals", "agents", "agent-toolkit"], aiConfigured: true }).find((f) => f.id === "approvals-queue")!;
  const steps = flow.steps.map((s) => toTourStep(stepView(s, NO_RECORDS)));
  const noop = () => {};
  const html = (index: number) =>
    renderToStaticMarkup(
      createElement(TourView, { steps, index, placement: { mode: "center" }, onNext: noop, onBack: noop, onSkip: noop, onLink: noop, finishLabel: "Finish", skipLabel: "Skip guide" }),
    );

  it("shows Step X of Y for the flow with a labelled dialog", () => {
    const out = html(0);
    expect(out).toContain(`Step 1 of ${steps.length}`);
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toMatch(/aria-labelledby="[^"]+"/);
    expect(out).toContain(">Next<");
    expect(out).toContain(">Skip guide<");
  });

  it("offers Back after the first step and Finish on the last", () => {
    const last = html(steps.length - 1);
    expect(last).toContain(">Back<");
    expect(last).toContain(">Finish<");
    expect(last).not.toContain(">Next<");
    expect(html(0)).not.toContain(">Back<");
  });

  it("the first-sign-in tour keeps its own labels", () => {
    const out = renderToStaticMarkup(createElement(TourView, { steps, index: 0, placement: { mode: "center" }, onNext: noop, onBack: noop, onSkip: noop, onLink: noop }));
    expect(out).toContain(">Skip tour<");
    expect(readFileSync("src/components/onboarding/OnboardingTour.tsx", "utf8")).toContain("Done");
  });
});

describe("styling and sources", () => {
  it("the new stylesheet uses design tokens only (no hex colours)", () => {
    expect(readFileSync("src/components/onboarding/hub.css", "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("the runner reuses the tour popover and its reduced-motion rule", () => {
    expect(readFileSync("src/components/onboarding/GettingStartedRunner.tsx", "utf8")).toContain('import "./tour.css"');
    expect(readFileSync("src/components/onboarding/tour.css", "utf8")).toContain("prefers-reduced-motion: reduce");
  });

  it("no new migration and no new dependency", () => {
    const migrations = existsSync("supabase") ? readdirSync("supabase") : [];
    expect(migrations).toEqual([]);
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).not.toContain("driver.js");
  });

  it("the new sources use no service-role or admin client", () => {
    function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    }
    const files = [...walk("src/components/onboarding"), ...walk("src/app/dashboard/getting-started"), "src/lib/onboarding/hub.ts", "src/lib/onboarding/hub-runner.ts", "src/lib/onboarding/hub-actions.ts"];
    for (const f of files.filter((x) => /\.(tsx?|css)$/.test(x))) expect(readFileSync(f, "utf8"), f).not.toMatch(/db\/admin|getAdminClient|service_role/);
  });

  it("a flow's first record step is always followed by a way out: the pages carry the data-tour hooks", () => {
    // The hook tokens the catalog names must sit on the page the step is on.
    const pages: Record<string, string> = {
      "lead-head": "src/app/dashboard/leads/[id]/page.tsx",
      "lead-timeline": "src/app/dashboard/leads/[id]/page.tsx",
      "lead-prep": "src/app/dashboard/leads/[id]/page.tsx",
      "matter-head": "src/app/dashboard/matters/[id]/page.tsx",
      "matter-deadlines": "src/app/dashboard/matters/[id]/page.tsx",
      "matter-aside": "src/app/dashboard/matters/[id]/page.tsx",
      "matter-updates": "src/app/dashboard/matters/[id]/page.tsx",
      "intake-board": "src/app/dashboard/intake/page.tsx",
      "queue-head": "src/app/dashboard/queue/page.tsx",
      "agents-head": "src/app/dashboard/agents/page.tsx",
      "setup-head": "src/app/dashboard/settings/setup/page.tsx",
      "proposal-new-head": "src/app/dashboard/proposals/new/page.tsx",
      "team-head": "src/app/dashboard/settings/team/page.tsx",
    };
    for (const [token, file] of Object.entries(pages)) expect(readFileSync(file, "utf8"), token).toContain(`data-tour="${token}"`);
  });
});
