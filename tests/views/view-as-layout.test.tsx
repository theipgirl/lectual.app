import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const resolveFirmSession = vi.fn();
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: (...a: unknown[]) => resolveFirmSession(...a) }));
const resolveViewer = vi.fn();
vi.mock("@/lib/views/view-as", () => ({ resolveViewer: () => resolveViewer() }));
vi.mock("@/lib/queue/load", () => ({ loadActiveQueue: async () => ({ status: "ok", items: [] }) }));
const mineQueue = vi.fn(async (...args: unknown[]) => {
  void args;
  return { status: "ok", items: [] };
});
vi.mock("@/lib/queue/mine-load", () => ({ mineQueue: (...a: unknown[]) => mineQueue(...a) }));
const loadDealNudge = vi.fn(async (...args: unknown[]) => {
  void args;
  return { ready: false };
});
vi.mock("@/lib/queue/deal-nudge-load", () => ({ loadDealNudge: (...a: unknown[]) => loadDealNudge(...a) }));
vi.mock("@/lib/nav-counts", () => ({ loadRailCounts: async () => ({}) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  usePathname: () => "/dashboard/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));
vi.mock("@/lib/auth/actions", () => ({ switchFirmAction: async () => ({}) }));
vi.mock("@/lib/account/view-actions", () => ({ saveViewAction: vi.fn() }));
vi.mock("@/components/shell/SectionLabel", () => ({ SectionLabel: () => null }));
vi.mock("@/components/shell/NoFirmAccess", () => ({ NoFirmAccess: () => null }));
vi.mock("@/components/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/copilot/CopilotLauncher", () => ({ CopilotLauncher: () => null }));
vi.mock("@/components/onboarding/OnboardingTour", () => ({ OnboardingTour: () => null }));
vi.mock("@/components/onboarding/WelcomeDeal", () => ({ WelcomeDeal: () => null }));
vi.mock("@/components/onboarding/GettingStartedRunner", () => ({ GettingStartedRunner: () => null }));

import DashboardLayout from "@/app/dashboard/layout";
import { Rail } from "@/components/shell/Rail";
import { MobileBar } from "@/components/shell/MobileBar";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { CopilotLauncher } from "@/components/copilot/CopilotLauncher";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { WelcomeDeal } from "@/components/onboarding/WelcomeDeal";
import { GettingStartedRunner } from "@/components/onboarding/GettingStartedRunner";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { YourNameDialog } from "@/components/account/YourNameDialog";
import { DealTimesDialog } from "@/components/deck/DealTimesDialog";
import { ViewAsBanner } from "@/components/views/ViewAsBanner";
import { PreviewBell } from "@/components/views/PreviewBell";
import { ReadOnlyPreview } from "@/components/views/ReadOnlyPreview";
import { drawnNav, viewFor, NO_PREVIEW } from "@/lib/views";
import { visibleNav } from "@/lib/nav";
import { SIGN_OUT_PATH, VIEW_AS_EXIT_PATH } from "@/lib/views/view-as-rules";

function findAll(node: ReactNode, type: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, out));
  else if (node && typeof node === "object" && "props" in node) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (el.type === type) out.push(el);
    findAll(el.props.children, type, out);
  }
  return out;
}
type P = Record<string, unknown>;
const ORG = "00000000-0000-4000-8000-0000000000a1";
const OWNER = "11111111-1111-4111-8111-111111111111";
const DANA = "22222222-2222-4222-8222-222222222222";
const ownerSession = (modules: string[]) => ({
  kind: "ok",
  user: { id: OWNER, email: "owner@example.com", user_metadata: { full_name: "Owner Person" } },
  member: { role: "owner", org_id: ORG },
  org: { id: ORG, name: "Example Firm", slug: "ex", modules },
  role: "owner",
  isPlatformAdmin: false,
  actingAsStaff: false,
  switchableFirms: [],
  displayName: "Owner Person",
});
const previewing = (modules: string[], role = "paralegal") => ({
  session: ownerSession(modules),
  viewAs: { targetUserId: DANA, targetRole: role, targetName: "Dana Lee", startedAt: "2026-11-23T10:00:00Z" },
  viewer: { userId: DANA, role, displayName: "Dana Lee" },
  previewState: "on",
  teamUnreadable: false,
  viewAsAvailable: true,
});
const MODULES = ["mailbox", "agents", "proposals"];

async function mount(modules: string[], viewer: unknown) {
  resolveFirmSession.mockResolvedValue(ownerSession(modules));
  resolveViewer.mockResolvedValue(viewer);
  const tree = await DashboardLayout({ children: null });
  const one = (t: unknown) => findAll(tree, t)[0] as ReactElement<P> | undefined;
  return { tree, one, all: (t: unknown) => findAll(tree, t) };
}

beforeEach(() => {
  mineQueue.mockClear();
  loadDealNudge.mockClear();
});

