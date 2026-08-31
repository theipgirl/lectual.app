import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NAV_ITEMS, isNavItemActive, type NavItem } from "@/components/Nav";

/**
 * Nav links must resolve to real routes.
 *
 * This exists because they once did not: "Matters" pointed at `/matters/`,
 * which is not a route in this app, and shipped to production returning a 404
 * from the primary navigation. A typecheck cannot catch a dead string, and a
 * build will happily emit a link to nowhere — so the route table is read off
 * the filesystem and asserted against.
 */

const APP_DIR = join(process.cwd(), "src", "app");

/** Every routable path under src/app, as a trailing-slashed pathname. */
function discoverRoutes(dir: string, prefix = "/"): string[] {
  const routes: string[] = [];
  if (existsSync(join(dir, "page.tsx"))) routes.push(prefix);

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Route groups "(x)" do not appear in the URL; private folders "_x" and
    // the api/auth handlers are not page routes.
    if (entry.name.startsWith("_") || entry.name === "api") continue;
    const segment = entry.name.startsWith("(") ? "" : `${entry.name}/`;
    routes.push(...discoverRoutes(join(dir, entry.name), `${prefix}${segment}`));
  }
  return routes;
}

/** Does `href` match a route, allowing [param] segments to absorb one part? */
function routeMatches(route: string, href: string): boolean {
  const r = route.split("/").filter(Boolean);
  const h = href.split("/").filter(Boolean);
  if (r.length !== h.length) return false;
  return r.every((seg, i) => (seg.startsWith("[") && seg.endsWith("]") ? true : seg === h[i]));
}

const ROUTES = discoverRoutes(APP_DIR);

describe("nav route integrity", () => {
  it("discovers the app's routes", () => {
    // Guard the guard: if discovery silently returned nothing, every
    // assertion below would pass vacuously.
    expect(ROUTES.length).toBeGreaterThan(3);
    expect(ROUTES).toContain("/");
  });

  it.each(NAV_ITEMS.map((i) => [i.label, i.href] as const))(
    "%s → %s resolves to a real route",
    (_label, href) => {
      expect(ROUTES.some((r) => routeMatches(r, href))).toBe(true);
    },
  );

  it("has no link to /matters/, which does not exist", () => {
    expect(NAV_ITEMS.map((i) => i.href)).not.toContain("/matters/");
  });

  it("gives every href a trailing slash (next.config sets trailingSlash)", () => {
    for (const item of NAV_ITEMS) expect(item.href.endsWith("/")).toBe(true);
  });
});

describe("isNavItemActive", () => {
  const item = (href: string, alsoActiveFor?: readonly string[]): NavItem => ({
    label: "x",
    href,
    alsoActiveFor,
  });

  it("matches Today exactly so it does not claim every page", () => {
    expect(isNavItemActive(item("/"), "/")).toBe(true);
    expect(isNavItemActive(item("/"), "/calendar/")).toBe(false);
    expect(isNavItemActive(item("/"), "/matter/abc/")).toBe(false);
  });

  it("matches a subtree", () => {
    expect(isNavItemActive(item("/calendar/"), "/calendar/")).toBe(true);
    expect(isNavItemActive(item("/demands/"), "/demands/")).toBe(true);
  });

  it("tolerates a pathname without a trailing slash", () => {
    expect(isNavItemActive(item("/calendar/"), "/calendar")).toBe(true);
  });

  it("lights Matters for both a matter page and any pipeline board", () => {
    const matters = item("/pipeline/litigation/", ["/matter/", "/pipeline/"]);
    expect(isNavItemActive(matters, "/matter/26-CC-011354/")).toBe(true);
    expect(isNavItemActive(matters, "/pipeline/collections/")).toBe(true);
    expect(isNavItemActive(matters, "/pipeline/litigation/")).toBe(true);
    expect(isNavItemActive(matters, "/demands/")).toBe(false);
  });

  it("leaves no in-app screen unclaimed by some nav item", () => {
    const screens = ["/", "/calendar/", "/demands/", "/intake/", "/pipeline/litigation/", "/matter/x/"];
    for (const screen of screens) {
      expect(
        NAV_ITEMS.some((i) => isNavItemActive(i, screen)),
        `no nav item is active for ${screen}`,
      ).toBe(true);
    }
  });
});
