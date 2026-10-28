import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RAIL_PIN_COOKIE, railCountFor, railGroups, railIsPinned, REPORTS, REPORTS_INDEX, visibleNav, visibleReports } from "@/lib/nav";

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

  it("only the single Reports row links to the reports", () => {
    const html = rail(true, ["mailbox", "agents"]);
    const hrefs = [...html.matchAll(/href="([^"]*\/dashboard\/reports[^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([REPORTS_INDEX.replace(/\/$/, "")]);
  });

  it("the Reports row sits directly above Settings", () => {
    const html = rail(true, ["mailbox"]);
    expect(html.indexOf('href="/dashboard/reports"')).toBeGreaterThan(0);
    expect(html.indexOf('href="/dashboard/reports"')).toBeLessThan(html.indexOf('href="/dashboard/settings"'));
  });

  it("each visible report is linked from the Reports index", () => {
    const keys = visibleReports(visibleNav(["mailbox", "agents"], "owner"));
    expect(keys).toEqual(["communication", "intake", "matters", "ipos"]);
    const page = read("src/app/dashboard/reports/page.tsx");
    expect(page).toContain("REPORTS[key].href");
    expect(page).toContain("visibleReports");
    for (const key of keys) expect(REPORTS[key].href).toBe(`/dashboard/reports/${key}/`);
  });

  it("a report whose sections the firm cannot see is not offered (fails closed)", () => {
    expect(visibleReports([])).toEqual([]);
  });

  it("no List | Summary strip remains anywhere", () => {
    for (const f of ["src/app/dashboard/intake/_components/IntakeWorkspace.tsx", "src/app/dashboard/matters/page.tsx", "src/app/dashboard/mail/page.tsx", "src/app/dashboard/meetings/page.tsx", "src/app/dashboard/copilot/page.tsx", "src/app/dashboard/reports/[key]/page.tsx"]) {
      expect(read(f)).not.toContain("SectionTabs");
    }
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
    const files = ["Rail", "MobileBar", "AccountMenu", "SectionLabel", "NavProgress"].map((n) => [n, read(`src/components/shell/${n}.tsx`)] as const);
    expect(files.filter(([, s]) => s.includes("signOutAction")).map(([n]) => n)).toEqual(["AccountMenu"]);
  });
});