describe("while previewing a teammate", () => {
  it("draws the banner with Exit posting to the fixed path, on every page (the layout)", async () => {
    const m = await mount(MODULES, previewing(MODULES));
    const banner = m.one(ViewAsBanner)!;
    expect(banner.props).toEqual({ kind: "name", name: "Dana Lee" });
    const html = renderToStaticMarkup(banner);
    expect(html).toContain("Viewing as Dana Lee (read-only)");
    expect(html).toContain("Viewing as Dana · read-only");
    expect(html).toContain(`action="${VIEW_AS_EXIT_PATH}"`);
    expect(html).toContain('method="post"');
  });

  it("the rail, phone bar and More sheet are the teammate's (role views off: the technician shell)", async () => {
    const m = await mount(MODULES, previewing(MODULES, "paralegal"));
    const expected = drawnNav(visibleNav(MODULES, "paralegal"), viewFor({ role: "paralegal", preview: NO_PREVIEW, firmHasRoleViews: false, actingAsStaff: false }));
    expect(m.one(Rail)!.props.items).toEqual(expected);
    expect(m.one(MobileBar)!.props.items).toEqual(expected);
    expect(m.one(Rail)!.props.variant).toBeUndefined();
  });

  it("role views on: an admin teammate gets the owner shell; a paralegal the technician shell", async () => {
    const mods = [...MODULES, "role-views"];
    const admin = await mount(mods, previewing(mods, "admin"));
    expect(admin.one(Rail)!.props.variant).toBe("owner");
    const para = await mount(mods, previewing(mods, "paralegal"));
    expect(para.one(Rail)!.props.variant).toBeUndefined();
  });

  it("Mine and the deal dot are the teammate's, with the firm's default deal times", async () => {
    const mods = [...MODULES, "role-views"];
    await mount(mods, previewing(mods, "admin"));
    expect(mineQueue.mock.calls[0][1]).toEqual({ userId: DANA, role: "admin" });
    expect(loadDealNudge.mock.calls[0][1]).toEqual({ userId: DANA, role: "admin" });
  });

  it("tour, welcome deal, runner and the dialogs are closed; Copilot's launcher is absent; the bell is muted", async () => {
    const m = await mount(MODULES, previewing(MODULES));
    for (const t of [OnboardingTour, WelcomeDeal, GettingStartedRunner, FeedbackDialog, YourNameDialog, DealTimesDialog, CopilotLauncher, NotificationBell]) {
      expect(m.all(t), String((t as { name?: string }).name)).toHaveLength(0);
    }
    expect(m.one(PreviewBell)!.props).toEqual({ name: "Dana Lee" });
    expect(m.all(ReadOnlyPreview)).toHaveLength(1);
  });

  it("the account menu holds only the header, Exit and Sign out", async () => {
    const m = await mount(MODULES, previewing(MODULES));
    const menu = m.one(AccountMenu)!;
    expect(menu.props.previewing).toEqual({ name: "Dana Lee" });
    expect(menu.props.viewAsLink).toBe(false);
    expect(menu.props.viewMenu).toBeUndefined();
    const html = renderToStaticMarkup(menu);
    expect(html).toContain("Viewing as Dana Lee");
    expect(html).toContain(`action="${VIEW_AS_EXIT_PATH}"`);
    expect(html).toContain(`action="${SIGN_OUT_PATH}"`);
    for (const gone of ["Your name", "Show tips again", "Getting started", "Send feedback", "Switch firm"]) expect(html).not.toContain(gone);
    expect(html).toContain("lx-am-avatar--preview");
  });

  it("couldn't check: the unchecked banner, the owner's own view, writes refused (no tour etc.)", async () => {
    const m = await mount(MODULES, { ...previewing(MODULES), viewAs: null, viewer: { userId: OWNER, role: "owner", displayName: "Owner Person" }, previewState: "unknown" });
    expect(m.one(ViewAsBanner)!.props).toEqual({ kind: "unchecked" });
    expect(m.all(OnboardingTour)).toHaveLength(0);
    expect(m.all(ReadOnlyPreview)).toHaveLength(1);
  });
});

describe("not previewing", () => {
  it("no banner; a real owner on a database with View as gets the menu line", async () => {
    const m = await mount(MODULES, { session: ownerSession(MODULES), viewAs: null, viewer: { userId: OWNER, role: "owner", displayName: "Owner Person" }, previewState: "off", teamUnreadable: false, viewAsAvailable: true });
    expect(m.all(ViewAsBanner)).toHaveLength(0);
    expect(m.one(AccountMenu)!.props.viewAsLink).toBe(true);
    expect(renderToStaticMarkup(m.one(AccountMenu)!)).toContain("View as a teammate");
    expect(m.all(ReadOnlyPreview)).toHaveLength(0);
  });

  it("before 0117: no menu line", async () => {
    const m = await mount(MODULES, { session: ownerSession(MODULES), viewAs: null, viewer: { userId: OWNER, role: "owner", displayName: "Owner Person" }, previewState: "off", teamUnreadable: false, viewAsAvailable: false });
    expect(m.one(AccountMenu)!.props.viewAsLink).toBe(false);
  });
});
