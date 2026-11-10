import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const resolveFirmSession = vi.fn();
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: (...a: unknown[]) => resolveFirmSession(...a) }));
vi.mock("@/lib/queue/load", () => ({ loadActiveQueue: async () => ({ status: "ok", items: [] }) }));
vi.mock("@/lib/queue/mine-load", () => ({ mineQueue: async () => ({ status: "ok", items: [{ id: "q1" }, { id: "q2" }] }) }));
vi.mock("@/lib/nav-counts", () => ({ loadRailCounts: async () => ({}) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  usePathname: () => "/dashboard/queue/deck/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));
vi.mock("@/lib/auth/actions", () => ({ signOutAction: async () => {}, switchFirmAction: async () => ({}) }));
vi.mock("@/lib/account/view-actions", () => ({ saveViewAction: vi.fn() }));
vi.mock("@/components/shell/SectionLabel", () => ({ SectionLabel: () => null }));
vi.mock("@/components/shell/NoFirmAccess", () => ({ NoFirmAccess: () => null }));
vi.mock("@/components/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/copilot/CopilotLauncher", () => ({ CopilotLauncher: () => null }));
vi.mock("@/components/onboarding/OnboardingTour", () => ({ OnboardingTour: () => null }));
vi.mock("@/components/onboarding/GettingStartedRunner", () => ({ GettingStartedRunner: () => null }));

import DashboardLayout from "@/app/dashboard/layout";
import { Rail } from "@/components/shell/Rail";
import { MobileBar } from "@/components/shell/MobileBar";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { SectionLabel } from "@/components/shell/SectionLabel";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { mobileBarItems, moreSections, railGroups, visibleNav } from "@/lib/nav";
import { DECK_PATH } from "@/lib/views";

function findAll(node: ReactNode, type: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, out));
  else if (node && typeof node === "object" && "props" in node) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (el.type === type) out.push(el);
    findAll(el.props.children, type, out);
  }
  return out;
}

const session = (role: string, modules: string[], meta: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  kind: "ok",
  user: { id: "u1", email: "a@b.co", user_metadata: meta },
  member: { role, org_id: "o1" },
  org: { id: "o1", name: "Hartwell IP", slug: "h", modules },
  role,
  isPlatformAdmin: false,
  actingAsStaff: false,
  switchableFirms: [],
  displayName: "Ada",
  ...extra,
});

type AnyProps = Record<string, unknown>;
async function mount(s: unknown) {
  resolveFirmSession.mockResolvedValue(s);
  const tree = await DashboardLayout({ children: null });
  const one = (t: unknown) => findAll(tree, t)[0] as ReactElement<AnyProps> | undefined;
  return { tree, rail: one(Rail)!, bar: one(MobileBar)!, menu: one(AccountMenu)!, tour: one(OnboardingTour)!, label: findAll(tree, SectionLabel), header: findAll(tree, "header")[0] as ReactElement<AnyProps> };
}

const MODULES = ["mailbox", "agents", "proposals"];

beforeEach(() => resolveFirmSession.mockReset());

describe("switch off: today's shell, byte for byte", () => {
  it.each(["owner", "admin", "attorney"])("%s gets visibleNav's own list and every default", async (role) => {
    for (const meta of [{}, { lectual_view: "as:owner" }, { lectual_view: "auto" }]) {
      const m = await mount(session(role, MODULES, meta));
      const items = visibleNav(MODULES, role as never);
      expect(m.rail.props.items).toEqual(items);
      expect(m.bar.props.items).toEqual(items);
      expect(m.tour.props.navSlugs).toEqual(items.map((i) => i.slug));
      for (const k of ["tree", "variant"]) expect(m.rail.props[k]).toBeUndefined();
      expect(m.rail.props.showSettings).toBe(true);
      expect(m.rail.props.showReports).toBe(true);
      for (const k of ["bar", "groups", "variant"]) expect(m.bar.props[k]).toBeUndefined();
      expect(m.menu.props.viewMenu).toBeUndefined();
      expect(m.menu.props.settingsInMenu).toBe(false);
      expect(m.label).toHaveLength(1);
      expect(m.header.props.className).toBe("lx-top");
    }
  });

  it("the rendered rail and bar equal the old calls", () => {
    const items = visibleNav(MODULES, "owner");
    const path = "/dashboard/queue/deck/";
    expect(railGroups(items, path, undefined)).toEqual(railGroups(items, path));
    expect(mobileBarItems(items, path, undefined)).toEqual(mobileBarItems(items, path));
    expect(moreSections(items, path, undefined, undefined)).toEqual(moreSections(items, path));
    const html = (extra: AnyProps) => renderToStaticMarkup(createElement(Rail, { items, queueStatus: "ok", pendingCount: 2, counts: {}, initialPinned: true, ...extra } as never));
    expect(html({ showSettings: true, showReports: true, tree: undefined, variant: undefined })).toBe(html({}));
    const bar = (extra: AnyProps) => renderToStaticMarkup(createElement(MobileBar, { items, queueStatus: "ok", pendingCount: 2, counts: {}, ...extra } as never));
    expect(bar({ bar: undefined, groups: undefined, variant: undefined })).toBe(bar({}));
  });
});

