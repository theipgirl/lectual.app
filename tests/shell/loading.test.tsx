import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import DashboardLoading from "@/app/dashboard/loading";
import { PROGRESS_DELAY_MS, startsNavigation, type ClickInfo } from "@/lib/ui/nav-progress";

const here = new URL("https://app.lectual.app/dashboard/leads/");
const click = (over: Partial<ClickInfo> = {}): ClickInfo => ({
  href: "/dashboard/calendar/",
  target: null,
  download: false,
  button: 0,
  modified: false,
  defaultPrevented: false,
  ...over,
});

describe("dashboard loading skeleton", () => {
  const html = renderToStaticMarkup(DashboardLoading());
  it("is a busy status region with text for screen readers", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading the page");
  });
  it("uses design classes and no raw colours", () => {
    expect(html).toContain("lx-skel");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb\(|style=/);
  });
  it("adds no dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(Object.keys(pkg.dependencies)).not.toContain("nprogress");
    expect(Object.keys(pkg.dependencies)).not.toContain("nextjs-toploader");
  });
});

describe("top progress bar trigger", () => {
  it("waits before showing, so quick navigations never flash it", () => {
    expect(PROGRESS_DELAY_MS).toBeGreaterThanOrEqual(100);
  });
  it("starts for a link to another dashboard page", () => {
    expect(startsNavigation(click(), here)).toBe(true);
    expect(startsNavigation(click({ href: "/dashboard/leads/?q=a" }), here)).toBe(true);
  });
  it("ignores the current page, hash moves, other origins, new tabs and modified clicks", () => {
    expect(startsNavigation(click({ href: "/dashboard/leads/" }), here)).toBe(false);
    expect(startsNavigation(click({ href: "#top" }), here)).toBe(false);
    expect(startsNavigation(click({ href: "https://example.com/dashboard/x/" }), here)).toBe(false);
    expect(startsNavigation(click({ href: "/login" }), here)).toBe(false);
    expect(startsNavigation(click({ target: "_blank" }), here)).toBe(false);
    expect(startsNavigation(click({ modified: true }), here)).toBe(false);
    expect(startsNavigation(click({ button: 1 }), here)).toBe(false);
    expect(startsNavigation(click({ download: true }), here)).toBe(false);
    expect(startsNavigation(click({ defaultPrevented: true }), here)).toBe(false);
  });
});
