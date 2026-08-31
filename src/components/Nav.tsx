"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Nav — the destinations of the docket dashboard, rendered into the left rail.
 *
 * A registry array, not hardcoded links: adding a screen is a one-line data
 * change, and the same array can be read by anything else that needs to know
 * the app's shape (the mobile bar, a print header, a sitemap).
 *
 * `href`s carry a trailing slash because `next.config.ts` sets
 * `trailingSlash: true`; a link without one costs a redirect hop.
 *
 * ACTIVE MATCHING. Today is `/` and would prefix-match everything, so it is
 * matched exactly. Every other item matches its own subtree plus any extra
 * prefixes in `alsoActiveFor` — a matter detail page (`/matter/<id>/`) lights
 * up "Matters", so the attorney is never on a page that no item claims.
 *
 * Every href here must resolve to a real route. "Matters" previously pointed
 * at `/matters/`, which does not exist and returned a 404 in production; the
 * matter list lives under `/pipeline/<practice>/`, so that is where it goes.
 * `NAV_ITEMS` is asserted against the route table in tests/nav.test.ts.
 */

export type NavItem = {
  label: string;
  href: string;
  /** Extra path prefixes that should render this item as current. */
  alsoActiveFor?: readonly string[];
};

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Today", href: "/" },
  { label: "Calendar", href: "/calendar/" },
  {
    label: "Matters",
    href: "/pipeline/litigation/",
    alsoActiveFor: ["/matter/", "/pipeline/"],
  },
  { label: "Demands", href: "/demands/" },
  { label: "Intake", href: "/intake/" },
] as const;

/** Pure so it can be unit-tested without a router. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  if (item.href === "/") return path === "/";
  const prefixes = [item.href, ...(item.alsoActiveFor ?? [])];
  return prefixes.some((prefix) => path === prefix || path.startsWith(prefix));
}

export type NavProps = {
  /** Defaults to NAV_ITEMS; injectable for tests and for narrowed shells. */
  items?: readonly NavItem[];
  /**
   * "rail" — the vertical list inside the dark left rail (desktop).
   * "bar"  — the horizontal scrolling strip under the header (phones), where a
   *          220px rail would eat over half a 390px screen.
   */
  variant?: "rail" | "bar";
  className?: string;
};

export function Nav({ items = NAV_ITEMS, variant = "rail", className }: NavProps) {
  const pathname = usePathname() ?? "/";
  const rail = variant === "rail";

  return (
    <nav
      aria-label="Primary"
      className={[
        rail
          ? ""
          : "-mx-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "print:hidden",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <ul
        className={
          rail ? "flex flex-col gap-0.5" : "flex w-max items-center gap-0.5 px-1"
        }
      >
        {items.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "block rounded-sm text-[13px] font-semibold leading-5 transition-colors",
                  "outline-offset-2",
                  rail
                    ? "px-2.5 py-[7px]"
                    : "px-2.5 py-1.5 whitespace-nowrap",
                  rail
                    ? active
                      ? // The cobalt is the one saturated thing in the rail, so
                        // the current screen is unmistakable at a glance.
                        "bg-accent text-accent-ink"
                      : "text-rail-muted hover:bg-rail-2 hover:text-rail-ink"
                    : active
                      ? "bg-accent text-accent-ink"
                      : "text-muted hover:bg-surface-3 hover:text-ink-2",
                ].join(" ")}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default Nav;