describe("switch on", () => {
  it("an owner gets the owner shell: drawn items, owner tree, no Settings/Reports rows, no section label", async () => {
    const m = await mount(session("owner", [...MODULES, "role-views"]));
    const slugs = (m.rail.props.items as { slug: string }[]).map((i) => i.slug);
    expect(slugs).toEqual(["", "queue", "review", "proposals", "intake", "matters", "calendar"]);
    expect(m.bar.props.items).toBe(m.rail.props.items);
    expect(m.tour.props.navSlugs).toEqual(slugs);
    expect(Object.keys(m.tour.props).sort()).toEqual(["aiConfigured", "firmName", "navSlugs", "open", "role"]);
    expect(m.rail.props).toMatchObject({ showSettings: false, showReports: false, variant: "owner" });
    expect(m.bar.props).toMatchObject({ variant: "owner" });
    expect(m.menu.props).toMatchObject({ settingsInMenu: true, viewMenu: { pref: "auto", ownViewLive: true, ownViewOn: true, previewRoles: [] } });
    expect(m.label).toHaveLength(0);
    expect(m.header.props.className).toBe("lx-top lx-top--owner");

    const rail = renderToStaticMarkup(m.rail);
    expect(rail).toContain("lx-rail--owner");
    expect(rail).not.toContain('href="/dashboard/settings');
    expect(rail).not.toContain('href="/dashboard/reports');
    expect(rail).toContain(`href="${DECK_PATH.replace(/\/$/, "")}`);
    expect(rail).toContain(">More<");
    const bar = renderToStaticMarkup(m.bar);
    expect(bar).toContain("lx-mbar lx-mbar--owner");
    expect([...bar.matchAll(/class="lx-mbar-label">([^<]+)</g)].map((x) => x[1])).toEqual(["Today", "Approvals", "Review", "Proposals", "More"]);
    // The Approvals badge keeps the queue count and the page it is on is the active tile.
    expect(bar).toMatch(/aria-current="page" aria-label="Approvals \(2\)"/);
  });

  it("an owner who chose the technician view gets today's shell, with the switch in the menu", async () => {
    const m = await mount(session("owner", [...MODULES, "role-views"], { lectual_view: "technician" }));
    expect(m.rail.props.items).toEqual(visibleNav([...MODULES, "role-views"], "owner"));
    expect(m.menu.props.viewMenu).toMatchObject({ ownViewLive: true, ownViewOn: false });
  });

  it("an admin keeps today's shell and is offered a preview; previewing draws the owner shell", async () => {
    const m = await mount(session("admin", [...MODULES, "role-views"]));
    expect(m.rail.props.variant).toBeUndefined();
    expect(m.menu.props.viewMenu).toEqual({ pref: "auto", ownViewLive: false, ownViewOn: false, previewRoles: ["owner"] });
    const p = await mount(session("admin", [...MODULES, "role-views"], { lectual_view: "as:owner" }));
    expect(p.rail.props.variant).toBe("owner");
  });

  it("a role that may not switch sees neither the switch nor a preview it saved by hand", async () => {
    const m = await mount(session("attorney", [...MODULES, "role-views"], { lectual_view: "as:owner" }));
    expect(m.rail.props.variant).toBeUndefined();
    expect(m.menu.props.viewMenu).toBeUndefined();
  });

  it("Lectual staff see today's shell and no view switch, even with a preview saved on their account", async () => {
    const m = await mount(session("owner", [...MODULES, "role-views"], { lectual_view: "as:owner" }, { actingAsStaff: true, member: null }));
    expect(m.rail.props.variant).toBeUndefined();
    expect(m.menu.props.viewMenu).toBeUndefined();
  });
});

describe("account menu", () => {
  const menu = (extra: AnyProps) =>
    renderToStaticMarkup(createElement(AccountMenu, { initials: "AB", name: "Ada", email: "a@b.co", role: "owner", firmName: "F", activeOrgId: "o1", switchableFirms: [], ...extra } as never));

  it("draws the View group and a Settings link, and keeps Help and tips valid", () => {
    const html = menu({ settingsInMenu: true, viewMenu: { pref: "auto", ownViewLive: true, ownViewOn: true, previewRoles: [] } });
    expect([...html.matchAll(/role="menuitem"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(["Your name", "Settings", "Getting started", "Show tips again", "Send feedback", "Sign out"]);
    expect(html).toMatch(/href="\/dashboard\/settings\/?"/);
    expect(html).toMatch(/role="menuitemcheckbox" aria-checked="true"[^>]*><span>Owner view<\/span>/);
    const start = html.indexOf('<div role="group" aria-labelledby="lx-help-h"');
    const group = html.slice(start, html.indexOf("<form", start));
    expect(group).not.toContain("Owner view");
    expect(group).not.toContain("Settings");
  });

  it("an admin sees Preview a view, and a preview offers the way back", () => {
    const html = menu({ role: "admin", viewMenu: { pref: "as:owner", ownViewLive: false, ownViewOn: false, previewRoles: ["owner"] } });
    expect(html).toContain("Preview a view");
    expect(html).toMatch(/role="menuitemradio" aria-checked="true"[^>]*>Owner</);
    expect(html).toContain("Back to my own view");
    expect(html).not.toContain("menuitemcheckbox");
  });

  it("the switch refreshes the page after saving", () => {
    const src = readFileSync("src/components/shell/ViewSwitch.tsx", "utf8");
    expect(src).toContain("saveViewAction(value)");
    expect(src).toContain("router.refresh()");
  });
});

describe("the layout seam", () => {
  it("one draw-only filter, the pinned greps, and no second user read", () => {
    const src = readFileSync("src/app/dashboard/layout.tsx", "utf8");
    expect(src).not.toMatch(/getUser|getSession|getScopedClient/);
    expect(src).toContain("railIsPinned(cookieStore.get(RAIL_PIN_COOKIE)?.value)");
    expect(src.match(/drawnNav\(/g)).toHaveLength(1);
    expect(src).toContain("const items = visibleNav(org.modules ?? [], role);");
    expect(src).toContain("navSlugs={drawn.map((i) => i.slug)}");
    expect(readFileSync("src/lib/nav.ts", "utf8")).not.toMatch(/views|drawnNav/);
  });
});
