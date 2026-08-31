"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Nav — the five destinations of the docket dashboard.
 *
 * A registry array, not five hardcoded links: adding a screen is a one-line
 * data change, and the same array can be read by anything else that needs to
 * know the app's shape (a mobile sheet, a print header, a sitemap).
 *
 * `href`s carry a trailing slash because `next.config.ts` sets
 * `trailingSlash: true`; a link without one costs a redirect hop.
 *
 * ACTIVE MATCHING. Today is `/` and would prefix-match everything, so it is
 * matched exactly. Every other item matches its own subtree, plus any extra
 * prefixes in `alsoActiveFor` — a matter detail page (`/matter/<id>/`) and a
 * pipeline board (`/pipeline/litigation/`) both light up "Matters", so the
 * attorney is never looking at a page that no tab claims.
 *
 * The bar scrolls horizontally rather than wrapping or collapsing into a
 * hamburger. On a phone in a courthouse hallway, five visible labels behind one
 * thumb-swipe beat a menu behind a tap, and nothing is ever hidden behind an
 * icon whose meaning has to be recalled.
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
  { label: "Matters", href: "/matters/", alsoActiveFor: ["/matter/", "/pipeline/"] },
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
  className?: string;
};

export function Nav({ items = NAV_ITEMS, className }: NavProps) {
  const pathname = usePathname() ?? "/";

  return (
    <nav
      aria-label="Primary"
      className={[
        // -mx-1 lets the first item's padding sit flush with the bar's edge
        // while keeping a comfortable tap target.
        "-mx-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "print:hidden",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <ul className="flex w-max items-center gap-0.5 px-1">
        {items.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "block rounded-sm px-2.5 py-1.5 text-[13px] font-semibold leading-5",
                  "transition-colors outline-offset-2",
                  active
                    ? "bg-surface-3 text-ink"
                    : "text-muted hover:bg-surface-2 hover:text-ink-2",
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
