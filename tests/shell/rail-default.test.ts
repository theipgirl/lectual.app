import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RAIL_PIN_COOKIE, railCountFor, railGroups, railIsPinned, reportListHref, reportListLabel, visibleNav } from "@/lib/nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/" }));

import { Rail } from "@/components/shell/Rail";

const read = (p: string) => readFileSync(p, "utf8");
const rail = (initialPinned: boolean, modules: string[] = []) =>
  renderToStaticMarkup(createElement(Rail, { items: visibleNav(modules, "owner"), queueStatus: "ok", pendingCount: 3, counts: {}, initialPinned }));

describe("the rail is open by default (F1)", () => {
  it("a missing cookie is open; only an explicit collapsed closes it", () => {
    expect(railIsPinned(undefined)).toBe(true);
    expect(railIsPinned(null)).toBe(true);
    expect(railIsPinned("")).toBe(true);
    expect(railIsPinned("pinned")).toBe(true);
    expect(railIsPinned("collapsed")).toBe(false);
  });

  it("the layout asks railIsPinned, not a literal comparison", () => {
    const layout = read("src/app/dashboard/layout.tsx");
    expect(layout).toContain("railIsPinned(cookieStore.get(RAIL_PIN_COOKIE)?.value)");
    expect(layout).not.toContain('=== "pinned"');
  });

  it("renders pinned or collapsed markup from the flag", () => {
    expect(rail(true)).toContain("lx-rail is-pinned");
    expect(rail(true)).toContain("lx-rail-slot is-pinned");
    expect(rail(false)).not.toContain("is-pinned\"");
    expect(rail(false)).toMatch(/class="lx-rail"/);
  });

  it("toggling the pin still writes the cookie for both values", () => {
    const src = read("src/components/shell/Rail.tsx");
    expect(src).toContain("${RAIL_PIN_COOKIE}=${next ? \"pinned\" : \"collapsed\"}");
    expect(RAIL_PIN_COOKIE).toBe("lx_rail");
  });
});

describe("parent rows open the list (F2)", () => {
  const parents = (modules: string[]) =>
    Object.fromEntries(railGroups(visibleNav(modules, "owner"), "/dashboard/").flat().filter((e) => e.kids.length).map((e) => [e.label, e.href]));

  it("Leads, Active matters and AI tools open their lists; Communication opens Mail with the mailbox module, else Meetings", () => {
    expect(parents(["mailbox"])).toEqual({ Communication: "/dashboard/mail/", Leads: "/dashboard/intake/", "Active matters": "/dashboard/matters/", "AI tools": "/dashboard/copilot/" });
    expect(parents([]).Communication).toBe("/dashboard/meetings/");
  });

  it("no rail row links to a report page", () => {
    const html = rail(true, ["mailbox", "agents"]);
    expect(html).not.toContain("/dashboard/reports/");
  });

  it("the Summary tabs resolve to the same lists", () => {
    expect(reportListHref("communication", { hasMailbox: true })).toBe("/dashboard/mail/");
    expect(reportListHref("communication", { hasMailbox: false })).toBe("/dashboard/meetings/");
    expect(reportListHref("intake", { hasMailbox: false })).toBe("/dashboard/intake/");
    expect(reportListHref("matters", { hasMailbox: false })).toBe("/dashboard/matters/");
    expect(reportListHref("ipos", { hasMailbox: false })).toBe("/dashboard/copilot/");
    expect(reportListLabel("communication", { hasMailbox: true })).toBe("Mail");
    expect(reportListLabel("intake", { hasMailbox: true })).toBe("Leads");
  });
});

describe("Approvals is a top-level row (F3)", () => {
  const tops = (modules: string[]) => railGroups(visibleNav(modules, "owner"), "/dashboard/")[0].map((e) => e.key);

  it("sits directly after Today, before Communication", () => {
    expect(tops(["mailbox"]).slice(0, 3)).toEqual(["today", "queue", "Communication"]);
    expect(tops([]).slice(0, 2)).toEqual(["today", "queue"]);
  });

  it("is a top-level link carrying the nav-queue token, with the three queue states", () => {
    const html = rail(true);
    const anchor = html.split("<a ").find((a) => a.includes('data-tour="nav-queue"')) ?? "";
    expect(anchor).toMatch(/class="lx-rail-item/);
    expect(anchor).not.toContain("lx-rail-kid");
    expect(railCountFor("queue", "ok", 3, {})).toBe("3");
    expect(railCountFor("queue", "ok", 0, {})).toBeNull();
    expect(railCountFor("queue", "ok", 150, {})).toBe("99+");
    expect(railCountFor("queue", "unavailable", 0, {})).toBe("!");
    expect(railCountFor("queue", "unconfigured", 5, {})).toBeNull();
    expect(railCountFor("intake", "ok", 0, {})).toBeNull();
    expect(railCountFor("intake", "ok", 0, { intake: 4 })).toBe("4");
  });
});

describe("one sign-out and avatar block (F4)", () => {
  it("the rail has no me block and no sign-out", () => {
    const src = read("src/components/shell/Rail.tsx");
    expect(src).not.toContain("signOutAction");
    expect(src).not.toContain("lx-rail-me");
    expect(src).not.toContain("lx-rail-avatar");
    expect(read("src/app/globals.css")).not.toContain("lx-rail-me");
  });

  it("signOutAction is used by exactly one shell component, the account menu", () => {
    // NoFirmAccess is the screen for a signed-in person with no firm: there is no account menu there, so it keeps its own button.
    const files = ["Rail", "MobileBar", "AccountMenu", "SectionLabel", "SectionTabs", "NavProgress"].map((n) => [n, read(`src/components/shell/${n}.tsx`)] as const);
    expect(files.filter(([, s]) => s.includes("signOutAction")).map(([n]) => n)).toEqual(["AccountMenu"]);
  });
});
